/**
 * 쪽 썸네일 API (엔진 없이). 별가루함 손글씨 메모(앱 B) · 노트 목록(앱 A)이 같이 쓴다.
 *
 *   const { inkThumbnailURL } = await import('@/ink')
 *   const url = await inkThumbnailURL({ noteId: 'memo:' + memo.id, height: 40, fit: 'ink', paper: 'none' })   // 메모 띠(잉크만 잘라)
 *   const url2 = await inkThumbnailURL({ noteId: note.id, height: 96 })                                      // 노트 첫 쪽(밤·낮 종이)
 *   <img src={url} height={40} alt="" />
 *
 * - height: CSS px (권장 40–96). 기기 배율(dpr)만큼 크게 그린다.
 * - night: 밤 종이(기본: html[data-theme] != light). 잉크는 밤 짝 색으로, 낮은 저장 색으로.
 * - fit 'ink': 획·물건이 있는 곳만 잘라(여백 6pt) 띠로. 'page': 쪽 전체.
 * - paper 'none': 종이 없이(투명) — 메모 칸처럼 바탕을 앱이 칠할 때.
 * - 같은 쪽 · 같은 바뀜(최근 updatedAt) · 같은 옵션이면 캐시를 돌려준다.
 */
import { appInkDB, listPages, loadItems, loadStrokes, type InkDB } from '@/db/ink'
import type { Page } from '@/db/schema'
import { PageModel } from './doc'
import { canvasToBlob, renderPageCanvas, type RenderCtx } from './export'
import { itemMatrix } from './items'
import { bboxTransform } from './geom'
import { StrokeModel } from './stroke'

export interface InkThumbOptions {
  /** 쪽 id 또는 노트 id(첫 쪽). 메모는 'memo:<메모 id>' */
  pageId?: string
  noteId?: string
  height?: number
  night?: boolean
  fit?: 'page' | 'ink'
  paper?: 'theme' | 'white' | 'none'
  db?: InkDB
  dpr?: number
}

const cache = new Map<string, string>()

async function pageFor(db: InkDB, o: InkThumbOptions): Promise<Page | null> {
  if (o.pageId) return (await db.pages.get(o.pageId)) ?? null
  if (o.noteId) return (await listPages(db, o.noteId))[0] ?? null
  return null
}

/** 쪽 썸네일 캔버스 (없으면 null) */
export async function inkThumbnail(o: InkThumbOptions): Promise<HTMLCanvasElement | null> {
  const db = o.db ?? appInkDB
  const page = await pageFor(db, o)
  if (!page) return null
  const pm = new PageModel(page)
  const [rows, items] = await Promise.all([loadStrokes(db, page.id), loadItems(db, page.id)])
  for (const r of rows) pm.addModel(new StrokeModel(r))
  for (const it of items) pm.items.set(it.id, it)
  pm.state = 'ready'
  const night = o.night ?? document.documentElement.getAttribute('data-theme') !== 'light'
  let crop: [number, number, number, number] | null = null
  if (o.fit === 'ink') {
    let b: [number, number, number, number] | null = null
    for (const m of pm.strokes.values()) b = b ? [Math.min(b[0], m.bbox[0]), Math.min(b[1], m.bbox[1]), Math.max(b[2], m.bbox[2]), Math.max(b[3], m.bbox[3])] : [...m.bbox]
    for (const it of pm.items.values()) {
      const ib = bboxTransform([0, 0, it.w, it.h], itemMatrix(it))
      b = b ? [Math.min(b[0], ib[0]), Math.min(b[1], ib[1]), Math.max(b[2], ib[2]), Math.max(b[3], ib[3])] : ib
    }
    if (!b) return null
    crop = [Math.max(0, b[0] - 6), Math.max(0, b[1] - 6), Math.min(page.w, b[2] + 6), Math.min(page.h, b[3] + 6)]
  }
  const h = Math.max(8, o.height ?? 64)
  const dpr = o.dpr ?? Math.min(3, window.devicePixelRatio || 1)
  const ch = crop ? crop[3] - crop[1] : page.h
  const k = (h * dpr) / Math.max(1, ch)
  const ctx: RenderCtx = { db, night, doc: { load: async () => {} } }
  return renderPageCanvas(ctx, pm, k, { paper: o.paper ?? 'theme', tapes: 'all', crop })
}

/** 썸네일 data URL (캐시). 그릴 것이 없으면 null */
export async function inkThumbnailURL(o: InkThumbOptions): Promise<string | null> {
  const db = o.db ?? appInkDB
  const page = await pageFor(db, o)
  if (!page) return null
  const keys = await db.strokes.where('pageId').equals(page.id).toArray()
  const ver = Math.max(page.updatedAt, ...keys.map((r) => r.updatedAt))
  const key = [page.id, ver, keys.length, o.height ?? 64, o.night ?? '', o.fit ?? 'page', o.paper ?? 'theme', o.dpr ?? ''].join('|')
  const hit = cache.get(key)
  if (hit) return hit
  const c = await inkThumbnail({ ...o, pageId: page.id })
  if (!c) return null
  const url = URL.createObjectURL(await canvasToBlob(c))
  c.width = c.height = 0
  if (cache.size > 200) {
    const first = cache.keys().next().value
    if (first) {
      URL.revokeObjectURL(cache.get(first)!)
      cache.delete(first)
    }
  }
  cache.set(key, url)
  return url
}
