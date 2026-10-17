/**
 * 첫 펜 메모 버퍼 (QA #25): 손글씨 메모 칸(InkPad)이 준비되기 전에 닿은 펜·손가락 점을 받아 두었다가, 준비되면 넘긴다.
 *
 *   const buf = new InkPadBuffer(memoBoxEl)     // 펜이 닿기 전부터(메모 칸을 열 때) 붙인다
 *   <InkPad memoId … pending={buf} />           // 준비되면 받은 획을 그대로 쓰고, 아직 누르고 있으면 이어서 받는다
 *   buf.dispose()                               // 메모 칸을 닫을 때 (앱이 부른다)
 */
export interface BufferedPoint {
  clientX: number
  clientY: number
  pressure: number
  /** epoch ms */
  t: number
  type: string
  tiltX: number
  tiltY: number
}

export interface PadSink {
  move(p: BufferedPoint): void
  up(p: BufferedPoint | null): void
}

export class InkPadBuffer {
  /** 끝난 획들 · 지금 쓰는 획 */
  strokes: BufferedPoint[][] = []
  private cur: BufferedPoint[] | null = null
  private curId = -1
  private sink: PadSink | null = null
  private off: () => void

  constructor(readonly target: HTMLElement) {
    const pt = (e: PointerEvent): BufferedPoint => ({ clientX: e.clientX, clientY: e.clientY, pressure: e.pressure, t: performance.timeOrigin + e.timeStamp, type: e.pointerType, tiltX: e.tiltX, tiltY: e.tiltY })
    const down = (e: PointerEvent) => {
      if (this.cur || (e.pointerType === 'mouse' && e.button !== 0)) return
      this.curId = e.pointerId
      this.cur = [pt(e)]
    }
    const move = (e: PointerEvent) => {
      if (e.pointerId !== this.curId) return
      const list = e.getCoalescedEvents?.() ?? []
      for (const x of list.length ? list : [e]) {
        const p = pt(x)
        if (this.sink) this.sink.move(p)
        else this.cur?.push(p)
      }
    }
    const up = (e: PointerEvent) => {
      if (e.pointerId !== this.curId) return
      this.curId = -1
      if (this.sink) {
        this.sink.up(pt(e))
        this.sink = null
      } else if (this.cur) {
        this.cur.push(pt(e))
        this.strokes.push(this.cur)
      }
      this.cur = null
    }
    const o = { capture: true, passive: true }
    target.addEventListener('pointerdown', down, o)
    window.addEventListener('pointermove', move, o)
    window.addEventListener('pointerup', up, o)
    window.addEventListener('pointercancel', up, o)
    this.off = () => {
      target.removeEventListener('pointerdown', down, o)
      window.removeEventListener('pointermove', move, o)
      window.removeEventListener('pointerup', up, o)
      window.removeEventListener('pointercancel', up, o)
    }
  }

  /** 끝난 획을 넘기고(비운다), 아직 쓰는 획이 있으면 그 점들과 이어 받을 곳을 연결한다 */
  handoff(start: (pts: BufferedPoint[]) => PadSink | null): BufferedPoint[][] {
    const done = this.strokes
    this.strokes = []
    if (this.cur) {
      this.sink = start(this.cur)
      this.cur = null
    }
    return done
  }

  dispose(): void {
    this.off()
    this.sink = null
  }
}
