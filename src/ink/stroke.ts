/**
 * 손글씨 엔진 — 획 모양 (perfect-freehand 외곽선 → Path2D) · 펜 촉 설정 · 그리기.
 *
 * 입력 단계에서 우리가 직접 흔들림을 걸러(1€ 필터) 저장하므로 perfect-freehand의 streamline은 0이다.
 * 그래서 외곽선이 '근처 점'에만 기대고, 쓰는 중에는 조각(청크)으로 나눠 그려도 끝난 뒤 한 번에 그린 것과 같다.
 */
import { getStroke, type StrokeOptions } from 'perfect-freehand'
import { pointsOf, type InkStroke } from '@/db/ink'
import type { BBox } from './geom'
import { hlColor, inkColor } from './palette'
import type { PenKind } from './types'

export type Outline = number[][]

/** 연필 불투명도 (design-ink 2-9) */
export const PENCIL_ALPHA = 0.85

/**
 * 촉 종류 → 외곽선 설정 (size = 굵기 pt, design-ink 2-9).
 * streamline은 0: 흔들림은 입력에서 1€ 필터가 거른다(볼펜 .30 · 만년필 .35에 맞춘 세기).
 */
export function penOptions(tool: InkStroke['tool'], pen: PenKind | null | undefined, width: number): StrokeOptions {
  const size = Math.max(0.2, width)
  if (tool === 'highlighter') return { size, thinning: 0, smoothing: 0.6, streamline: 0, simulatePressure: false, start: { cap: false, taper: 0 }, end: { cap: false, taper: 0 } }
  if (tool === 'pencil' || pen === 'pencil')
    return { size, thinning: 0.2, smoothing: 0.55, streamline: 0, simulatePressure: false, easing: (t) => t, start: { cap: true, taper: 0 }, end: { cap: true, taper: 0 } }
  if (pen === 'fountain')
    return {
      size,
      thinning: 0.7,
      smoothing: 0.55,
      streamline: 0,
      simulatePressure: false,
      easing: (t) => Math.sin((t * Math.PI) / 2),
      start: { cap: true, taper: 0 },
      end: { cap: true, taper: 6 },
    }
  // 볼펜
  return { size, thinning: 0.45, smoothing: 0.55, streamline: 0, simulatePressure: false, easing: (t) => t, start: { cap: true, taper: 0 }, end: { cap: true, taper: 0 } }
}

/** 조각 그리기용: 처음/끝이 진짜 획 끝이 아니면 가늘어지지 않고 둥글게 이어 붙인다 */
export function chunkOptions(base: StrokeOptions, isStart: boolean, isEnd: boolean): StrokeOptions {
  return {
    ...base,
    start: isStart ? base.start : { cap: true, taper: 0 },
    end: isEnd ? base.end : { cap: true, taper: 0 },
    last: isEnd,
  }
}

/** 평평한 점 배열(stride 4: x y p t)의 [from, to) 구간 외곽선 */
export function outlineOf(pts: ArrayLike<number>, from: number, to: number, opts: StrokeOptions, extra?: ArrayLike<number> | null): Outline {
  const input: number[][] = []
  for (let i = from; i < to; i++) input.push([pts[i * 4]!, pts[i * 4 + 1]!, pts[i * 4 + 2]!])
  if (extra) for (let i = 0; i + 2 < extra.length; i += 3) input.push([extra[i]!, extra[i + 1]!, extra[i + 2]!])
  if (!input.length) return []
  return getStroke(input, opts)
}

/** 외곽선 → Path2D (꼭짓점을 조절점으로, 가운데점을 지나는 2차 곡선) */
export function pathFromOutline(o: Outline, p = new Path2D()): Path2D {
  const n = o.length
  if (n < 3) return p
  const a0 = o[0]!, a1 = o[1]!
  p.moveTo((a0[0]! + a1[0]!) / 2, (a0[1]! + a1[1]!) / 2)
  for (let i = 1; i <= n; i++) {
    const a = o[i % n]!, b = o[(i + 1) % n]!
    p.quadraticCurveTo(a[0]!, a[1]!, (a[0]! + b[0]!) / 2, (a[1]! + b[1]!) / 2)
  }
  p.closePath()
  return p
}

/** 점 하나짜리(톡 찍기) 획인가: 모든 점이 반지름의 1/4 안 */
export function isDot(pts: ArrayLike<number>, n: number, width: number): boolean {
  const x0 = pts[0]!, y0 = pts[1]!
  const r2 = Math.max(0.08, width * 0.25) ** 2
  for (let i = 1; i < n; i++) {
    const dx = pts[i * 4]! - x0, dy = pts[i * 4 + 1]! - y0
    if (dx * dx + dy * dy > r2) return false
  }
  return true
}

/** 점 반지름 (압력 반영) */
export function dotRadius(opts: StrokeOptions, pressure: number): number {
  const size = opts.size ?? 2
  const th = opts.thinning ?? 0
  const ease = opts.easing ?? ((t: number) => t)
  return Math.max(0.3, size * ease(0.5 - th * (0.5 - pressure)))
}

/* ---------- 메모리 속 획 ---------- */

export class StrokeModel {
  row: InkStroke
  pts: Float32Array
  /** 화면에 그려지는 범위 (외곽 포함) */
  bbox: BBox
  /** 외곽선 캐시 (쪽 좌표) */
  path: Path2D | null = null
  /** 끄는 동안 정적 층에서 뺀다 */
  hidden = false
  constructor(row: InkStroke) {
    this.row = row
    this.pts = pointsOf(row)
    this.bbox = row.bbox
  }
  get id(): string {
    return this.row.id
  }
  get n(): number {
    return this.pts.length >> 2
  }
}

export function zCompare(a: StrokeModel, b: StrokeModel): number {
  return a.row.createdAt - b.row.createdAt || (a.row.id < b.row.id ? -1 : a.row.id > b.row.id ? 1 : 0)
}

/** 획 외곽선 Path2D (도형은 중심선 폴리라인) */
export function pathOf(m: StrokeModel): Path2D {
  if (m.path) return m.path
  const r = m.row
  const pts = m.pts
  const n = pts.length >> 2
  const p = new Path2D()
  if (r.shape) {
    if (n) p.moveTo(pts[0]!, pts[1]!)
    for (let i = 1; i < n; i++) p.lineTo(pts[i * 4]!, pts[i * 4 + 1]!)
    if (n === 1) p.lineTo(pts[0]! + 0.01, pts[1]!)
  } else {
    const opts = penOptions(r.tool, r.pen ?? (r.tool === 'pencil' ? 'pencil' : 'ball'), r.width)
    if (n && isDot(pts, n, r.width)) {
      p.arc(pts[0]!, pts[1]!, dotRadius(opts, pts[2]!), 0, Math.PI * 2)
    } else {
      pathFromOutline(outlineOf(pts, 0, n, { ...opts, last: true }), p)
    }
  }
  m.path = p
  return p
}

/** 외곽선 다각형 (PDF 내보내기용, 도형이면 null) */
export function outlineOfModel(m: StrokeModel): Outline | null {
  const r = m.row
  if (r.shape) return null
  const n = m.n
  const opts = penOptions(r.tool, r.pen ?? (r.tool === 'pencil' ? 'pencil' : 'ball'), r.width)
  if (n && isDot(m.pts, n, r.width)) {
    const rad = dotRadius(opts, m.pts[2]!)
    const out: Outline = []
    for (let i = 0; i < 16; i++) out.push([m.pts[0]! + Math.cos((i / 16) * Math.PI * 2) * rad, m.pts[1]! + Math.sin((i / 16) * Math.PI * 2) * rad])
    return out
  }
  return outlineOf(m.pts, 0, n, { ...opts, last: true })
}

/* ---------- 그리기 ---------- */

export interface Look {
  /** 이 쪽 종이가 어두운가(밤 종이) */
  dark: boolean
}

/** 형광: 밤 종이면 밝은 짝(섞기·불투명도는 층이 맡는다), 잉크: 밤 종이면 짝 색 */
export function displayColor(row: Pick<InkStroke, 'color' | 'layer'>, look: Look): string {
  if (row.layer === 'highlight') return hlColor(row.color, look.dark)
  return inkColor(row.color, look.dark)
}

/** 형광 층 캔버스 안 합성: 낮은 겹치면 진해지게(곱하기), 밤은 겹쳐도 그대로(밝은 쪽) */
export function hlComposite(spec: { hlBlend: string }): GlobalCompositeOperation {
  return spec.hlBlend === 'multiply' ? 'multiply' : 'lighten'
}

/* 연필 결: 장치 픽셀 기준 잡음 무늬 (색마다, 문맥마다, 배율마다 하나) */
let noiseTile: HTMLCanvasElement | null = null
function noise(): HTMLCanvasElement {
  if (noiseTile) return noiseTile
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const img = g.createImageData(64, 64)
  let seed = 1234567
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  for (let i = 0; i < 64 * 64; i++) {
    // 종이결 8%: 대부분 그대로, 군데군데 조금 비는 알갱이
    const v = rnd()
    const a = PENCIL_ALPHA * (v < 0.22 ? 0.92 - rnd() * 0.08 : 1 - rnd() * 0.03)
    img.data[i * 4 + 3] = Math.round(a * 255)
  }
  g.putImageData(img, 0, 0)
  noiseTile = c
  return c
}

const patterns = new WeakMap<CanvasRenderingContext2D, Map<string, CanvasPattern>>()

export function pencilFill(ctx: CanvasRenderingContext2D, color: string, k: number): CanvasPattern | string {
  let per = patterns.get(ctx)
  if (!per) patterns.set(ctx, (per = new Map()))
  const key = color + '|' + k.toFixed(3)
  let pat = per.get(key)
  if (!pat) {
    const tile = document.createElement('canvas')
    tile.width = tile.height = 64
    const g = tile.getContext('2d')!
    g.fillStyle = color
    g.fillRect(0, 0, 64, 64)
    g.globalCompositeOperation = 'destination-in'
    g.drawImage(noise(), 0, 0)
    pat = ctx.createPattern(tile, 'repeat') ?? undefined
    if (!pat) return color
    try {
      pat.setTransform(new DOMMatrix([1 / k, 0, 0, 1 / k, 0, 0]))
    } catch {
      /* 오래된 브라우저: 쪽 좌표 결 */
    }
    if (per.size > 48) per.clear()
    per.set(key, pat)
  }
  return pat
}

/**
 * 획 하나를 그린다. ctx의 변환은 '쪽 좌표 → 장치 픽셀'(k = 장치 px / pt)이어야 한다.
 * 형광펜 층(밝은 종이)은 호출하는 쪽에서 globalCompositeOperation = 'multiply'.
 */
export function drawStroke(ctx: CanvasRenderingContext2D, m: StrokeModel, look: Look, k: number): void {
  const r = m.row
  const color = displayColor(r, look)
  if (r.shape) {
    ctx.strokeStyle = color
    ctx.lineWidth = r.width
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.stroke(pathOf(m))
    return
  }
  ctx.fillStyle = r.tool === 'pencil' ? pencilFill(ctx, color, k) : color
  ctx.fill(pathOf(m))
}

/** 획 중심선이 원(cx, cy, r)과 닿는가 */
export function strokeHitsCircle(m: StrokeModel, cx: number, cy: number, r: number): boolean {
  const pts = m.pts
  const n = pts.length >> 2
  const rr = r + m.row.width * 0.5
  const r2 = rr * rr
  if (n === 1) {
    const dx = pts[0]! - cx, dy = pts[1]! - cy
    return dx * dx + dy * dy <= r2
  }
  for (let i = 1; i < n; i++) {
    const ax = pts[(i - 1) * 4]!, ay = pts[(i - 1) * 4 + 1]!, bx = pts[i * 4]!, by = pts[i * 4 + 1]!
    // 빠른 거절
    if ((ax < cx - rr && bx < cx - rr) || (ax > cx + rr && bx > cx + rr) || (ay < cy - rr && by < cy - rr) || (ay > cy + rr && by > cy + rr)) continue
    const dx = bx - ax, dy = by - ay
    const l2 = dx * dx + dy * dy
    let t = l2 > 0 ? ((cx - ax) * dx + (cy - ay) * dy) / l2 : 0
    t = t < 0 ? 0 : t > 1 ? 1 : t
    const qx = ax + t * dx - cx, qy = ay + t * dy - cy
    if (qx * qx + qy * qy <= r2) return true
  }
  return false
}

/** 점 배열의 화면 범위(외곽 포함) */
export function strokeBBox(pts: ArrayLike<number>, width: number): BBox {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (let i = 0; i + 3 < pts.length; i += 4) {
    const x = pts[i]!, y = pts[i + 1]!
    if (x < x0) x0 = x
    if (x > x1) x1 = x
    if (y < y0) y0 = y
    if (y > y1) y1 = y
  }
  if (x0 === Infinity) return [0, 0, 0, 0]
  const pad = width * 0.85 + 0.5
  return [x0 - pad, y0 - pad, x1 + pad, y1 + pad]
}
