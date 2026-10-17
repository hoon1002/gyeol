/**
 * 쪽 영역 그림 (M4 테이프 카드 · 필기 떠올리기, design-m4 1-6 · 3장). 엔진 없이 DB에서 읽는다.
 *
 *   const r = await renderTapeRegion(itemId, { covered: true, scale: 2 })   // 앞면(덮음)
 *   const b = await renderTapeRegion(itemId, { covered: false, scale: 2 })  // 뒷면(걷음 + 테이프 자리 점선)
 *   <img src={r.url} width={r.w} height={r.h} />                            // w·h = CSS px (scale은 기기 배율 몫)
 *   const p = await renderPageRegion(pageId, [x0, y0, x1, y1], { covered: true })  // 올가미 영역 (덮개 = 테이프 모양)
 *
 * 범위: 대상 상자 + 위아래 48pt + 좌우 24pt(쪽 안으로 자름). 같은 요청 · 같은 쪽 바뀜이면 캐시(object URL, 앱이 revoke하지 않는다).
 */
import { appInkDB, loadItems, loadStrokes, type InkDB, type InkItem } from '@/db/ink'
import { uid, type CardCandidate } from '@/db/schema'
import { PageModel } from './doc'
import { canvasToBlob, renderPageCanvas } from './export'
import { bboxTransform, type BBox } from './geom'
import { itemMatrix, tapePath } from './items'
import { rgbOf, tapeColor, TAPE_SLOTS } from './palette'
import { StrokeModel } from './stroke'

export interface RegionImage {
  url: string
  pageId: string
  /** 그린 범위 (쪽 좌표 pt) */
  rect: BBox
  /** CSS px 크기 (scale 나누기 전) */
  w: number
  h: number
  /** 그림 안 테이프 자리 (그림 CSS px, 회전 rad) — 걷힘 모션 · 점선 겹치기용 */
  tape: { x: number; y: number; w: number; h: number; rot: number; color: string; id: string } | null
  flag: boolean
}

export interface RegionOpts {
  covered: boolean
  /** 그림 배율 (pt → px, 기본 2) */
  scale?: number
  night?: boolean
  db?: InkDB
  /** 맥락 여백 [좌우, 위아래] pt (기본 24, 48) */
  margin?: [number, number]
}

const cache = new Map<string, RegionImage>()
const isNight = () => document.documentElement.getAttribute('data-theme') !== 'light'

async function pageModel(db: InkDB, pageId: string): Promise<{ pm: PageModel; ver: number } | null> {
  const page = await db.pages.get(pageId)
  if (!page) return null
  const pm = new PageModel(page)
  const [rows, items] = await Promise.all([loadStrokes(db, pageId), loadItems(db, pageId)])
  let ver = page.updatedAt
  for (const r of rows) {
    pm.addModel(new StrokeModel(r))
    ver = Math.max(ver, r.updatedAt)
  }
  for (const it of items) {
    pm.items.set(it.id, it)
    ver = Math.max(ver, it.updatedAt)
  }
  pm.state = 'ready'
  return { pm, ver: ver + rows.length * 1e-3 }
}

/** 테이프 하나를 캔버스에 (덮음 = 면, 걷음 = 점선 3·3 테이프 색 45%) */
function drawTape(ctx: CanvasRenderingContext2D, it: Pick<InkItem, 'id' | 'x' | 'y' | 'w' | 'h' | 'rot' | 'color'>, covered: boolean, dark: boolean): void {
  const color = tapeColor(it.color, dark)
  const m = itemMatrix(it)
  ctx.save()
  ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5])
  const p = new Path2D(tapePath(it.id, it.w, it.h))
  if (covered) {
    ctx.fillStyle = color
    ctx.fill(p)
  } else {
    const [r, g, b] = rgbOf(color)
    ctx.strokeStyle = `rgba(${r},${g},${b},.45)`
    ctx.lineWidth = 0.75
    ctx.setLineDash([3, 3])
    ctx.stroke(p)
  }
  ctx.restore()
}

async function render(db: InkDB, pageId: string, target: BBox, o: RegionOpts, tapeId: string | null, extra: InkItem | null): Promise<RegionImage | null> {
  const got = await pageModel(db, pageId)
  if (!got) return null
  const { pm, ver } = got
  const night = o.night ?? isNight()
  const scale = o.scale ?? 2
  const [mx, my] = o.margin ?? [24, 48]
  const rect: BBox = [Math.max(0, target[0] - mx), Math.max(0, target[1] - my), Math.min(pm.page.w, target[2] + mx), Math.min(pm.page.h, target[3] + my)]
  const key = [pageId, tapeId ?? rect.map((v) => v.toFixed(1)).join(','), o.covered, scale, night, ver].join('|')
  const hit = cache.get(key)
  if (hit) return hit
  const ctx2 = { db, night, doc: { load: async () => {} } }
  // 테이프는 직접 그린다 (대상: 덮음/걷음, 다른 테이프: 덮은 채 — 다른 카드의 답이다)
  const c = await renderPageCanvas(ctx2, pm, scale, { paper: 'theme', tapes: 'none', crop: rect })
  const ctx = c.getContext('2d')!
  ctx.setTransform(scale, 0, 0, scale, -rect[0] * scale, -rect[1] * scale)
  const dark = night && !pm.page.pdf && pm.page.paper !== 'white'
  for (const it of pm.itemsSorted()) if (it.kind === 'tape') drawTape(ctx, it, it.id === tapeId ? o.covered : true, dark)
  if (extra) drawTape(ctx, extra, o.covered, dark)
  const blob = await canvasToBlob(c)
  const w = c.width / scale, h = c.height / scale
  c.width = c.height = 0
  const t = tapeId ? pm.items.get(tapeId) : extra
  const out: RegionImage = {
    url: URL.createObjectURL(blob),
    pageId,
    rect,
    w,
    h,
    tape: t ? { x: t.x - rect[0], y: t.y - rect[1], w: t.w, h: t.h, rot: t.rot || 0, color: tapeColor(t.color, dark), id: t.id } : null,
    flag: !!(tapeId && pm.items.get(tapeId)?.flag),
  }
  if (cache.size > 300) {
    const first = cache.keys().next().value
    if (first) {
      URL.revokeObjectURL(cache.get(first)!.url)
      cache.delete(first)
    }
  }
  cache.set(key, out)
  return out
}

/** 테이프 카드 그림: 테이프 사각형 + 맥락. covered = 덮음(앞면) / 걷음(뒷면) */
export async function renderTapeRegion(itemId: string, o: RegionOpts): Promise<RegionImage | null> {
  const db = o.db ?? appInkDB
  const it = await db.pageItems.get(itemId)
  if (!it || it.kind !== 'tape' || it.deletedAt) return null
  const b = bboxTransform([0, 0, it.w, it.h], itemMatrix(it))
  return render(db, it.pageId, b, o, it.id, null)
}

/** 쪽 영역 그림 (필기 떠올리기 · 올가미). covered면 영역에 테이프 모양 덮개를 그린다 */
export async function renderPageRegion(pageId: string, rect: BBox, o: RegionOpts): Promise<RegionImage | null> {
  const db = o.db ?? appInkDB
  const cover: InkItem = { id: 'region:' + rect.map((v) => Math.round(v)).join(','), pageId, kind: 'tape', x: rect[0], y: rect[1], w: rect[2] - rect[0], h: rect[3] - rect[1], rot: 0, color: TAPE_SLOTS[0], z: 0, createdAt: 0, updatedAt: 0 }
  return render(db, pageId, rect, o, null, cover)
}

/**
 * 노트의 테이프마다 카드 후보 (rule 'tape', anchor = 테이프 id, front·back은 빈 글 — 그림은 renderTapeRegion).
 * 헷갈림(flag) 테이프는 sort 0(맨 위), 나머지 1. 사라진 테이프의 'new' 후보는 'dismissed'로. 받은(accepted) 것은 건드리지 않는다.
 * cardCandidates 표가 없는 DB(시험 DB)면 아무것도 하지 않는다. 바뀐 후보 수를 돌려준다.
 */
export async function syncTapeCandidates(noteId: string, db: InkDB = appInkDB): Promise<number> {
  const t = (db as InkDB & { cardCandidates?: import('dexie').Table<CardCandidate & { sort?: number }, string> }).cardCandidates
  if (!t || !db.tables.some((x) => x.name === 'cardCandidates')) return 0
  const pages = (await db.pages.where('noteId').equals(noteId).toArray()).filter((p) => !p.deletedAt)
  const tapes: InkItem[] = []
  for (const p of pages) for (const it of await loadItems(db, p.id)) if (it.kind === 'tape') tapes.push(it)
  const now = Date.now()
  const have = (await t.where('noteId').equals(noteId).toArray()).filter((c) => c.rule === 'tape')
  const byAnchor = new Map(have.map((c) => [c.anchor ?? '', c]))
  const put: Array<CardCandidate & { sort?: number }> = []
  for (const it of tapes) {
    const cur = byAnchor.get(it.id)
    const sort = it.flag ? 0 : 1
    if (!cur) put.push({ id: uid('cc'), noteId, rule: 'tape', front: '', back: '', anchor: it.id, status: 'new', sort, createdAt: now, updatedAt: now })
    else if (cur.status === 'new' && cur.sort !== sort) put.push({ ...cur, sort, updatedAt: now })
    byAnchor.delete(it.id)
  }
  for (const c of byAnchor.values()) if (c.status === 'new') put.push({ ...c, status: 'dismissed', updatedAt: now })
  if (put.length) await t.bulkPut(put)
  return put.length
}
