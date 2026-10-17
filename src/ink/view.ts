/**
 * 손글씨 엔진 — 보기 (쪽 배치 · 확대 · 이동 · 관성). 세계 좌표 = pt, 쪽은 x=0 가운데에 세로로 잇는다.
 * 화면(sx, sy) = ((wx − vx)·s, (wy − vy)·s). 변환은 장치 픽셀에 맞춰 끊는다(잉크가 흐려지지 않게).
 */
import type { Page } from '@/db/schema'
import { clamp } from './geom'
import { INK_THRESHOLDS as T } from './input/thresholds'

export interface PageBox {
  id: string
  x: number
  y: number
  w: number
  h: number
}

export interface LayoutSpec {
  /** 쪽 사이 (CSS px → 맞춤 배율로 나눠 pt로) */
  gap: number
  /** 첫 쪽 위 여백 CSS px */
  top: number
  /** 맞춤 100%의 종이 너비 CSS px */
  paperW: number
  /** 쪽 모서리 CSS px */
  radius: number
}

/** design-ink 1-2: 폰 가장자리까지 · 태블릿 세로 좌우 16 · 가로·데스크톱 1000 */
export function layoutFor(W: number, H: number): LayoutSpec {
  if (W < 600) return { gap: 12, top: 56, paperW: W, radius: 0 }
  const land = W > H
  return { gap: land ? 24 : 20, top: 72, paperW: Math.min(W - 32, 1000), radius: 14 }
}

export class View {
  W = 1
  H = 1
  dpr = 1
  s = 1
  vx = 0
  vy = 0
  fit = 1
  boxes: PageBox[] = []
  contentW = 595
  contentH = 842
  spec: LayoutSpec = layoutFor(1, 1)
  /** pad 모드: 배율 1 고정, 이동 없음 */
  fixed = false

  private flingV: [number, number] | null = null
  private anim: { t0: number; dur: number; from: [number, number, number]; to: [number, number, number] } | null = null
  lastScaleAt = 0
  lastMoveAt = 0

  setSize(W: number, H: number, dpr: number): void {
    this.W = Math.max(1, W)
    this.H = Math.max(1, H)
    this.dpr = dpr || 1
    this.spec = layoutFor(this.W, this.H)
  }

  /** 쪽을 배치한다. 배율은 맞춤 대비 %를 지키고, 화면 가운데 점을 붙든다 */
  layout(pages: Page[], keep = true): void {
    const prevFit = this.fit
    const zoomRel = this.s / (prevFit || 1)
    const cx = this.vx + this.W / (2 * this.s)
    const cy = this.vy + this.H / (2 * this.s)
    const maxW = pages.reduce((m, p) => Math.max(m, p.w), 0) || 595
    this.fit = this.fixed ? 1 : this.spec.paperW / maxW
    const gapPt = this.spec.gap / this.fit
    let y = this.spec.top / this.fit
    if (this.fixed) y = 0
    this.boxes = pages.map((p) => {
      const b = { id: p.id, x: -p.w / 2, y, w: p.w, h: p.h }
      y += p.h + gapPt
      return b
    })
    this.contentW = maxW
    this.contentH = Math.max(1, y - gapPt + (this.fixed ? 0 : 96 / this.fit))
    if (this.fixed) {
      this.s = 1
      this.vx = -maxW / 2
      this.vy = 0
      return
    }
    if (keep && prevFit && Number.isFinite(zoomRel)) {
      this.s = clamp(this.fit * zoomRel, this.minS, this.maxS)
      this.vx = cx - this.W / (2 * this.s)
      this.vy = cy - this.H / (2 * this.s)
    } else {
      this.s = this.fit
      this.vx = -this.W / (2 * this.s)
      this.vy = 0
    }
    this.clampView()
  }

  get minS(): number {
    return this.fit * T.zoomMin
  }
  get maxS(): number {
    return this.fit * T.zoomMax
  }
  get zoom(): number {
    return this.s / this.fit
  }

  clampView(): void {
    const vw = this.W / this.s, vh = this.H / this.s
    const cw = this.contentW + (this.spec.paperW < this.W ? 0 : 0)
    if (cw <= vw) this.vx = -vw / 2
    else this.vx = clamp(this.vx, -cw / 2, cw / 2 - vw)
    if (this.contentH <= vh) this.vy = Math.min(0, (this.contentH - vh) / 2)
    else this.vy = clamp(this.vy, 0, this.contentH - vh)
  }

  /** 화면 px 단위 이동 (손을 따라: 내용이 손과 같은 쪽으로) */
  scrollBy(dx: number, dy: number): void {
    this.vx += dx / this.s
    this.vy += dy / this.s
    this.clampView()
    this.lastMoveAt = performance.now()
  }

  /** (sx, sy) 화면 점을 붙든 채 배율 바꾸기 */
  zoomAt(s: number, sx: number, sy: number): void {
    const ns = clamp(s, this.minS, this.maxS)
    const wx = this.vx + sx / this.s, wy = this.vy + sy / this.s
    this.s = ns
    this.vx = wx - sx / ns
    this.vy = wy - sy / ns
    this.clampView()
    this.lastScaleAt = this.lastMoveAt = performance.now()
  }

  toWorld(sx: number, sy: number): [number, number] {
    return [this.vx + sx / this.s, this.vy + sy / this.s]
  }
  toScreen(wx: number, wy: number): [number, number] {
    return [(wx - this.vx) * this.s, (wy - this.vy) * this.s]
  }

  /** 장치 픽셀에 맞춘 이동량 (CSS px) */
  get tx(): number {
    return Math.round(-this.vx * this.s * this.dpr) / this.dpr
  }
  get ty(): number {
    return Math.round(-this.vy * this.s * this.dpr) / this.dpr
  }

  /** 세계 점이 든 쪽 (여유 tol pt) */
  pageAt(wx: number, wy: number, tol = 0): number {
    const bs = this.boxes
    let lo = 0, hi = bs.length - 1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      const b = bs[mid]!
      if (wy < b.y - tol) hi = mid - 1
      else if (wy > b.y + b.h + tol) lo = mid + 1
      else return wx >= b.x - tol && wx <= b.x + b.w + tol ? mid : -1
    }
    return -1
  }

  /** 화면(+여유 margin CSS px)과 겹치는 쪽 범위 [i0, i1] */
  range(margin = 0): [number, number] {
    const y0 = this.vy - margin / this.s, y1 = this.vy + (this.H + margin) / this.s
    const bs = this.boxes
    let i0 = -1, i1 = -2
    for (let i = 0; i < bs.length; i++) {
      const b = bs[i]!
      if (b.y + b.h >= y0 && b.y <= y1) {
        if (i0 < 0) i0 = i
        i1 = i
      } else if (b.y > y1) break
    }
    return [i0, i1]
  }

  /** 화면 세로 가운데 선이 지나는 쪽 (없으면 가까운 쪽) */
  centerPage(): number {
    const wy = this.vy + this.H / (2 * this.s)
    let best = 0, bd = Infinity
    this.boxes.forEach((b, i) => {
      const d = wy < b.y ? b.y - wy : wy > b.y + b.h ? wy - b.y - b.h : 0
      if (d < bd) {
        bd = d
        best = i
      }
    })
    return best
  }

  /* ---------- 움직임 ---------- */

  fling(vx: number, vy: number): void {
    this.anim = null
    this.flingV = Math.hypot(vx, vy) > 0.05 ? [vx, vy] : null
  }

  stop(): void {
    this.flingV = null
    this.anim = null
  }

  get moving(): boolean {
    return !!this.flingV || !!this.anim
  }

  /** 보기 애니메이션 (s, vx, vy) */
  animateTo(s: number, vx: number, vy: number, dur = 320): void {
    this.flingV = null
    this.anim = { t0: performance.now(), dur, from: [this.s, this.vx, this.vy], to: [s, vx, vy] }
  }

  /** 쪽 맨 위로 */
  scrollToPage(i: number, dur = 420): void {
    const b = this.boxes[i]
    if (!b) return
    const top = b.y - this.spec.gap / this.s
    const vy = clamp(top, 0, Math.max(0, this.contentH - this.H / this.s))
    if (dur <= 0) {
      this.vy = vy
      this.clampView()
      return
    }
    this.animateTo(this.s, this.vx, vy, dur)
  }

  /** 쪽 좌표 상자가 화면에 들게 */
  reveal(i: number, y0: number, y1: number, dur = 320): boolean {
    const b = this.boxes[i]
    if (!b) return false
    const vh = this.H / this.s
    const a = b.y + y0, z = b.y + y1
    if (a >= this.vy && z <= this.vy + vh) return false
    const vy = clamp((a + z) / 2 - vh / 2, 0, Math.max(0, this.contentH - vh))
    this.animateTo(this.s, this.vx, vy, dur)
    return true
  }

  /** 프레임마다: 움직였으면 true */
  step(now: number, dt: number): boolean {
    if (this.anim) {
      const a = this.anim
      const t = clamp((now - a.t0) / a.dur, 0, 1)
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
      const prevS = this.s
      this.s = a.from[0] + (a.to[0] - a.from[0]) * e
      this.vx = a.from[1] + (a.to[1] - a.from[1]) * e
      this.vy = a.from[2] + (a.to[2] - a.from[2]) * e
      this.clampView()
      if (this.s !== prevS) this.lastScaleAt = now
      this.lastMoveAt = now
      if (t >= 1) this.anim = null
      return true
    }
    if (this.flingV) {
      const [vx, vy] = this.flingV
      const d = Math.min(dt, 34)
      const ox = this.vx, oy = this.vy
      this.scrollBy(vx * d, vy * d)
      const k = Math.pow(0.9975, d)
      this.flingV = [vx * k, vy * k]
      if (Math.hypot(vx, vy) < 0.02 || (this.vx === ox && this.vy === oy)) this.flingV = null
      return true
    }
    return false
  }

  /** 뗐을 때 94–106%면 100%로 */
  snapZoom(cx: number, cy: number): void {
    const z = this.zoom
    if (z === 1 || z < T.zoomSnapLo || z > T.zoomSnapHi) return
    const ns = this.fit
    const wx = this.vx + cx / this.s, wy = this.vy + cy / this.s
    const save = { s: this.s, vx: this.vx, vy: this.vy }
    this.s = ns
    this.vx = wx - cx / ns
    this.vy = wy - cy / ns
    this.clampView()
    const to: [number, number, number] = [this.s, this.vx, this.vy]
    this.s = save.s
    this.vx = save.vx
    this.vy = save.vy
    this.animateTo(to[0], to[1], to[2], T.zoomSnapMs)
  }
}
