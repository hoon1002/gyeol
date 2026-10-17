/**
 * 입력 길잡이: PointerEvent(펜 압력·기울기, coalesced·predicted) → 도구 세션 · 손가락 제스처.
 * 펜만 쓰기: 펜이 한 번이라도 오면 손가락은 이동·확대·탭만. 손바닥: 큰 접점 · 펜이 닿아 있는 동안 · 펜 뗀 뒤 300ms 근처는 버린다.
 * 휠·트랙패드: 이동, ⌘/Ctrl + 휠 · 핀치 = 확대. Safari gesture*도 막고 확대로 쓴다.
 */
import { INK_THRESHOLDS as T } from './thresholds'
import { Gestures } from './gestures'
import type { InkEngine } from '../engine'
import { PanSession, type InPt, type Session } from '../tools'

interface Ptr {
  id: number
  type: string
  role: 'draw' | 'gesture' | 'ignore'
  x0: number
  y0: number
  t0: number
}

function isEditable(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  if (!el || !el.closest) return false
  return !!el.closest('textarea, input, select, [contenteditable=""], [contenteditable="true"], [data-ink-ui]')
}

function altitudeOf(e: PointerEvent): number {
  const a = (e as PointerEvent & { altitudeAngle?: number }).altitudeAngle
  if (typeof a === 'number' && Number.isFinite(a)) return a
  if (!e.tiltX && !e.tiltY) return Math.PI / 2
  const tx = Math.tan((e.tiltX * Math.PI) / 180), ty = Math.tan((e.tiltY * Math.PI) / 180)
  return Math.atan(1 / Math.hypot(tx, ty))
}

export class InputRouter {
  private ptrs = new Map<number, Ptr>()
  session: Session | null = null
  private sessionPtr = -1
  private sessionType = ''
  private sessionT0 = 0
  penDown = false
  private lastPenUp = -1e9
  private lastPenPt: [number, number] = [0, 0]
  gest: Gestures
  spaceHeld = false
  private off: Array<() => void> = []

  constructor(
    private eng: InkEngine,
    private host: HTMLElement,
  ) {
    this.gest = new Gestures(eng)
  }

  attach(): void {
    const h = this.host
    const on = <K extends keyof HTMLElementEventMap>(el: HTMLElement | Window, type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      el.addEventListener(type, fn as EventListener, opts)
      this.off.push(() => el.removeEventListener(type, fn as EventListener, opts))
    }
    on(h, 'pointerdown', (e) => this.onDown(e))
    on(h, 'pointermove', (e) => this.onMove(e))
    on(h, 'pointerup', (e) => this.onUp(e, false))
    on(h, 'pointercancel', (e) => this.onUp(e, true))
    on(h, 'pointerleave', (e) => {
      if (e.pointerType !== 'touch' && !this.ptrs.has(e.pointerId)) this.eng.hover(null)
    })
    on(h, 'wheel', (e) => this.onWheel(e), { passive: false })
    on(h, 'contextmenu', (e) => {
      if (isEditable(e.target)) return
      e.preventDefault()
    })
    // iOS: 길게 누르기 돋보기 · 두 번 눌러 확대 · 스크롤 막기 (글 상자 편집은 그대로)
    const stopTouch = (e: TouchEvent) => {
      if (!isEditable(e.target) && e.cancelable) e.preventDefault()
    }
    on(h, 'touchstart', stopTouch, { passive: false })
    on(h, 'touchmove', stopTouch, { passive: false })
    // Safari 트랙패드 핀치
    let gs = 1
    const gstart = (e: Event) => {
      e.preventDefault()
      gs = 1
    }
    const gchange = (e: Event) => {
      e.preventDefault()
      const ge = e as Event & { scale: number; clientX: number; clientY: number }
      const v = this.eng.view
      const [lx, ly] = this.eng.toLocal(ge.clientX, ge.clientY)
      v.zoomAt(Math.max(v.fit, v.s * (ge.scale / gs)), lx, ly)
      gs = ge.scale
      this.eng.viewChanged(true)
    }
    const gend = (e: Event) => {
      e.preventDefault()
      this.eng.viewChanged(false)
    }
    h.addEventListener('gesturestart', gstart)
    h.addEventListener('gesturechange', gchange)
    h.addEventListener('gestureend', gend)
    this.off.push(() => {
      h.removeEventListener('gesturestart', gstart)
      h.removeEventListener('gesturechange', gchange)
      h.removeEventListener('gestureend', gend)
    })
  }

  detach(): void {
    this.cancelAll()
    this.off.forEach((f) => f())
    this.off = []
  }

  private toPt(e: PointerEvent): InPt {
    // transform(열리는 중의 scale 등)이 걸려 있어도 레이아웃 좌표로 (엔진 크기는 레이아웃 기준, 사각형은 50ms 캐시)
    const [x, y] = this.eng.toLocal(e.clientX, e.clientY)
    if (e.pointerType === 'pen') this.eng.diag({ lastPen: [Math.round(e.clientX), Math.round(e.clientY), Math.round(x), Math.round(y)] })
    return {
      x,
      y,
      p: e.pressure,
      t: performance.timeOrigin + e.timeStamp,
      ts: e.timeStamp,
      type: e.pointerType,
      alt: altitudeOf(e),
    }
  }

  /** 지금 손가락이 무시 대상인가 (손바닥) */
  private palm(e: PointerEvent, p: InPt): boolean {
    if ((e.width > T.palmSize && e.width > 1) || (e.height > T.palmSize && e.height > 1)) return true
    if (this.penDown) return true
    if (p.ts - this.lastPenUp < T.palmAfterPenMs && Math.hypot(p.x - this.lastPenPt[0], p.y - this.lastPenPt[1]) < T.palmNearPen) return true
    return false
  }

  private onDown(e: PointerEvent): void {
    if (isEditable(e.target)) {
      // 편집 중인 글 상자 밖을 누르면 편집이 끝난다(blur) — 그 누름은 여기서 받지 않는다
      return
    }
    if (this.eng.blocked) return
    this.eng.toLocal(e.clientX, e.clientY, true)
    const p = this.toPt(e)
    this.eng.focusEngine()
    const type = e.pointerType
    if (type === 'pen') {
      this.eng.penSeen()
      for (const q of this.ptrs.values()) if (q.type === 'touch') q.role = 'ignore'
      this.gest.cancelAll()
      this.eng.view.stop()
      this.penDown = true
      if (this.session) this.endSession(true)
      this.startDraw(e, p)
      return
    }
    if (type === 'touch') {
      if (this.palm(e, p)) {
        this.ptrs.set(e.pointerId, { id: e.pointerId, type, role: 'ignore', x0: p.x, y0: p.y, t0: p.ts })
        return
      }
      if (this.eng.penOnly) {
        this.ptrs.set(e.pointerId, { id: e.pointerId, type, role: 'gesture', x0: p.x, y0: p.y, t0: p.ts })
        this.gest.down(e.pointerId, p)
        return
      }
      // 손가락 쓰기: 두 번째 손가락이 곧 오면 쓰던 획을 버리고 제스처로
      if (this.session && this.sessionType === 'touch') {
        const first = this.ptrs.get(this.sessionPtr)
        if (first && p.ts - this.sessionT0 < T.secondFingerMs) {
          this.session.cancel()
          this.session = null
          first.role = 'gesture'
          this.gest.down(first.id, { ...p, x: first.x0, y: first.y0, ts: first.t0 })
          this.sessionPtr = -1
          this.ptrs.set(e.pointerId, { id: e.pointerId, type, role: 'gesture', x0: p.x, y0: p.y, t0: p.ts })
          this.gest.down(e.pointerId, p)
          return
        }
        this.ptrs.set(e.pointerId, { id: e.pointerId, type, role: 'ignore', x0: p.x, y0: p.y, t0: p.ts })
        return
      }
      if (this.session || this.gest.active) {
        this.ptrs.set(e.pointerId, { id: e.pointerId, type, role: this.session ? 'ignore' : 'gesture', x0: p.x, y0: p.y, t0: p.ts })
        if (!this.session) this.gest.down(e.pointerId, p)
        return
      }
      this.startDraw(e, p)
      return
    }
    // 마우스
    if (e.button === 2) {
      e.preventDefault()
      this.eng.contextAt(p)
      return
    }
    if (e.button === 1 || (e.button === 0 && (this.eng.tool === 'hand' || this.spaceHeld))) {
      e.preventDefault()
      this.begin(e, p, new PanSession(this.eng, p))
      return
    }
    if (e.button === 0) this.startDraw(e, p)
  }

  private startDraw(e: PointerEvent, p: InPt): void {
    const s = this.eng.beginSession(p)
    if (!s) {
      this.ptrs.set(e.pointerId, { id: e.pointerId, type: e.pointerType, role: 'ignore', x0: p.x, y0: p.y, t0: p.ts })
      return
    }
    this.begin(e, p, s)
  }

  private begin(e: PointerEvent, p: InPt, s: Session): void {
    this.session = s
    this.sessionPtr = e.pointerId
    this.sessionType = e.pointerType
    this.sessionT0 = p.ts
    this.ptrs.set(e.pointerId, { id: e.pointerId, type: e.pointerType, role: 'draw', x0: p.x, y0: p.y, t0: p.ts })
    try {
      this.host.setPointerCapture(e.pointerId)
    } catch {
      /* 이미 떠남 */
    }
    e.preventDefault()
  }

  /** 세션을 바꾼다(펜 길게 누르기 → 둥근 메뉴 등): 같은 포인터가 계속 이어 받는다 */
  replaceSession(s: Session): void {
    this.session = s
  }

  private onMove(e: PointerEvent): void {
    const q = this.ptrs.get(e.pointerId)
    if (!q) {
      if (e.pointerType !== 'touch' && !e.buttons) {
        this.eng.hover(this.toPt(e))
      }
      return
    }
    if (q.role === 'draw' && this.session && e.pointerId === this.sessionPtr) {
      const t0 = performance.now()
      const ce = e.getCoalescedEvents?.() ?? []
      const list = (ce.length ? ce : [e]).map((x) => this.toPt(x))
      const pe = e.getPredictedEvents?.() ?? []
      const pred = pe.length ? pe.map((x) => this.toPt(x)) : null
      this.session.move(list, pred)
      this.eng.recordInput(performance.now() - t0, e.timeStamp, list.length)
    } else if (q.role === 'gesture') {
      this.gest.move(e.pointerId, this.toPt(e))
    }
  }

  private onUp(e: PointerEvent, cancel: boolean): void {
    const q = this.ptrs.get(e.pointerId)
    if (!q) return
    this.ptrs.delete(e.pointerId)
    const p = this.toPt(e)
    if (q.type === 'pen') {
      this.penDown = false
      this.lastPenUp = p.ts
      this.lastPenPt = [p.x, p.y]
    }
    if (q.role === 'draw' && e.pointerId === this.sessionPtr) {
      const s = this.session
      this.session = null
      this.sessionPtr = -1
      // 시스템이 가로챈 취소(pointercancel)여도 쓴 잉크는 남긴다
      s?.up(cancel ? null : p)
    } else if (q.role === 'gesture') {
      this.gest.up(e.pointerId, p, cancel)
    }
  }

  private endSession(cancel: boolean): void {
    const s = this.session
    this.session = null
    this.sessionPtr = -1
    if (!s) return
    if (cancel) s.cancel()
    else s.up(null)
  }

  private onWheel(e: WheelEvent): void {
    if (isEditable(e.target)) return
    e.preventDefault()
    const [lx, ly] = this.eng.toLocal(e.clientX, e.clientY)
    const v = this.eng.view
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? v.H : 1
    if (e.ctrlKey || e.metaKey) {
      const f = Math.exp(Math.max(-0.25, Math.min(0.25, -e.deltaY * unit * 0.01)))
      v.zoomAt(Math.max(v.fit, v.s * f), lx, ly)
      this.eng.viewChanged(true)
      this.eng.settleSoon()
    } else {
      v.stop()
      v.scrollBy(e.shiftKey && !e.deltaX ? e.deltaY * unit : e.deltaX * unit, e.shiftKey && !e.deltaX ? 0 : e.deltaY * unit)
      this.eng.viewChanged(true)
      this.eng.settleSoon()
    }
  }

  cancelAll(): void {
    this.endSession(true)
    this.gest.cancelAll()
    this.ptrs.clear()
    this.penDown = false
  }
}
