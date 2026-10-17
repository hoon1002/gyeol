/**
 * 손글씨 엔진 — 도구 세션 (누른 순간부터 뗄 때까지 한 손의 일).
 *   PenSession(펜·형광·한 번 도형) · EraserSession · LassoSession · SelectDragSession · TapeSession · PanSession · PieSession · TapSession
 * 펜 → 잉크는 이벤트 처리 안에서 바로 그린다(같은 프레임). 실시간 층은 새 점이 들어온 꼬리만 다시 그린다.
 */
import { packPoints, type InkItem, type InkStroke } from '@/db/ink'
import { uid } from '@/db/schema'
import { apply as mApply, bboxOfPoints, clamp, distSqToSeg, IDENT, isIdentity, matAngle, mul, pointInPoly, rotateAt, scaleAt, segSegDistSq, translate, type BBox, type Mat } from './geom'
import { chunkOptions, displayColor, dotRadius, isDot, outlineOf, pathFromOutline, pencilFill, penOptions, strokeBBox, StrokeModel } from './stroke'
import { recognize, shapePoints, shapeVertices, transformShape, type ShapeFit } from './shapes'
import { devRect } from './live'
import { INK_THRESHOLDS as T } from './input/thresholds'
import type { PageModel } from './doc'
import type { PageBox } from './view'
import type { InkEngine } from './engine'
import { tapeColor } from './palette'
import { deleted } from './doc'

export interface InPt {
  /** 호스트 기준 CSS px */
  x: number
  y: number
  /** 압력 0–1 (없으면 0.5) */
  p: number
  /** epoch ms */
  t: number
  /** event.timeStamp (지연 계측) */
  ts: number
  type: string
  /** 고도각 rad (π/2 = 수직) */
  alt: number
}

export interface Session {
  readonly kind: string
  move(pts: InPt[], predicted: InPt[] | null): void
  up(pt: InPt | null): void
  cancel(): void
  /** 실시간 층을 쓰는가 (페이드와 겹치지 않게) */
  readonly usesLive: boolean
}

/* ---------- 1€ 필터 (흔들림 거르기, 화면 px · 초) ---------- */

class OneEuro {
  private x: number | null = null
  private dx = 0
  private t = 0
  constructor(
    private minCutoff: number,
    private beta: number,
    private dCutoff = 1.2,
  ) {}
  filter(v: number, tSec: number): number {
    if (this.x === null) {
      this.x = v
      this.t = tSec
      return v
    }
    const dt = Math.max(1e-4, tSec - this.t)
    this.t = tSec
    const ad = 1 / (1 + 1 / (2 * Math.PI * this.dCutoff * dt))
    this.dx += ad * ((v - this.x) / dt - this.dx)
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx)
    const a = 1 / (1 + 1 / (2 * Math.PI * cutoff * dt))
    this.x += a * (v - this.x)
    return this.x
  }
}

function filterFor(type: string, kind: string): [number, number] {
  if (type === 'pen') return kind === 'fountain' ? [7, 0.07] : [8, 0.08]
  if (type === 'mouse') return [4, 0.04]
  return [3, 0.035]
}

/* ---------- 펜 · 형광펜 ---------- */

export interface PenSpecIn {
  tool: 'pen' | 'highlighter'
  kind: 'ball' | 'fountain' | 'pencil'
  color: string
  width: number
  pressure: boolean
  straight: boolean
  shapeOnce: boolean
  shapeHold: boolean
  scratch: boolean
  /** 빈 곳 길게 누르기 → 둥근 메뉴 (ms, 0 = 끔) */
  pieMs: number
}

export class PenSession implements Session {
  readonly kind = 'pen'
  readonly usesLive = true
  private pts = new Float32Array(1024)
  private n = 0
  private frozen = 0
  private fx: OneEuro
  private fy: OneEuro
  readonly createdAt: number
  private lastP = 0.5
  private speed = 0
  private last: InPt
  private down: InPt
  private moved = 0
  private holdAt: [number, number]
  private holdTimer = 0
  private pieTimer = 0
  private locked: ShapeFit | null = null
  private straightLocked = false
  private opts
  private isHL: boolean
  private firstDrawn = false
  private morph: { from: number[]; to: number[]; t0: number; raf: number } | null = null
  private done = false
  private ink: string
  private tool: InkStroke['tool']

  constructor(
    private eng: InkEngine,
    private pm: PageModel,
    private box: PageBox,
    private spec: PenSpecIn,
    first: InPt,
    pieAllowed: boolean,
  ) {
    this.isHL = spec.tool === 'highlighter'
    this.tool = this.isHL ? 'highlighter' : spec.kind === 'pencil' ? 'pencil' : 'pen'
    const [mc, b] = filterFor(first.type, spec.kind)
    this.fx = new OneEuro(mc, b)
    this.fy = new OneEuro(mc, b)
    this.createdAt = Math.round(first.t)
    this.opts = penOptions(this.tool, spec.kind, spec.width)
    this.ink = displayColor({ color: spec.color, layer: this.isHL ? 'highlight' : 'ink' }, { dark: eng.r.views.get(pm.id)?.spec.dark ?? eng.night })
    this.last = this.down = first
    this.holdAt = [first.x, first.y]
    const L = eng.live
    L.clear()
    L.setMode(this.isHL ? 'hl' : 'ink', eng.r.views.get(pm.id)?.spec)
    this.add(first)
    this.render(null)
    if (pieAllowed && spec.pieMs > 0) {
      this.eng.ringStart(first.x, first.y, first.type)
      this.pieTimer = window.setTimeout(() => this.onPie(), spec.pieMs)
    }
  }

  /** 지금까지 그은 길이 (화면 px) */
  get travel(): number {
    return this.moved
  }

  private add(pt: InPt, raw = false): void {
    const v = this.eng.view
    const sec = pt.t / 1000
    const x = raw ? pt.x : this.fx.filter(pt.x, sec)
    const y = raw ? pt.y : this.fy.filter(pt.y, sec)
    const dt = Math.max(1, pt.t - this.last.t)
    const dist = Math.hypot(pt.x - this.last.x, pt.y - this.last.y)
    this.moved += dist
    // 압력
    let p: number
    if (pt.type === 'pen' && this.spec.pressure) {
      let r = pt.p > 0 ? pt.p : this.lastP
      r = 1 - Math.pow(1 - clamp(r, 0, 1), 1.7)
      if (this.spec.kind === 'pencil' && !this.isHL) {
        const tilt = 1 - clamp(pt.alt / (Math.PI / 2), 0, 1)
        r = clamp(r + 0.45 * tilt * tilt, 0, 1)
      }
      p = this.n ? this.lastP + (r - this.lastP) * 0.6 : r
    } else if (pt.type === 'pen' || this.isHL) {
      p = 0.5
    } else {
      // 마우스 · 손가락: 빠를수록 가늘게 (simulatePressure와 같은 꼴)
      const sp = dist / dt
      this.speed = this.n ? this.speed + (sp - this.speed) * 0.3 : 0
      const target = clamp(0.62 - this.speed * 0.09, 0.28, 0.62)
      p = this.n ? this.lastP + (target - this.lastP) * 0.35 : 0.56
    }
    this.lastP = p
    this.last = pt
    if (this.n * 4 + 4 > this.pts.length) {
      const g = new Float32Array(this.pts.length * 2)
      g.set(this.pts)
      this.pts = g
    }
    const o = this.n * 4
    this.pts[o] = v.vx + x / v.s - this.box.x
    this.pts[o + 1] = v.vy + y / v.s - this.box.y
    this.pts[o + 2] = p
    this.pts[o + 3] = pt.t - this.createdAt
    this.n++
    // 멈춤 판정 (도형 · 곧게 · 둥근 메뉴)
    const lim = this.isHL ? T.shapeHoldMove : T.shapeHoldMove
    if (Math.hypot(pt.x - this.holdAt[0], pt.y - this.holdAt[1]) > lim) {
      this.holdAt = [pt.x, pt.y]
      if (!this.locked && !this.straightLocked) this.armHold()
    }
    if (this.pieTimer && Math.hypot(pt.x - this.down.x, pt.y - this.down.y) > (pt.type === 'touch' ? T.fingerLongMove : T.penLongMove)) {
      clearTimeout(this.pieTimer)
      this.pieTimer = 0
      this.eng.ringStop()
    }
  }

  private armHold(): void {
    clearTimeout(this.holdTimer)
    const need = this.isHL ? (this.spec.straight ? T.hlStraightHoldMs : 0) : this.spec.shapeHold ? T.shapeHoldMs : 0
    if (!need || this.moved < 18) return
    this.holdTimer = window.setTimeout(() => this.onHold(), need)
  }

  private onHold(): void {
    if (this.done || this.locked || this.straightLocked) return
    if (this.isHL) {
      this.straightLocked = true
      this.straighten()
      this.renderAll()
      return
    }
    const fit = recognize(this.pts, this.n, this.eng.view.s)
    if (!fit) return
    this.lockShape(fit)
  }

  private lockShape(fit: ShapeFit): void {
    this.locked = fit
    const verts = shapeVertices(fit)
    const from: number[] = []
    for (let i = 0; i < this.n; i++) from.push(this.pts[i * 4]!, this.pts[i * 4 + 1]!)
    this.startMorph(from, verts)
  }

  /** 도형으로 바꿀 때 점을 160ms 동안 옮긴다 */
  private startMorph(from: number[], to: number[]): void {
    const N = 64
    const A = resampleN(from, N), B = resampleN(to, N)
    const m = { from: A, to: B, t0: performance.now(), raf: 0 }
    this.morph = m
    const tick = () => {
      const t = Math.min(1, (performance.now() - m.t0) / 160)
      const e = 1 - Math.pow(1 - t, 3)
      const xy: number[] = []
      for (let i = 0; i < A.length; i++) xy.push(A[i]! + (B[i]! - A[i]!) * e)
      this.drawPoly(t >= 1 ? to : xy)
      if (t < 1 && this.morph === m) m.raf = requestAnimationFrame(tick)
    }
    tick()
  }

  private drawPoly(xy: number[]): void {
    const L = this.eng.live
    L.clear()
    const ctx = L.actx
    ctx.save()
    L.clipPage(ctx, this.eng.view, this.box)
    L.pageTransform(ctx, this.eng.view, this.box)
    ctx.strokeStyle = this.ink
    ctx.lineWidth = this.spec.width
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    for (let i = 0; i + 1 < xy.length; i += 2) (i ? ctx.lineTo : ctx.moveTo).call(ctx, xy[i]!, xy[i + 1]!)
    ctx.stroke()
    ctx.restore()
    L.aDirty = true
  }

  private onPie(): void {
    this.pieTimer = 0
    if (this.done || Math.hypot(this.last.x - this.down.x, this.last.y - this.down.y) > (this.down.type === 'touch' ? T.fingerLongMove : T.penLongMove)) return
    // 찍힌 점은 지우고, 기록에도 남기지 않는다
    this.done = true
    clearTimeout(this.holdTimer)
    this.eng.live.clear()
    this.eng.ringStop()
    this.eng.becomePie(this.down, this.pm, this.box)
  }

  /** 형광펜 곧게: 시작–끝 직선, 수평 ±4°면 수평 */
  private straighten(): void {
    if (this.n < 2) return
    const x0 = this.pts[0]!, y0 = this.pts[1]!
    let x1 = this.pts[(this.n - 1) * 4]!, y1 = this.pts[(this.n - 1) * 4 + 1]!
    const ang = Math.atan2(y1 - y0, x1 - x0)
    if (Math.abs(Math.sin(ang)) < Math.sin((4 * Math.PI) / 180)) y1 = y0
    const L = Math.hypot(x1 - x0, y1 - y0)
    const steps = Math.max(2, Math.ceil(L / 4))
    const t0 = this.pts[3]!, t1 = this.pts[(this.n - 1) * 4 + 3]!
    const out = new Float32Array((steps + 1) * 4)
    for (let i = 0; i <= steps; i++) {
      const f = i / steps
      out[i * 4] = x0 + (x1 - x0) * f
      out[i * 4 + 1] = y0 + (y1 - y0) * f
      out[i * 4 + 2] = 0.5
      out[i * 4 + 3] = t0 + (t1 - t0) * f
    }
    this.pts = out
    this.n = steps + 1
    this.frozen = 0
  }

  private nearlyStraight(): boolean {
    if (this.n < 2) return false
    const x0 = this.pts[0]!, y0 = this.pts[1]!, x1 = this.pts[(this.n - 1) * 4]!, y1 = this.pts[(this.n - 1) * 4 + 1]!
    const L = Math.hypot(x1 - x0, y1 - y0)
    if (L < 12) return false
    let dev = 0
    for (let i = 1; i < this.n - 1; i++) dev = Math.max(dev, distSqToSeg(this.pts[i * 4]!, this.pts[i * 4 + 1]!, x0, y0, x1, y1))
    return Math.sqrt(dev) < L * T.hlStraightDev
  }

  move(pts: InPt[], predicted: InPt[] | null): void {
    if (this.done) return
    if (this.locked || this.straightLocked) {
      if (pts.length) this.last = pts[pts.length - 1]!
      return
    }
    for (const p of pts) this.add(p)
    this.render(predicted)
  }

  private fillStyle(ctx: CanvasRenderingContext2D, k: number): string | CanvasPattern {
    return this.tool === 'pencil' ? pencilFill(ctx, this.ink, k) : this.ink
  }

  /** 실시간: 굳은 조각은 A에 한 번, 꼬리는 B에서 지우고 다시 */
  private render(predicted: InPt[] | null): void {
    const L = this.eng.live
    const v = this.eng.view
    const k = v.s * v.dpr
    const ox = v.tx * v.dpr + this.box.x * k, oy = v.ty * v.dpr + this.box.y * k
    if (this.n - this.frozen >= 24) {
      const from = Math.max(0, this.frozen - 3), to = this.n - 6
      const o = outlineOf(this.pts, from, to, chunkOptions(this.opts, from === 0, false))
      if (o.length > 2) {
        const ctx = L.actx
        ctx.save()
        L.clipPage(ctx, v, this.box)
        L.pageTransform(ctx, v, this.box)
        ctx.fillStyle = this.fillStyle(ctx, k)
        ctx.fill(pathFromOutline(o))
        ctx.restore()
        L.aDirty = true
      }
      this.frozen = to
    }
    L.clearTail()
    const ctx = L.bctx
    ctx.save()
    L.clipPage(ctx, v, this.box)
    L.pageTransform(ctx, v, this.box)
    ctx.fillStyle = this.fillStyle(ctx, k)
    if (isDot(this.pts, this.n, this.spec.width) && !predicted?.length) {
      const r = dotRadius(this.opts, this.pts[2]!)
      const x = this.pts[0]!, y = this.pts[1]!
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fill()
      L.tail = [Math.floor(ox + (x - r) * k) - 2, Math.floor(oy + (y - r) * k) - 2, Math.ceil(ox + (x + r) * k) + 2, Math.ceil(oy + (y + r) * k) + 2]
    } else {
      const from = Math.max(0, this.frozen - 3)
      let extra: number[] | null = null
      if (predicted?.length) {
        extra = []
        for (const p of predicted.slice(0, 3)) extra.push(v.vx + p.x / v.s - this.box.x, v.vy + p.y / v.s - this.box.y, this.lastP)
      }
      const o = outlineOf(this.pts, from, this.n, chunkOptions(this.opts, from === 0, false), extra)
      if (o.length > 2) {
        ctx.fill(pathFromOutline(o))
        L.tail = devRect(o, k, ox, oy)
      }
    }
    ctx.restore()
    L.bDirty = true
    if (!this.firstDrawn) {
      this.firstDrawn = true
      this.eng.inkStarted(this.tool === 'highlighter' ? 'highlighter' : 'pen', this.down.x, this.down.y)
    }
  }

  /** 잠긴 모양(곧게 · 도형)을 다시 그린다 */
  private renderAll(): void {
    const L = this.eng.live
    L.clear()
    this.frozen = 0
    const v = this.eng.view
    const k = v.s * v.dpr
    const ctx = L.actx
    ctx.save()
    L.clipPage(ctx, v, this.box)
    L.pageTransform(ctx, v, this.box)
    ctx.fillStyle = this.fillStyle(ctx, k)
    ctx.fill(pathFromOutline(outlineOf(this.pts, 0, this.n, { ...this.opts, last: true })))
    ctx.restore()
    L.aDirty = true
  }

  up(pt: InPt | null): void {
    if (this.done) return
    this.done = true
    clearTimeout(this.holdTimer)
    clearTimeout(this.pieTimer)
    this.eng.ringStop()
    if (this.morph) cancelAnimationFrame(this.morph.raf)
    if (pt && !this.locked && !this.straightLocked && (pt.x !== this.last.x || pt.y !== this.last.y)) this.add(pt, true)
    let points: Float32Array = this.pts.slice(0, this.n * 4)
    let shape: InkStroke['shape'] = null
    if (this.locked) {
      points = shapePoints(shapeVertices(this.locked), this.pts[3]!, this.pts[(this.n - 1) * 4 + 3]!)
      shape = { kind: this.locked.kind, params: this.locked.params }
    } else if (this.isHL && this.spec.straight && (this.straightLocked || this.nearlyStraight())) {
      if (!this.straightLocked) this.straighten()
      points = this.pts.slice(0, this.n * 4)
    } else if (!this.isHL && this.spec.shapeOnce) {
      const fit = recognize(this.pts, this.n, this.eng.view.s)
      if (fit) {
        points = shapePoints(shapeVertices(fit), this.pts[3]!, this.pts[(this.n - 1) * 4 + 3]!)
        shape = { kind: fit.kind, params: fit.params }
      }
      this.eng.shapeOnceUsed()
    }
    const now = Date.now()
    const row: InkStroke = {
      id: uid('st'),
      pageId: this.pm.id,
      layer: this.isHL ? 'highlight' : 'ink',
      tool: this.tool,
      pen: this.tool === 'pen' ? (this.spec.kind === 'fountain' ? 'fountain' : 'ball') : null,
      color: this.spec.color,
      width: this.spec.width,
      points: packPoints(points),
      bbox: strokeBBox(points, this.spec.width),
      shape,
      createdAt: this.createdAt,
      updatedAt: now,
      deletedAt: null,
    }
    // 긁어 지우기 (펜 도구만, 도형이 아닐 때)
    if (!this.isHL && !shape && this.spec.scratch) {
      const hit = scratchTargets(this.pm, points, this.n, row)
      if (hit.length) {
        this.eng.scratchErase(this.pm, this.box, row, hit)
        this.eng.inkEnded(this.last.x, this.last.y)
        return
      }
    }
    this.eng.commitStroke(this.pm, row)
    this.eng.live.clear()
    this.eng.inkEnded(this.last.x, this.last.y)
  }

  cancel(): void {
    if (this.done) return
    this.done = true
    clearTimeout(this.holdTimer)
    clearTimeout(this.pieTimer)
    this.eng.ringStop()
    if (this.morph) cancelAnimationFrame(this.morph.raf)
    this.eng.live.clear()
    this.eng.inkEnded(this.last.x, this.last.y)
  }
}

function resampleN(xy: number[], N: number): number[] {
  const n = xy.length >> 1
  if (n < 2) {
    const out: number[] = []
    for (let i = 0; i < N; i++) out.push(xy[0] ?? 0, xy[1] ?? 0)
    return out
  }
  const acc = [0]
  for (let i = 1; i < n; i++) acc.push(acc[i - 1]! + Math.hypot(xy[i * 2]! - xy[i * 2 - 2]!, xy[i * 2 + 1]! - xy[i * 2 - 1]!))
  const L = acc[n - 1]! || 1
  const out: number[] = []
  let j = 1
  for (let i = 0; i < N; i++) {
    const d = (i / (N - 1)) * L
    while (j < n - 1 && acc[j]! < d) j++
    const a = acc[j - 1]!, b = acc[j]!
    const f = b > a ? (d - a) / (b - a) : 0
    out.push(xy[(j - 1) * 2]! + (xy[j * 2]! - xy[(j - 1) * 2]!) * f, xy[(j - 1) * 2 + 1]! + (xy[j * 2 + 1]! - xy[(j - 1) * 2 + 1]!) * f)
  }
  return out
}

/* ---------- 긁어 지우기 판정 (design-ink 4-3) ---------- */

function convexHull(xy: number[]): number[] {
  const pts: Array<[number, number]> = []
  for (let i = 0; i + 1 < xy.length; i += 2) pts.push([xy[i]!, xy[i + 1]!])
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (pts.length < 3) return xy.slice()
  const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: Array<[number, number]> = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper: Array<[number, number]> = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]!
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop()
    upper.push(p)
  }
  upper.pop()
  lower.pop()
  return [...lower, ...upper].flat()
}

/** 볼록 다각형을 d만큼 바깥으로 (꼭짓점을 중심에서 밀어내는 근사) */
function inflate(hull: number[], d: number): number[] {
  let cx = 0, cy = 0
  const n = hull.length >> 1
  for (let i = 0; i < n; i++) {
    cx += hull[i * 2]! / n
    cy += hull[i * 2 + 1]! / n
  }
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const x = hull[i * 2]!, y = hull[i * 2 + 1]!
    const L = Math.hypot(x - cx, y - cy) || 1
    out.push(x + ((x - cx) / L) * d, y + ((y - cy) / L) * d)
  }
  return out
}

export function scratchTargets(pm: PageModel, pts: Float32Array, n: number, row: InkStroke): StrokeModel[] {
  if (n < 8) return []
  const dur = pts[(n - 1) * 4 + 3]! - pts[3]!
  if (dur > T.scratchMaxMs) return []
  const bb = bboxOfPoints(pts, 4, 0, n * 4)
  const diag = Math.hypot(bb[2] - bb[0], bb[3] - bb[1])
  let L = 0
  for (let i = 1; i < n; i++) L += Math.hypot(pts[i * 4]! - pts[i * 4 - 4]!, pts[i * 4 + 1]! - pts[i * 4 - 3]!)
  if (diag < 4 || L < diag * T.scratchDensity) return []
  // 긴 축(주성분)에 투영해서 뒤집힘 세기 (폭 ≥ 6pt)
  let mx = 0, my = 0
  for (let i = 0; i < n; i++) {
    mx += pts[i * 4]! / n
    my += pts[i * 4 + 1]! / n
  }
  let sxx = 0, syy = 0, sxy = 0
  for (let i = 0; i < n; i++) {
    const dx = pts[i * 4]! - mx, dy = pts[i * 4 + 1]! - my
    sxx += dx * dx
    syy += dy * dy
    sxy += dx * dy
  }
  const th = 0.5 * Math.atan2(2 * sxy, sxx - syy)
  const ux = Math.cos(th), uy = Math.sin(th)
  // 히스테리시스: 극점에서 6pt 넘게 되돌아오면 뒤집힘 1번
  let rev = 0, dir = 0, ext = (pts[0]! - mx) * ux + (pts[1]! - my) * uy
  const span = T.scratchReversalSpan
  for (let i = 1; i < n; i++) {
    const u = (pts[i * 4]! - mx) * ux + (pts[i * 4 + 1]! - my) * uy
    if (dir === 0) {
      if (u - ext >= span) {
        dir = 1
        ext = u
      } else if (ext - u >= span) {
        dir = -1
        ext = u
      }
    } else if (dir === 1) {
      if (u > ext) ext = u
      else if (ext - u >= span) {
        rev++
        dir = -1
        ext = u
      }
    } else {
      if (u < ext) ext = u
      else if (u - ext >= span) {
        rev++
        dir = 1
        ext = u
      }
    }
  }
  if (rev < T.scratchReversals) return []
  const xy: number[] = []
  for (let i = 0; i < n; i++) xy.push(pts[i * 4]!, pts[i * 4 + 1]!)
  const hull = inflate(convexHull(xy), T.scratchHullPad + row.width / 2)
  const hb = bboxOfPoints(hull, 2)
  const out: StrokeModel[] = []
  for (const m of pm.query(hb)) {
    if (m.hidden) continue
    const N = m.n
    if (!N) continue
    const step = Math.max(1, Math.floor(N / 48))
    let inside = 0, total = 0
    for (let i = 0; i < N; i += step) {
      total++
      if (pointInPoly(m.pts[i * 4]!, m.pts[i * 4 + 1]!, hull)) inside++
    }
    if (inside / total >= T.scratchCover) out.push(m)
  }
  return out
}

/* ---------- 지우개 ---------- */

/** 획이 캡슐(선분 a–b, 반지름 r)에 닿는가 */
function hitsCapsule(m: StrokeModel, ax: number, ay: number, bx: number, by: number, r: number): boolean {
  const pts = m.pts
  const n = m.n
  const rr = r + m.row.width * 0.5
  const r2 = rr * rr
  if (n === 1) return distSqToSeg(pts[0]!, pts[1]!, ax, ay, bx, by) <= r2
  const x0 = Math.min(ax, bx) - rr, x1 = Math.max(ax, bx) + rr, y0 = Math.min(ay, by) - rr, y1 = Math.max(ay, by) + rr
  for (let i = 1; i < n; i++) {
    const px = pts[i * 4 - 4]!, py = pts[i * 4 - 3]!, qx = pts[i * 4]!, qy = pts[i * 4 + 1]!
    if ((px < x0 && qx < x0) || (px > x1 && qx > x1) || (py < y0 && qy < y0) || (py > y1 && qy > y1)) continue
    if (segSegDistSq(px, py, qx, qy, ax, ay, bx, by) <= r2) return true
  }
  return false
}

/** 부분 지우기: 캡슐 안 구간을 잘라 조각들(stride 4)로. 안 닿으면 null */
export function splitStroke(m: StrokeModel, ax: number, ay: number, bx: number, by: number, r: number): Float32Array[] | null {
  if (!hitsCapsule(m, ax, ay, bx, by, r)) return null
  const rr = r + m.row.width * 0.5
  const r2 = rr * rr
  const src = m.pts
  const n = m.n
  const step = Math.max(0.35, Math.min(rr / 3, 1.5))
  // 촘촘하게
  const dense: number[] = []
  for (let i = 0; i < n; i++) {
    if (i) {
      const px = src[i * 4 - 4]!, py = src[i * 4 - 3]!, qx = src[i * 4]!, qy = src[i * 4 + 1]!
      const L = Math.hypot(qx - px, qy - py)
      const k = Math.floor(L / step)
      for (let j = 1; j < k; j++) {
        const f = j / k
        dense.push(px + (qx - px) * f, py + (qy - py) * f, src[i * 4 - 2]! + (src[i * 4 + 2]! - src[i * 4 - 2]!) * f, src[i * 4 - 1]! + (src[i * 4 + 3]! - src[i * 4 - 1]!) * f)
      }
    }
    dense.push(src[i * 4]!, src[i * 4 + 1]!, src[i * 4 + 2]!, src[i * 4 + 3]!)
  }
  const N = dense.length >> 2
  const pieces: Float32Array[] = []
  let run: number[] = []
  for (let i = 0; i < N; i++) {
    const inside = distSqToSeg(dense[i * 4]!, dense[i * 4 + 1]!, ax, ay, bx, by) <= r2
    if (!inside) {
      run.push(dense[i * 4]!, dense[i * 4 + 1]!, dense[i * 4 + 2]!, dense[i * 4 + 3]!)
    } else if (run.length) {
      if (run.length >= 8) pieces.push(new Float32Array(run))
      run = []
    }
  }
  if (run.length >= 8) pieces.push(new Float32Array(run))
  // 너무 짧은 조각(<0.6pt)은 버린다
  return pieces.filter((p) => {
    let L = 0
    for (let i = 4; i < p.length; i += 4) L += Math.hypot(p[i]! - p[i - 4]!, p[i + 1]! - p[i - 3]!)
    return L >= 0.6
  })
}

export class EraserSession implements Session {
  readonly kind = 'eraser'
  readonly usesLive = false
  private last: [number, number]
  /** 이 세션 전부터 있던 것 중 지운 것 (원래 행) */
  private originals = new Map<string, InkStroke>()
  /** 이 세션에서 생긴 조각 (살아 있는 것) */
  private pieces = new Map<string, InkStroke>()
  private r: number

  constructor(
    private eng: InkEngine,
    private pm: PageModel,
    private box: PageBox,
    private mode: 'stroke' | 'partial',
    size: number,
    first: InPt,
  ) {
    this.r = size / 2
    this.last = this.toPage(first)
    this.erase(this.last[0], this.last[1], this.last[0], this.last[1])
    eng.cursor(first.x, first.y, first.type)
  }

  private toPage(p: InPt): [number, number] {
    const v = this.eng.view
    return [v.vx + p.x / v.s - this.box.x, v.vy + p.y / v.s - this.box.y]
  }

  private erase(ax: number, ay: number, bx: number, by: number): void {
    const r = this.r
    const q: BBox = [Math.min(ax, bx) - r - 8, Math.min(ay, by) - r - 8, Math.max(ax, bx) + r + 8, Math.max(ay, by) + r + 8]
    const cands = this.pm.query(q)
    const now = Date.now()
    const remove: InkStroke[] = []
    const add: InkStroke[] = []
    const fading: StrokeModel[] = []
    for (const m of cands) {
      if (m.hidden) continue
      if (this.mode === 'stroke') {
        if (!hitsCapsule(m, ax, ay, bx, by, r)) continue
        if (this.pieces.has(m.id)) this.pieces.delete(m.id)
        else this.originals.set(m.id, m.row)
        remove.push(deleted(m.row, now))
        fading.push(m)
      } else {
        const parts = splitStroke(m, ax, ay, bx, by, r)
        if (!parts) continue
        if (this.pieces.has(m.id)) this.pieces.delete(m.id)
        else this.originals.set(m.id, m.row)
        remove.push(deleted(m.row, now))
        for (const p of parts) {
          const row: InkStroke = {
            ...m.row,
            id: uid('st'),
            points: packPoints(p),
            bbox: strokeBBox(p, m.row.width),
            shape: m.row.shape ? { kind: 'polyline', params: [] } : null,
            updatedAt: now,
            deletedAt: null,
          }
          this.pieces.set(row.id, row)
          add.push(row)
        }
      }
    }
    if (remove.length || add.length) {
      if (fading.length) this.eng.fadeStrokes(this.pm, fading, 'out', 120)
      this.eng.doc.apply({ strokes: [...remove, ...add] })
    }
  }

  move(pts: InPt[]): void {
    for (const p of pts) {
      const q = this.toPage(p)
      this.erase(this.last[0], this.last[1], q[0], q[1])
      this.last = q
    }
    const lp = pts[pts.length - 1]
    if (lp) this.eng.cursor(lp.x, lp.y, lp.type)
  }

  up(): void {
    this.eng.cursor(null)
    const now = Date.now()
    if (!this.originals.size && !this.pieces.size) return
    const before: InkStroke[] = [...this.originals.values()].map((r) => ({ ...r, updatedAt: now }))
    const after: InkStroke[] = [...this.originals.values()].map((r) => deleted(r, now))
    for (const p of this.pieces.values()) {
      before.push(deleted(p, now))
      after.push(p)
    }
    this.eng.pushCommand({ label: 'erase', before: { strokes: before }, after: { strokes: after }, pageId: this.pm.id }, true)
  }

  cancel(): void {
    this.up()
  }
}

/* ---------- 올가미 ---------- */

export class LassoSession implements Session {
  readonly kind = 'lasso'
  readonly usesLive = true
  private poly: number[] = []
  private travel = 0
  private lastS: [number, number]

  constructor(
    private eng: InkEngine,
    private pm: PageModel,
    private box: PageBox,
    first: InPt,
  ) {
    this.lastS = [first.x, first.y]
    this.push(first)
  }

  private push(p: InPt): void {
    const v = this.eng.view
    this.poly.push(v.vx + p.x / v.s - this.box.x, v.vy + p.y / v.s - this.box.y)
    this.travel += Math.hypot(p.x - this.lastS[0], p.y - this.lastS[1])
    this.lastS = [p.x, p.y]
  }

  move(pts: InPt[]): void {
    for (const p of pts) this.push(p)
    this.eng.drawLasso(this.box, this.poly)
  }

  up(pt: InPt | null): void {
    this.eng.live.clear()
    if (this.travel < T.tapMove || this.poly.length < 6) {
      // 누르기: 그 자리 물건 · 획 묶음
      const x = this.poly[0]!, y = this.poly[1]!
      const hit = this.eng.hitAt(this.pm, x, y, T.emptyRadius / this.eng.view.s)
      if (hit?.item) this.eng.select(this.pm, [], [hit.item.id])
      else if (hit?.stroke) this.eng.select(this.pm, this.eng.clusterOf(this.pm, hit.stroke).map((m) => m.id), [])
      else this.eng.clearSelection()
      void pt
      return
    }
    const poly = this.poly
    const bb = bboxOfPoints(poly, 2)
    const strokes: string[] = []
    for (const m of this.pm.query(bb)) {
      const N = m.n
      const step = Math.max(1, Math.floor(N / 64))
      let inside = 0, total = 0
      for (let i = 0; i < N; i += step) {
        total++
        if (pointInPoly(m.pts[i * 4]!, m.pts[i * 4 + 1]!, poly)) inside++
      }
      if (total && inside / total >= 0.5) strokes.push(m.id)
    }
    const items: string[] = []
    for (const it of this.pm.items.values()) {
      const c = mApply(itemMatrixOf(it), it.w / 2, it.h / 2)
      if (pointInPoly(c[0], c[1], poly)) items.push(it.id)
    }
    if (strokes.length || items.length) this.eng.select(this.pm, strokes, items)
    else this.eng.clearSelection()
  }

  cancel(): void {
    this.eng.live.clear()
  }
}

function itemMatrixOf(it: InkItem): Mat {
  const c = Math.cos(it.rot || 0), s = Math.sin(it.rot || 0)
  const cx = it.x + it.w / 2, cy = it.y + it.h / 2
  return [c, s, -s, c, cx - c * (it.w / 2) + s * (it.h / 2), cy - s * (it.w / 2) - c * (it.h / 2)]
}

/* ---------- 고른 것 끌기 (옮기기 · 크기 · 회전) ---------- */

export type Handle = 'move' | 'nw' | 'ne' | 'se' | 'sw' | 'rot'

export class SelectDragSession implements Session {
  readonly kind = 'select'
  readonly usesLive = true
  private p0: [number, number]
  private m: Mat = IDENT
  private moved = 0
  private start: InPt

  constructor(
    private eng: InkEngine,
    private handle: Handle,
    first: InPt,
  ) {
    this.start = first
    this.p0 = eng.toSelPage(first.x, first.y)
  }

  move(pts: InPt[]): void {
    const p = pts[pts.length - 1]
    if (!p) return
    this.moved = Math.max(this.moved, Math.hypot(p.x - this.start.x, p.y - this.start.y))
    if (this.moved < T.tapMove && this.handle === 'move') return
    const sel = this.eng.sel
    if (!sel) return
    const q = this.eng.toSelPage(p.x, p.y)
    const corners = this.eng.selCorners()
    let m: Mat = IDENT
    if (this.handle === 'move') {
      m = translate(q[0] - this.p0[0], q[1] - this.p0[1])
    } else if (this.handle === 'rot') {
      const c = this.eng.selCenter()
      let a = Math.atan2(q[1] - c[1], q[0] - c[0]) - Math.atan2(this.p0[1] - c[1], this.p0[0] - c[0])
      // 자석: 전체 각도가 15°의 배수 ±3° 안이면 붙인다
      const total = matAngle(sel.m) + a
      const step = (T.rotateSnapStep * Math.PI) / 180
      const snapped = Math.round(total / step) * step
      if (Math.abs(total - snapped) < (T.rotateSnapWithin * Math.PI) / 180) a = snapped - matAngle(sel.m)
      m = rotateAt(a, c[0], c[1])
    } else {
      const idx = { nw: 0, ne: 1, se: 2, sw: 3 }[this.handle]
      const fixed = corners[(idx + 2) % 4]!
      const d0 = Math.hypot(this.p0[0] - fixed[0], this.p0[1] - fixed[1]) || 1
      // 대각선 방향 성분만 (비율 유지)
      const ux = (this.p0[0] - fixed[0]) / d0, uy = (this.p0[1] - fixed[1]) / d0
      const d = (q[0] - fixed[0]) * ux + (q[1] - fixed[1]) * uy
      const f = clamp(d / d0, 0.05, 50)
      m = scaleAt(f, f, fixed[0], fixed[1])
    }
    this.m = m
    this.eng.dragSelection(m)
  }

  up(): void {
    if (isIdentity(this.m)) {
      this.eng.dragSelection(null)
      return
    }
    this.eng.commitSelectionTransform(this.m)
  }

  cancel(): void {
    this.eng.dragSelection(null)
  }
}

/** 행 변환 (닮음 변환) */
export function transformStrokeRow(r: InkStroke, m: Mat, now: number): InkStroke {
  const src = new Float32Array(r.points)
  const out = new Float32Array(src.length)
  for (let i = 0; i + 3 < src.length; i += 4) {
    const [x, y] = mApply(m, src[i]!, src[i + 1]!)
    out[i] = x
    out[i + 1] = y
    out[i + 2] = src[i + 2]!
    out[i + 3] = src[i + 3]!
  }
  const k = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]))
  const width = r.width * k
  return { ...r, points: out.buffer, width, bbox: strokeBBox(out, width), shape: transformShape(r.shape ?? null, m), updatedAt: now }
}

export function transformItemRow(it: InkItem, m: Mat, now: number): InkItem {
  const k = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]))
  const [cx, cy] = mApply(m, it.x + it.w / 2, it.y + it.h / 2)
  const w = it.w * k, h = it.h * k
  return { ...it, x: cx - w / 2, y: cy - h / 2, w, h, rot: (it.rot || 0) + matAngle(m), fontSize: it.kind === 'text' ? (it.fontSize ?? 12) * k : it.fontSize, updatedAt: now }
}

export { mul }

/* ---------- 테이프 긋기 ---------- */

export class TapeSession implements Session {
  readonly kind = 'tape'
  readonly usesLive = true
  private a: [number, number]
  private b: [number, number]
  private moved = 0
  private start: InPt

  constructor(
    private eng: InkEngine,
    private pm: PageModel,
    private box: PageBox,
    private color: string,
    private width: number,
    first: InPt,
  ) {
    this.start = first
    this.a = this.b = this.toPage(first)
  }

  private toPage(p: InPt): [number, number] {
    const v = this.eng.view
    return [v.vx + p.x / v.s - this.box.x, v.vy + p.y / v.s - this.box.y]
  }

  /** 테이프 사각형: 긴 축을 따라, 길이 = 양 끝 + 앞뒤 4pt, ±8° 안이면 수평 */
  rect(): { x: number; y: number; w: number; h: number; rot: number } | null {
    const [ax, ay] = this.a, [bx, by] = this.b
    let ang = Math.atan2(by - ay, bx - ax)
    if (ang > Math.PI / 2) ang -= Math.PI
    if (ang < -Math.PI / 2) ang += Math.PI
    if (Math.abs(ang) <= (8 * Math.PI) / 180) ang = 0
    const L = Math.hypot(bx - ax, by - ay) + 8
    const h = this.width
    if (L < h) return null
    const cx = (ax + bx) / 2, cy = ang === 0 ? ay + (by - ay) / 2 : (ay + by) / 2
    return { x: cx - L / 2, y: cy - h / 2, w: L, h, rot: ang }
  }

  move(pts: InPt[]): void {
    const p = pts[pts.length - 1]
    if (!p) return
    this.moved = Math.max(this.moved, Math.hypot(p.x - this.start.x, p.y - this.start.y))
    this.b = this.toPage(p)
    const r = this.rect()
    this.eng.drawTapePreview(this.box, r, tapeColor(this.color, this.eng.r.views.get(this.pm.id)?.spec.dark ?? this.eng.night))
  }

  up(): void {
    this.eng.live.clear()
    if (this.moved < T.tapMove) {
      this.eng.tapPage(this.pm, this.a[0], this.a[1], 'tape')
      return
    }
    const r = this.rect()
    if (!r) return
    this.eng.addTape(this.pm, r, this.color)
  }

  cancel(): void {
    this.eng.live.clear()
  }
}

/* ---------- 이동 (손 도구 · 가운데 단추 · Space) ---------- */

export class PanSession implements Session {
  readonly kind = 'pan'
  readonly usesLive = false
  private last: InPt
  private samples: Array<[number, number, number]> = []
  constructor(
    private eng: InkEngine,
    first: InPt,
  ) {
    this.last = first
    eng.view.stop()
  }
  move(pts: InPt[]): void {
    const p = pts[pts.length - 1]
    if (!p) return
    this.eng.view.scrollBy(this.last.x - p.x, this.last.y - p.y)
    this.samples.push([p.x, p.y, p.ts])
    if (this.samples.length > 6) this.samples.shift()
    this.last = p
    this.eng.viewChanged(true)
  }
  up(): void {
    const s = this.samples
    if (s.length >= 2) {
      const a = s[0]!, b = s[s.length - 1]!
      const dt = b[2] - a[2]
      if (dt > 0 && dt < 120) this.eng.view.fling(-(b[0] - a[0]) / dt, -(b[1] - a[1]) / dt)
    }
    this.eng.viewChanged(false)
  }
  cancel(): void {
    this.eng.viewChanged(false)
  }
}

/* ---------- 둥근 메뉴 (끌어 고르기) ---------- */

export class PieSession implements Session {
  readonly kind = 'pie'
  readonly usesLive = false
  constructor(private eng: InkEngine) {}
  move(pts: InPt[]): void {
    const p = pts[pts.length - 1]
    if (p) this.eng.pieEvent('move', p.x, p.y, p.type)
  }
  up(pt: InPt | null): void {
    this.eng.pieEvent('up', pt?.x ?? NaN, pt?.y ?? NaN, pt?.type ?? '')
  }
  cancel(): void {
    this.eng.pieEvent('cancel', NaN, NaN, '')
  }
}

/* ---------- 누르기 판정 (테이프 · 글 상자 · 사진 위에서 시작) ---------- */

/** 6px 넘게 움직이면 다른 세션으로 넘긴다(버퍼한 점을 이어 준다). 그 전에 떼면 누르기. */
export class TapSession implements Session {
  readonly kind = 'tap'
  readonly usesLive = false
  private buf: InPt[] = []
  private inner: Session | null = null
  private longTimer = 0
  constructor(
    private first: InPt,
    private onTap: (p: InPt) => void,
    private toDrag: (first: InPt) => Session | null,
    longMs = 0,
    private onLong: ((p: InPt) => void) | null = null,
  ) {
    if (longMs && onLong) this.longTimer = window.setTimeout(() => this.fireLong(), longMs)
  }
  get usesLiveNow(): boolean {
    return !!this.inner?.usesLive
  }
  private fireLong(): void {
    this.longTimer = 0
    if (this.inner) return
    this.inner = { kind: 'done', usesLive: false, move() {}, up() {}, cancel() {} }
    this.onLong?.(this.first)
  }
  move(pts: InPt[], predicted: InPt[] | null): void {
    if (this.inner) return this.inner.move(pts, predicted)
    this.buf.push(...pts)
    const p = pts[pts.length - 1]
    if (p && Math.hypot(p.x - this.first.x, p.y - this.first.y) >= T.tapMove) {
      clearTimeout(this.longTimer)
      this.inner = this.toDrag(this.first) ?? { kind: 'none', usesLive: false, move() {}, up() {}, cancel() {} }
      this.inner.move(this.buf, predicted)
    }
  }
  up(pt: InPt | null): void {
    clearTimeout(this.longTimer)
    if (this.inner) return this.inner.up(pt)
    this.onTap(pt ?? this.first)
  }
  cancel(): void {
    clearTimeout(this.longTimer)
    this.inner?.cancel()
  }
}

export { StrokeModel, mul as matMul }
