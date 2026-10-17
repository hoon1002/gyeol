/**
 * 손가락 제스처 (design-ink 4장): 한 손가락 이동(관성) · 두 손가락 이동·확대 · 두 손가락 탭 = 되돌리기(대고 있으면 연속) ·
 * 세 손가락 탭 = 다시하기 · 길게 누르기(빈 곳 = 둥근 메뉴, 잉크·물건 = 고르기) · 왼쪽 가장자리 밀기.
 * 숫자는 thresholds.ts 하나에서.
 */
import { INK_THRESHOLDS as T } from './thresholds'
import type { InkEngine } from '../engine'
import type { InPt, Session } from '../tools'

interface Touch {
  x: number
  y: number
  x0: number
  y0: number
  t0: number
  maxMove: number
}

interface TapGroup {
  t0: number
  downs: number[]
  max: number
  moved: boolean
  pinched: boolean
  held: boolean
  d0: number
}

export class Gestures {
  private touches = new Map<number, Touch>()
  private mode: 'none' | 'pan' | 'pinch' | 'session' | 'edge' | 'dead' = 'none'
  private group: TapGroup | null = null
  private c: [number, number] = [0, 0]
  private d = 0
  private samples: Array<[number, number, number]> = []
  private longTimer = 0
  private holdTimer = 0
  private holdN = 0
  /** 길게 누르기 뒤 이 손가락이 맡은 세션 (둥근 메뉴 · 고른 것 끌기) */
  private session: Session | null = null
  private sessionId = -1
  /** 핀치의 손가락 그대로 배율 (고무줄 전) */
  private raw = 1

  constructor(private eng: InkEngine) {}

  get count(): number {
    return this.touches.size
  }

  get active(): boolean {
    return this.touches.size > 0
  }

  down(id: number, p: InPt): void {
    const now = p.ts
    if (this.mode === 'session' || this.mode === 'dead') {
      // 메뉴 · 끌기 중 다른 손가락: 메뉴는 취소
      if (this.session?.kind === 'pie') {
        this.session.cancel()
        this.session = null
        this.mode = 'dead'
      }
      this.touches.set(id, { x: p.x, y: p.y, x0: p.x, y0: p.y, t0: now, maxMove: 0 })
      return
    }
    if (this.touches.size === 0) {
      this.group = { t0: now, downs: [now], max: 1, moved: false, pinched: false, held: false, d0: 0 }
      this.mode = 'none'
      this.samples = []
      this.eng.view.stop()
    } else if (this.group) {
      this.group.downs.push(now)
      this.group.max = Math.max(this.group.max, this.touches.size + 1)
    }
    this.touches.set(id, { x: p.x, y: p.y, x0: p.x, y0: p.y, t0: now, maxMove: 0 })
    clearTimeout(this.longTimer)
    clearTimeout(this.holdTimer)
    if (this.touches.size === 1) {
      this.longTimer = window.setTimeout(() => this.onLong(id), T.fingerLongMs)
    } else {
      this.baseline()
      if (this.group) this.group.d0 = this.d
      if (this.touches.size === 2 && this.group && !this.group.moved) this.holdTimer = window.setTimeout(() => this.onHold(), T.holdUndoMs)
      if (this.mode === 'pan') this.mode = 'pinch'
    }
  }

  private baseline(): void {
    const pts = [...this.touches.values()]
    const a = pts[0]!, b = pts[1] ?? pts[0]!
    this.c = [(a.x + b.x) / 2, (a.y + b.y) / 2]
    this.d = Math.hypot(a.x - b.x, a.y - b.y)
  }

  private onLong(id: number): void {
    const t = this.touches.get(id)
    if (!t || this.touches.size !== 1 || this.mode !== 'none' || t.maxMove >= T.fingerLongMove) return
    const s = this.eng.fingerLong(t.x, t.y)
    if (s) {
      this.session = s
      this.sessionId = id
      this.mode = 'session'
      if (this.group) this.group.moved = true
    }
  }

  private onHold(): void {
    if (this.touches.size !== 2 || !this.group || this.group.moved || this.group.pinched) return
    this.group.held = true
    const step = () => {
      if (this.touches.size !== 2 || !this.group?.held) return
      this.holdN++
      this.eng.gestureUndo('undo', this.holdN)
      this.holdTimer = window.setTimeout(step, T.holdUndoEvery)
    }
    step()
  }

  move(id: number, p: InPt): void {
    const t = this.touches.get(id)
    if (!t) return
    const px = t.x, py = t.y
    t.x = p.x
    t.y = p.y
    t.maxMove = Math.max(t.maxMove, Math.hypot(p.x - t.x0, p.y - t.y0))
    if (this.mode === 'session') {
      if (id === this.sessionId) this.session?.move([p], null)
      return
    }
    if (this.mode === 'dead' || this.mode === 'edge') return
    const g = this.group
    if (g && t.maxMove >= T.tapFingerMove) g.moved = true
    if (t.maxMove >= T.fingerLongMove) clearTimeout(this.longTimer)
    if (this.touches.size === 1) {
      // 왼쪽 가장자리 밀기
      if (this.mode === 'none' && this.eng.standalone && t.x0 <= T.edgeStartX && p.ts - t.t0 <= T.edgeWithinMs) {
        const dx = p.x - t.x0, dy = p.y - t.y0
        if (dx >= T.edgeMove && Math.abs(dx) > Math.abs(dy) * T.edgeRatio) {
          this.mode = 'edge'
          clearTimeout(this.longTimer)
          this.eng.emit('edgeswipe', { y: t.y0 })
          return
        }
      }
      if (this.mode === 'none' && t.maxMove >= T.scrollSlop) {
        this.mode = 'pan'
        clearTimeout(this.longTimer)
        this.eng.viewChanged(true)
      }
      if (this.mode === 'pan') {
        this.eng.view.scrollBy(px - p.x, py - p.y)
        this.samples.push([p.x, p.y, p.ts])
        if (this.samples.length > 6) this.samples.shift()
        this.eng.viewChanged(true)
      }
      return
    }
    // 두 손가락 이상: 처음 두 점으로 이동 · 확대
    const pts = [...this.touches.values()]
    const a = pts[0]!, b = pts[1]!
    const c: [number, number] = [(a.x + b.x) / 2, (a.y + b.y) / 2]
    const d = Math.hypot(a.x - b.x, a.y - b.y)
    if (this.mode !== 'pinch') {
      const d0 = g?.d0 || d
      if (Math.abs(d / (d0 || 1) - 1) >= T.pinchDist || Math.hypot(c[0] - this.c[0], c[1] - this.c[1]) >= T.panMove) {
        this.mode = 'pinch'
        if (g) g.pinched = true
        clearTimeout(this.holdTimer)
        this.c = c
        this.d = d
        this.raw = this.eng.view.s
        this.eng.viewChanged(true)
      }
      return
    }
    const v = this.eng.view
    if (this.d > 0 && d > 0) {
      // 맞춤 아래는 고무줄: 손가락만큼 다 줄지 않는다
      this.raw *= d / this.d
      const disp = this.raw >= v.fit || v.fixed ? this.raw : v.fit * (1 - (1 - this.raw / v.fit) * T.pinchRubber)
      v.zoomAt(disp, c[0], c[1])
    }
    v.scrollBy(this.c[0] - c[0], this.c[1] - c[1])
    this.c = c
    this.d = d
    this.eng.viewChanged(true)
  }

  up(id: number, p: InPt, cancel: boolean): void {
    const t = this.touches.get(id)
    if (!t) return
    this.touches.delete(id)
    if (this.mode === 'session' && id === this.sessionId) {
      const s = this.session
      this.session = null
      this.sessionId = -1
      if (cancel) s?.cancel()
      else s?.up(p)
      this.mode = this.touches.size ? 'dead' : 'none'
      this.group = null
      return
    }
    if (this.touches.size > 0) {
      // 핀치에서 한 손가락이 남으면 그 손가락으로 이어서 이동
      if (this.mode === 'pinch') {
        this.baseline()
        if (this.touches.size === 1) {
          this.mode = 'pan'
          this.samples = []
        }
      }
      return
    }
    clearTimeout(this.longTimer)
    clearTimeout(this.holdTimer)
    const g = this.group
    this.group = null
    const mode = this.mode
    this.mode = 'none'
    this.holdN = 0
    if (cancel || mode === 'dead' || mode === 'edge') {
      if (mode === 'pan' || mode === 'pinch') this.eng.viewChanged(false)
      return
    }
    // 핀치로 시작한 제스처는 마지막 손가락이 떨어질 때 배율을 정리한다 (한 손가락 이동으로 끝나도)
    if (mode === 'pinch' || (mode === 'pan' && g?.pinched)) {
      const v = this.eng.view
      if (v.zoom < 1 && !v.fixed) {
        if (v.zoom < T.pinchCloseBelow && this.eng.mode === 'note') this.eng.emit('pinchclose', { zoom: v.zoom })
        const [wx, wy] = v.toWorld(v.W / 2, v.H / 2)
        v.animateTo(v.fit, wx - v.W / (2 * v.fit), wy - v.H / (2 * v.fit), T.zoomSnapMs)
      } else v.snapZoom(this.c[0], this.c[1])
      this.eng.viewChanged(false)
      return
    }
    if (mode === 'pan') {
      const s = this.samples
      if (s.length >= 2) {
        const a = s[0]!, b = s[s.length - 1]!
        const dt = b[2] - a[2]
        if (dt > 0 && p.ts - b[2] < 60) this.eng.view.fling(-(b[0] - a[0]) / dt, -(b[1] - a[1]) / dt)
      }
      this.eng.viewChanged(false)
      return
    }
    if (!g || g.moved || g.pinched || g.held) return
    const spread = Math.max(...g.downs) - Math.min(...g.downs)
    const quick = p.ts - g.t0 <= T.multiTapMs + (g.max > 1 ? spread : 0)
    if (g.max === 1) {
      if (p.ts - g.t0 < T.fingerLongMs && t.maxMove < T.tapMove) this.eng.fingerTap(t.x0, t.y0)
      return
    }
    if (!quick) return
    if (g.max === 2 && spread <= T.twoTapDownSpread) this.eng.gestureUndo('undo', 1)
    else if (g.max === 3 && spread <= T.threeTapDownSpread) this.eng.gestureUndo('redo', 1)
  }

  cancelAll(): void {
    clearTimeout(this.longTimer)
    clearTimeout(this.holdTimer)
    if (this.session) {
      this.session.cancel()
      this.session = null
    }
    const was = this.mode
    this.touches.clear()
    this.group = null
    this.mode = 'none'
    if (was === 'pan' || was === 'pinch') this.eng.viewChanged(false)
  }
}
