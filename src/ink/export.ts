/**
 * 손글씨 엔진 — 내보내기 (design-ink 5-4): PDF(pdf-lib, 획은 벡터 경로) · 쪽 그림(PNG) · 썸네일.
 * 종이는 언제나 흰 종이, 잉크는 저장 색(밤 변환 없음). 테이프: 'none' = 뺌(기본), 'hidden' = 붙어 있는 것만.
 */
import type { InkDB, InkItem } from '@/db/ink'
import { getAssetBlob } from '@/db/ink'
import type { PageModel } from './doc'
import type { InkEngine } from './engine'
import { itemMatrix, tapePath } from './items'
import { inkColor, PAPERS, paperOf, rgbOf, tapeColor, type PaperSpec } from './palette'
import { drawTemplate, TEMPLATE_SPEC } from './render'
import { drawStroke, hlComposite, outlineOfModel, PENCIL_ALPHA } from './stroke'
import { renderPdfRegion } from './pdf'
import { mul, type Mat } from './geom'

export type TapeExport = 'none' | 'hidden'

export interface RenderOpts {
  /** 'white' = 흰 종이 · 저장 색(내보내기), 'theme' = 지금 화면처럼(썸네일), 'none' = 종이 없음(메모 칸) */
  paper: 'white' | 'theme' | 'none'
  tapes: TapeExport | 'all'
  /** 이 쪽 좌표 상자만 (없으면 쪽 전체) */
  crop?: [number, number, number, number] | null
}

/** 그리기에 필요한 것만 (엔진이 아니어도 된다: 썸네일 API) */
export interface RenderCtx {
  db: InkDB
  night: boolean
  doc: { load(pm: PageModel): Promise<void> }
}

async function loadImage(blob: Blob): Promise<CanvasImageSource | null> {
  try {
    if (typeof createImageBitmap === 'function') return await createImageBitmap(blob)
  } catch {
    /* 아래로 */
  }
  return new Promise((res) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      res(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      res(null)
    }
    img.src = url
  })
}

/** 글 상자 줄 나누기 (캔버스 글꼴로 잰다) */
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = []
  for (const para of text.split('\n')) {
    let line = ''
    for (const ch of Array.from(para)) {
      const next = line + ch
      if (line && ctx.measureText(next).width > maxW) {
        // 낱말 경계(공백)에서 끊을 수 있으면 끊는다
        const sp = line.lastIndexOf(' ')
        if (sp > 0 && sp > line.length - 12) {
          out.push(line.slice(0, sp))
          line = line.slice(sp + 1) + ch
        } else {
          out.push(line)
          line = ch
        }
      } else line = next
    }
    out.push(line)
  }
  return out
}

const FONT = '"Noto Sans KR", -apple-system, "Apple SD Gothic Neo", system-ui, sans-serif'

function drawTextItem(ctx: CanvasRenderingContext2D, it: InkItem, color: string): void {
  const fs = it.fontSize ?? 12
  ctx.save()
  const m = itemMatrix(it)
  ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5])
  ctx.font = `400 ${fs}px ${FONT}`
  ctx.fillStyle = color
  ctx.textBaseline = 'middle'
  const lines = wrapText(ctx, it.text ?? '', it.w)
  lines.forEach((ln, i) => ctx.fillText(ln, 0, fs * 1.5 * i + fs * 0.75))
  ctx.restore()
}

function tapeFill(ctx: CanvasRenderingContext2D, it: InkItem, color: string): void {
  ctx.save()
  const m = itemMatrix(it)
  ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5])
  ctx.fillStyle = color
  ctx.fill(new Path2D(tapePath(it.id, it.w, it.h)))
  ctx.restore()
}

/**
 * 쪽 하나를 캔버스에 그린다 (k = 장치 px / pt). 쪽 획·물건을 읽어 둔 뒤에 부른다.
 */
export async function renderPageCanvas(eng: RenderCtx, pm: PageModel, k: number, o: RenderOpts): Promise<HTMLCanvasElement> {
  await eng.doc.load(pm)
  const cr = o.crop ?? [0, 0, pm.page.w, pm.page.h]
  const w = cr[2] - cr[0], h = cr[3] - cr[1]
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w * k))
  c.height = Math.max(1, Math.round(h * k))
  const ctx = c.getContext('2d')!
  const spec: PaperSpec = o.paper === 'white' ? PAPERS.white : paperOf(pm.page, eng.night)
  const look = { dark: spec.dark }
  ctx.translate(-cr[0] * k, -cr[1] * k)
  // 1 종이 · PDF · 틀
  if (o.paper === 'none') {
    /* 메모 칸: 종이 없음 */
  } else if (pm.page.pdf) {
    try {
      await renderPdfRegion(eng.db, pm.page.pdf.assetId, pm.page.pdf.pageNo, ctx, k, cr[0], cr[1]).promise
    } catch {
      ctx.fillStyle = '#FFFFFF'
      ctx.fillRect(0, 0, c.width, c.height)
    }
  } else {
    ctx.fillStyle = spec.bg.startsWith('var') ? '#FBFAF7' : spec.bg
    ctx.fillRect(0, 0, pm.page.w * k, pm.page.h * k)
    if (pm.page.template !== 'blank') drawTemplate(ctx, pm.page.template, { x: 0, y: 0, w: pm.page.w, h: pm.page.h }, k, 0, 0, Math.max(1, Math.round(k / 2)), spec, pm.page.w * k, pm.page.h * k)
  }
  ctx.setTransform(k, 0, 0, k, -cr[0] * k, -cr[1] * k)
  const items = pm.itemsSorted()
  // 2 사진 · 글 상자
  for (const it of items) {
    if (it.kind === 'image' && it.assetId) {
      const blob = await getAssetBlob(eng.db, it.assetId)
      const img = blob ? await loadImage(blob) : null
      if (!img) continue
      ctx.save()
      const m = itemMatrix(it)
      ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5])
      ctx.drawImage(img, 0, 0, it.w, it.h)
      ctx.restore()
    } else if (it.kind === 'text') {
      drawTextItem(ctx, it, inkColor(it.color ?? '#1B1D22', look.dark))
    }
  }
  // 3 형광 (따로 그려 한 번에 섞는다 — 화면과 같게)
  const hls = pm.sorted().filter((m) => m.row.layer === 'highlight')
  if (hls.length) {
    const t = document.createElement('canvas')
    t.width = c.width
    t.height = c.height
    const tc = t.getContext('2d')!
    tc.setTransform(k, 0, 0, k, -cr[0] * k, -cr[1] * k)
    tc.globalCompositeOperation = hlComposite(spec)
    for (const m of hls) drawStroke(tc, m, look, k)
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalAlpha = spec.hlOpacity
    ctx.globalCompositeOperation = spec.hlBlend
    ctx.drawImage(t, 0, 0)
    ctx.restore()
    t.width = t.height = 0
  }
  // 4 잉크
  for (const m of pm.sorted()) if (m.row.layer === 'ink') drawStroke(ctx, m, look, k)
  // 5 테이프
  if (o.tapes !== 'none') for (const it of items) if (it.kind === 'tape' && (o.tapes === 'all' || it.hidden)) tapeFill(ctx, it, tapeColor(it.color, look.dark))
  return c
}

export function canvasToBlob(c: HTMLCanvasElement, type = 'image/png', q?: number): Promise<Blob> {
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('그림을 만들 수 없어요'))), type, q))
}

/** 쪽 그림(PNG). scale = CSS px/pt × 2 정도 (기본 2 → 1190×1684) */
export async function exportPagePng(eng: InkEngine, pm: PageModel, o: { scale?: number; tapes?: TapeExport } = {}): Promise<Blob> {
  const c = await renderPageCanvas(eng, pm, o.scale ?? 2, { paper: 'white', tapes: o.tapes ?? 'none' })
  const b = await canvasToBlob(c)
  c.width = c.height = 0
  return b
}

/* ---------- PDF ---------- */

/** 화면 좌표(y 아래) → PDF 사용자 공간 (원본 쪽 회전 · 자르기 상자 반영) */
function displayToPdf(rot: number, box: { x: number; y: number; width: number; height: number }): Mat {
  const x0 = box.x, y0 = box.y, x1 = box.x + box.width, y1 = box.y + box.height
  switch (((rot % 360) + 360) % 360) {
    case 90:
      return [0, 1, 1, 0, x0, y0]
    case 180:
      return [-1, 0, 0, 1, x1, y0]
    case 270:
      return [0, -1, -1, 0, x1, y1]
    default:
      return [1, 0, 0, -1, x0, y1]
  }
}

export async function exportPdf(eng: InkEngine, o: { tapes?: TapeExport; onProgress?: (done: number, total: number) => void } = {}): Promise<Blob> {
  const lib = await import('pdf-lib')
  const { PDFDocument, pushGraphicsState, popGraphicsState, concatTransformationMatrix, setFillingRgbColor, setStrokingRgbColor, moveTo, lineTo, appendBezierCurve, closePath, fill, stroke, setLineWidth, setLineCap, setLineJoin, LineCapStyle, LineJoinStyle, setGraphicsState, drawObject } = lib
  const out = await PDFDocument.create()
  out.setCreator('결 (GYEOL)')
  out.setProducer('결 손글씨')
  const srcCache = new Map<string, ReturnType<typeof PDFDocument.load>>()
  const pages = eng.doc.pages
  const tapes = o.tapes ?? 'none'
  type Op = ReturnType<typeof moveTo>
  const rgb01 = (hex: string) => rgbOf(hex).map((v) => v / 255) as [number, number, number]

  for (let pi = 0; pi < pages.length; pi++) {
    const pm = pages[pi]!
    await eng.doc.load(pm)
    const { w, h } = pm.page
    let page
    let D: Mat
    if (pm.page.pdf) {
      const id = pm.page.pdf.assetId
      let sp = srcCache.get(id)
      if (!sp) {
        sp = (async () => {
          const blob = await getAssetBlob(eng.db, id)
          if (!blob) throw new Error('PDF 원본이 없어요')
          return PDFDocument.load(new Uint8Array(await blob.arrayBuffer()), { ignoreEncryption: true })
        })()
        srcCache.set(id, sp)
      }
      const src = await sp
      const [cp] = await out.copyPages(src, [pm.page.pdf.pageNo - 1])
      page = out.addPage(cp!)
      page.translateContent(0, 0) // 원본 내용을 q … Q로 감싼다(그래픽 상태가 새지 않게)
      D = displayToPdf(page.getRotation().angle, page.getCropBox())
    } else {
      page = out.addPage([w, h])
      D = [1, 0, 0, -1, 0, h]
    }
    const ops: Op[] = [pushGraphicsState(), concatTransformationMatrix(...D)]
    const gs = (key: string, ca: number, bm?: string) => {
      const dict = out.context.obj(bm ? { Type: 'ExtGState', ca, CA: ca, BM: bm } : { Type: 'ExtGState', ca, CA: ca })
      return page.node.newExtGState(key, dict)
    }
    // 틀 (흰 종이 위 연한 선)
    if (!pm.page.pdf && pm.page.template !== 'blank') {
      ops.push(setFillingRgbColor(0.86, 0.865, 0.875))
      const rect = (x: number, y: number, rw: number, rh: number) => ops.push(moveTo(x, y), lineTo(x + rw, y), lineTo(x + rw, y + rh), lineTo(x, y + rh), closePath(), fill())
      const t = pm.page.template
      const lw = 0.5
      if (t === 'ruled') for (let y = TEMPLATE_SPEC.ruled.first; y < h - 8; y += TEMPLATE_SPEC.ruled.gap) rect(0, y, w, lw)
      else if (t === 'grid') {
        const g = TEMPLATE_SPEC.grid.gap
        for (let x = (w % g) / 2; x <= w; x += g) rect(x, 0, lw, h)
        for (let y = (h % g) / 2; y <= h; y += g) rect(0, y, w, lw)
      } else if (t === 'dot') {
        const g = TEMPLATE_SPEC.dot.gap
        const d = TEMPLATE_SPEC.dot.d
        ops.push(setFillingRgbColor(0.78, 0.785, 0.8))
        for (let y = (h % g) / 2; y <= h; y += g) for (let x = (w % g) / 2; x <= w; x += g) rect(x - d / 2, y - d / 2, d, d)
      } else if (t === 'cornell') {
        const c = TEMPLATE_SPEC.cornell
        const cueX = w * c.cue, sumY = h * (1 - c.summary)
        for (let y = c.head + c.gap; y < sumY - 4; y += c.gap) rect(cueX, y, w - cueX, lw)
        ops.push(setFillingRgbColor(0.72, 0.73, 0.75))
        rect(0, c.head, w, lw)
        rect(0, sumY, w, lw)
        rect(cueX, c.head, lw, sumY - c.head)
      }
    }
    const items = pm.itemsSorted()
    // 사진 · 글 상자 (글은 한국어 글꼴 때문에 그림으로)
    for (const it of items) {
      let png: Uint8Array | null = null
      let jpg: Uint8Array | null = null
      if (it.kind === 'image' && it.assetId) {
        const blob = await getAssetBlob(eng.db, it.assetId)
        if (!blob) continue
        if (blob.type === 'image/png') png = new Uint8Array(await blob.arrayBuffer())
        else if (blob.type === 'image/jpeg') jpg = new Uint8Array(await blob.arrayBuffer())
        else {
          const img = await loadImage(blob)
          if (!img) continue
          const cv = document.createElement('canvas')
          const iw = (img as { width: number }).width, ih = (img as { height: number }).height
          cv.width = iw
          cv.height = ih
          cv.getContext('2d')!.drawImage(img, 0, 0)
          png = new Uint8Array(await (await canvasToBlob(cv)).arrayBuffer())
          cv.width = cv.height = 0
        }
      } else if (it.kind === 'text' && (it.text ?? '').trim()) {
        const k = 3
        const cv = document.createElement('canvas')
        const fs = it.fontSize ?? 12
        const tmp = cv.getContext('2d')!
        tmp.font = `400 ${fs}px ${FONT}`
        const lines = wrapText(tmp, it.text ?? '', it.w)
        const th = Math.max(it.h, lines.length * fs * 1.5)
        cv.width = Math.ceil(it.w * k)
        cv.height = Math.ceil(th * k)
        const cx = cv.getContext('2d')!
        cx.setTransform(k, 0, 0, k, 0, 0)
        cx.font = `400 ${fs}px ${FONT}`
        cx.fillStyle = it.color ?? '#1B1D22'
        cx.textBaseline = 'middle'
        lines.forEach((ln, i) => cx.fillText(ln, 0, fs * 1.5 * i + fs * 0.75))
        png = new Uint8Array(await (await canvasToBlob(cv)).arrayBuffer())
        cv.width = cv.height = 0
        const img = await out.embedPng(png)
        const name = page.node.newXObject('Image', img.ref)
        const M = mul(itemMatrix(it), [it.w, 0, 0, -th, 0, th])
        ops.push(pushGraphicsState(), concatTransformationMatrix(...M), drawObject(name), popGraphicsState())
        continue
      }
      if (!png && !jpg) continue
      const img = png ? await out.embedPng(png) : await out.embedJpg(jpg!)
      const name = page.node.newXObject('Image', img.ref)
      const M = mul(itemMatrix(it), [it.w, 0, 0, -it.h, 0, it.h])
      ops.push(pushGraphicsState(), concatTransformationMatrix(...M), drawObject(name), popGraphicsState())
    }
    // 획: 외곽선 → 3차 곡선 (2차 → 3차 정확 변환)
    const outline = (o2: number[][]) => {
      const n = o2.length
      if (n < 3) return
      const a0 = o2[0]!, a1 = o2[1]!
      let px = (a0[0]! + a1[0]!) / 2, py = (a0[1]! + a1[1]!) / 2
      ops.push(moveTo(px, py))
      for (let i = 1; i <= n; i++) {
        const a = o2[i % n]!, b = o2[(i + 1) % n]!
        const ex = (a[0]! + b[0]!) / 2, ey = (a[1]! + b[1]!) / 2
        const qx = a[0]!, qy = a[1]!
        ops.push(appendBezierCurve(px + (2 / 3) * (qx - px), py + (2 / 3) * (qy - py), ex + (2 / 3) * (qx - ex), ey + (2 / 3) * (qy - ey), ex, ey))
        px = ex
        py = ey
      }
      ops.push(closePath(), fill())
    }
    const sorted = pm.sorted()
    const hlGs = sorted.some((m) => m.row.layer === 'highlight') ? gs('GSink', PAPERS.white.hlOpacity, 'Multiply') : null
    const pencilGs = sorted.some((m) => m.row.tool === 'pencil') ? gs('GSink', PENCIL_ALPHA) : null
    for (const layer of ['highlight', 'ink'] as const) {
      for (const m of sorted) {
        if (m.row.layer !== layer) continue
        const [r, g, b] = rgb01(m.row.color)
        ops.push(pushGraphicsState())
        if (layer === 'highlight' && hlGs) ops.push(setGraphicsState(hlGs))
        else if (m.row.tool === 'pencil' && pencilGs) ops.push(setGraphicsState(pencilGs))
        if (m.row.shape) {
          ops.push(setStrokingRgbColor(r, g, b), setLineWidth(m.row.width), setLineCap(LineCapStyle.Round), setLineJoin(LineJoinStyle.Round))
          const p = m.pts
          for (let i = 0; i < m.n; i++) ops.push(i ? lineTo(p[i * 4]!, p[i * 4 + 1]!) : moveTo(p[0]!, p[1]!))
          ops.push(stroke())
        } else {
          const o2 = outlineOfModel(m)
          if (o2) {
            ops.push(setFillingRgbColor(r, g, b))
            outline(o2)
          }
        }
        ops.push(popGraphicsState())
      }
    }
    // 테이프 (붙어 있는 것만)
    if (tapes === 'hidden') {
      for (const it of items) {
        if (it.kind !== 'tape' || !it.hidden) continue
        const [r, g, b] = rgb01(tapeColor(it.color, false))
        const M = itemMatrix(it)
        ops.push(pushGraphicsState(), concatTransformationMatrix(...M), setFillingRgbColor(r, g, b))
        // 찢긴 끝 다각형 (경로 문자열을 다시 읽는다)
        const nums = tapePath(it.id, it.w, it.h).match(/[ML]-?[\d.]+,-?[\d.]+/g) ?? []
        nums.forEach((s2, i) => {
          const [x, y] = s2.slice(1).split(',').map(Number) as [number, number]
          ops.push(i ? lineTo(x, y) : moveTo(x, y))
        })
        ops.push(closePath(), fill(), popGraphicsState())
      }
    }
    ops.push(popGraphicsState())
    page.pushOperators(...ops)
    o.onProgress?.(pi + 1, pages.length)
    // 큰 노트: 프레임을 양보
    await new Promise((r) => setTimeout(r, 0))
  }
  const bytes = await out.save()
  return new Blob([bytes as BlobPart], { type: 'application/pdf' })
}
