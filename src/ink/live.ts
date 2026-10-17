/**
 * 손글씨 엔진 — 실시간 층 (화면 크기 캔버스 둘): A = 굳은 조각(쓰는 동안 지우지 않음), B = 끝 꼬리 + 덧층(올가미 · 손잡이 · 지우개 원).
 * 형광펜을 쓸 때는 형광 층과 잉크 층 사이(z 7)로 내려가고 같은 섞기·불투명도를 쓴다 → 뗐을 때 모양이 그대로다.
 */
import type { PaperSpec } from './palette'
import type { PageBox, View } from './view'

export class LiveLayer {
  wrap: HTMLDivElement
  a: HTMLCanvasElement
  b: HTMLCanvasElement
  actx: CanvasRenderingContext2D
  bctx: CanvasRenderingContext2D
  W = 1
  H = 1
  dpr = 1
  /** B에 그린 꼬리의 장치 px 사각형 (다음에 지울 곳) */
  tail: [number, number, number, number] | null = null
  aDirty = false
  bDirty = false

  constructor(stage: HTMLElement) {
    this.wrap = document.createElement('div')
    this.wrap.className = 'ink-live'
    this.a = document.createElement('canvas')
    this.b = document.createElement('canvas')
    this.wrap.append(this.a, this.b)
    stage.appendChild(this.wrap)
    // desynchronized(저지연 앞 버퍼)는 쓰지 않는다: 안드로이드 크롬에서 조상 transform · 섞기와 어긋나 잉크가 펜촉에서 떨어져 보일 수 있다
    this.actx = this.a.getContext('2d')!
    this.bctx = this.b.getContext('2d')!
    this.setMode('ink')
  }

  resize(W: number, H: number, dpr: number): void {
    this.W = W
    this.H = H
    this.dpr = dpr
    const cw = Math.round(W * dpr), ch = Math.round(H * dpr)
    for (const c of [this.a, this.b]) {
      if (c.width !== cw || c.height !== ch) {
        c.width = cw
        c.height = ch
      }
    }
    this.aDirty = this.bDirty = false
    this.tail = null
  }

  /** 펜(맨 위) · 형광(형광 층 바로 위, 같은 섞기) */
  setMode(mode: 'ink' | 'hl', spec?: PaperSpec): void {
    const st = this.wrap.style
    if (mode === 'hl' && spec) {
      st.zIndex = '7'
      st.mixBlendMode = spec.hlBlend
      st.opacity = String(spec.hlOpacity)
    } else {
      st.zIndex = '10'
      st.mixBlendMode = 'normal'
      st.opacity = '1'
    }
  }

  /** 쪽 좌표 → 이 캔버스 장치 px */
  pageTransform(ctx: CanvasRenderingContext2D, v: View, box: PageBox): number {
    const k = v.s * v.dpr
    ctx.setTransform(k, 0, 0, k, v.tx * v.dpr + box.x * k, v.ty * v.dpr + box.y * k)
    return k
  }

  /** 쪽 밖은 잘라낸다 (정적 층과 같게) */
  clipPage(ctx: CanvasRenderingContext2D, v: View, box: PageBox): void {
    const k = v.s * v.dpr
    const x = v.tx * v.dpr + box.x * k, y = v.ty * v.dpr + box.y * k
    ctx.beginPath()
    ctx.rect(Math.round(x), Math.round(y), Math.round(box.w * k), Math.round(box.h * k))
    ctx.clip()
  }

  clearA(): void {
    if (!this.aDirty) return
    this.actx.setTransform(1, 0, 0, 1, 0, 0)
    this.actx.clearRect(0, 0, this.a.width, this.a.height)
    this.aDirty = false
  }

  clearB(): void {
    if (!this.bDirty && !this.tail) return
    this.bctx.setTransform(1, 0, 0, 1, 0, 0)
    this.bctx.clearRect(0, 0, this.b.width, this.b.height)
    this.bDirty = false
    this.tail = null
  }

  /** 꼬리만 지운다 */
  clearTail(): void {
    const t = this.tail
    if (!t) return
    this.bctx.setTransform(1, 0, 0, 1, 0, 0)
    this.bctx.clearRect(t[0], t[1], t[2] - t[0], t[3] - t[1])
    this.tail = null
  }

  clear(): void {
    this.clearA()
    this.clearB()
  }

  destroy(): void {
    this.a.width = this.a.height = this.b.width = this.b.height = 0
    this.wrap.remove()
  }
}

/** 외곽선 점들의 장치 px 사각형 (변환 k, 원점 ox, oy) */
export function devRect(o: number[][], k: number, ox: number, oy: number, pad = 2): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const p of o) {
    const x = p[0]!, y = p[1]!
    if (x < x0) x0 = x
    if (x > x1) x1 = x
    if (y < y0) y0 = y
    if (y > y1) y1 = y
  }
  return [Math.floor(ox + x0 * k) - pad, Math.floor(oy + y0 * k) - pad, Math.ceil(ox + x1 * k) + pad, Math.ceil(oy + y1 * k) + pad]
}
