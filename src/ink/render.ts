/**
 * 손글씨 엔진 — 그리기 (쪽마다 정적 층 비트맵 캐시 · 틀 · 층 쌓기 · 나눠 그리기).
 *
 * 층 (아래 → 위, 무대 안 z-index):
 *   1 종이(DOM, 세계 변환) · 2 틀 선(화면 크기 캔버스, 매 보기마다 다시) · 3 PDF(캔버스 층)
 *   4 사진·글 상자(DOM) · 5 형광(곱하기 .38) · 6 형광(밤, .26) · 7 실시간(형광일 때)
 *   8 잉크(캔버스 층) · 9 테이프(DOM) · 10 실시간(펜일 때) + 덧층
 *
 * 쪽 캔버스는 '영역 슬롯'이다: 쪽 전체(≤ 6MPx)를 base로, 그보다 크게 확대하면 보이는 곳만 detail로 그린다.
 * 슬롯은 장치 픽셀 격자에 맞춰 놓으므로 이동(스크롤)은 CSS transform만 바뀐다(다시 그리기 0).
 * 확대 중에는 슬롯을 CSS로 늘이고, 멈추면(140ms) 보이는 곳부터 새 배율로 나눠 그린 뒤 바꿔 끼운다.
 */
import { bboxInter, bboxOverlap, type BBox } from './geom'
import type { PageModel } from './doc'
import { drawStroke, hlComposite, type Look, type StrokeModel } from './stroke'
import { paperOf, type PaperSpec } from './palette'
import type { PageBox, View } from './view'
import type { PageTemplate } from '@/db/schema'
import { ItemsLayer } from './items'
import type { InkEngine } from './engine'
import { renderPdfRegion } from './pdf'

/**
 * 캔버스 예산 (기기마다). 터치 기기 · 메모리 ≤ 4GB = 12MPx, 그 밖 모바일 16MPx, 데스크톱 44MPx.
 * full = 쪽 하나 통째 슬롯 상한, detail = 확대 시 보이는 곳 슬롯 상한, detailAt = 이만큼 넘게 확대해야 detail을 만든다.
 */
export function inkLimits(env: { coarse?: boolean; memory?: number; mobile?: boolean } = {}): { budget: number; full: number; detail: number; detailAt: number } {
  const coarse = env.coarse ?? (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches)
  const memory = env.memory ?? (navigator as Navigator & { deviceMemory?: number }).deviceMemory
  const mobile = env.mobile ?? /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
  if (coarse || (memory !== undefined && memory <= 4)) return { budget: 12e6, full: 4.5e6, detail: 4e6, detailAt: 1.25 }
  if (mobile) return { budget: 16e6, full: 5e6, detail: 5e6, detailAt: 1.15 }
  return { budget: 44e6, full: 6e6, detail: 8e6, detailAt: 1.0001 }
}
const LIM = inkLimits()
const FULL_PX = LIM.full
const DETAIL_PX = LIM.detail
const BUDGET_PX = LIM.budget
const PREFETCH = 0.75
const SETTLE_MS = 140

type LayerName = 'pdf' | 'hl' | 'ink'
type Level = 'base' | 'detail'

export interface Slot {
  el: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  /** 그린 배율 CSS px / pt */
  s: number
  /** 장치 px / pt */
  k: number
  /** 영역 원점의 장치 px (세계 원점 기준, 정수) */
  dx0: number
  dy0: number
  cw: number
  ch: number
  /** 영역 (쪽 좌표) */
  region: BBox
  /** 그릴 때의 쪽 원점 (세계) */
  X: number
  Y: number
  stale: boolean
  /** 요청한 배율 (메모리 때문에 낮춰 만들었어도 같은 요청이면 다시 만들지 않는다) */
  reqK?: number
}

interface Job {
  pv: PageView
  layer: LayerName
  level: Level
  slot: Slot
  list: StrokeModel[]
  i: number
  pdf: { cancel(): void } | null
  pdfState: 'idle' | 'running' | 'done' | 'fail'
  dead: boolean
}

export class PageView {
  paper: HTMLDivElement
  slots: Record<LayerName, { base: Slot | null; detail: Slot | null }> = { pdf: { base: null, detail: null }, hl: { base: null, detail: null }, ink: { base: null, detail: null } }
  jobs = new Map<string, Job>()
  used = 0
  spec: PaperSpec
  constructor(
    public pm: PageModel,
    public box: PageBox,
    spec: PaperSpec,
  ) {
    this.spec = spec
    this.paper = document.createElement('div')
    this.paper.className = 'ink-page'
  }
  get look(): Look {
    return { dark: this.spec.dark }
  }
}

function makeCanvas(cw: number, ch: number, opaque = false): { el: HTMLCanvasElement; ctx: CanvasRenderingContext2D | null } {
  const el = document.createElement('canvas')
  el.width = cw
  el.height = ch
  el.className = 'ink-slot'
  let ctx: CanvasRenderingContext2D | null = null
  try {
    ctx = el.getContext('2d', { alpha: !opaque })
  } catch {
    ctx = null
  }
  return { el, ctx }
}

function freeCanvas(el: HTMLCanvasElement): void {
  el.remove()
  el.width = el.height = 0
}

export class Renderer {
  stage: HTMLDivElement
  L: Record<'paper' | 'pdf' | 'items' | 'hlm' | 'hln' | 'ink' | 'tape', HTMLDivElement>
  tpl: HTMLCanvasElement
  tctx: CanvasRenderingContext2D
  views = new Map<string, PageView>()
  items: ItemsLayer
  private jobs: Job[] = []
  private frameNo = 0
  private px = 0
  private gesture = false
  private lastS = 0
  private dirtyView = true

  constructor(private eng: InkEngine) {
    const stage = document.createElement('div')
    stage.className = 'ink-stage'
    stage.setAttribute('data-radial', '')
    const mk = (cls: string, z: number) => {
      const d = document.createElement('div')
      d.className = 'ink-L ' + cls
      d.style.zIndex = String(z)
      stage.appendChild(d)
      return d
    }
    this.stage = stage
    const paper = mk('ink-L-paper', 1)
    this.tpl = document.createElement('canvas')
    this.tpl.className = 'ink-tpl'
    this.tpl.style.zIndex = '2'
    stage.appendChild(this.tpl)
    this.tctx = this.tpl.getContext('2d')!
    this.L = {
      paper,
      pdf: mk('ink-L-pdf', 3),
      items: mk('ink-L-items', 4),
      hlm: mk('ink-L-hlm', 5),
      hln: mk('ink-L-hln', 6),
      ink: mk('ink-L-ink', 8),
      tape: mk('ink-L-tape', 9),
    }
    this.items = new ItemsLayer(eng, this.L.items, this.L.tape)
  }

  get view(): View {
    return this.eng.view
  }

  /* ---------- 크기 · 배치 ---------- */

  resize(): void {
    const v = this.view
    const cw = Math.round(v.W * v.dpr), ch = Math.round(v.H * v.dpr)
    if (this.tpl.width !== cw || this.tpl.height !== ch) {
      this.tpl.width = cw
      this.tpl.height = ch
      this.tpl.style.width = v.W + 'px'
      this.tpl.style.height = v.H + 'px'
    }
    this.invalidateAll()
  }

  /** 쪽 목록이 바뀜: 보기를 맞추고 없는 쪽은 치운다 */
  syncPages(): void {
    const v = this.view
    const ids = new Set(v.boxes.map((b) => b.id))
    for (const [id, pv] of this.views) if (!ids.has(id)) this.dropView(pv)
    v.boxes.forEach((b) => {
      const pv = this.views.get(b.id)
      if (pv) {
        pv.box = b
        pv.spec = paperOf(pv.pm.page, this.eng.night)
        this.placePaper(pv)
      }
    })
    this.dirtyView = true
  }

  private viewFor(i: number): PageView | null {
    const b = this.view.boxes[i]
    if (!b) return null
    let pv = this.views.get(b.id)
    if (pv) return pv
    const pm = this.eng.doc.byId.get(b.id)
    if (!pm) return null
    pv = new PageView(pm, b, paperOf(pm.page, this.eng.night))
    this.views.set(b.id, pv)
    this.placePaper(pv)
    this.L.paper.appendChild(pv.paper)
    this.items.attach(pv)
    return pv
  }

  private placePaper(pv: PageView): void {
    const { x, y, w, h } = pv.box
    const st = pv.paper.style
    const sp = pv.spec
    const r = this.view.spec.radius / this.view.fit
    st.transform = `translate(${x}px, ${y}px)`
    st.width = w + 'px'
    st.height = h + 'px'
    const u = 1 / this.view.fit
    st.background = this.eng.mode === 'pad' ? 'transparent' : sp.bg
    st.borderRadius = r + 'px'
    // 테두리 1px + 얕은 그림자 (세계 좌표라 확대와 함께 커진다 — 큰 blur는 확대 때 비싸서 쓰지 않는다)
    // 밤 종이: 아주 옅은 빛 테두리로 '종이'로 읽히게 (어두운 바탕에서는 검은 그림자가 안 보인다)
    st.boxShadow = this.eng.mode === 'pad' ? 'none' : sp.dark ? `0 0 0 ${u}px ${sp.border}, 0 0 ${14 * u}px rgba(220,228,255,.06)` : `0 0 0 ${u}px ${sp.border}, 0 ${2 * u}px ${10 * u}px rgba(0,0,0,.1)`
    pv.paper.dataset.paper = sp.kind
    this.items.place(pv)
  }

  private dropView(pv: PageView): void {
    for (const l of ['pdf', 'hl', 'ink'] as const) this.releaseLayer(pv, l)
    pv.paper.remove()
    this.items.detach(pv)
    this.views.delete(pv.pm.id)
  }

  private releaseLayer(pv: PageView, l: LayerName, level?: Level): void {
    for (const lv of level ? [level] : (['base', 'detail'] as const)) {
      const s = pv.slots[l][lv]
      if (s) {
        this.px -= s.cw * s.ch
        freeCanvas(s.el)
        pv.slots[l][lv] = null
      }
      const j = pv.jobs.get(l + lv)
      if (j) this.kill(j)
    }
  }

  private kill(j: Job): void {
    j.dead = true
    j.pdf?.cancel()
    j.pv.jobs.delete(j.layer + j.level)
    freeCanvas(j.slot.el)
  }

  /** 테마 · 배율 · 크기가 바뀌면 모든 슬롯을 다시 (지금 것은 새 것이 준비될 때까지 둔다) */
  invalidateAll(): void {
    for (const pv of this.views.values()) {
      pv.spec = paperOf(pv.pm.page, this.eng.night)
      this.placePaper(pv)
      for (const l of ['pdf', 'hl', 'ink'] as const)
        for (const lv of ['base', 'detail'] as const) {
          const s = pv.slots[l][lv]
          if (s) s.stale = true
          const j = pv.jobs.get(l + lv)
          if (j) this.kill(j)
        }
      if (pv.slots.hl.base) this.moveHl(pv)
    }
    this.dirtyView = true
  }

  invalidatePage(pm: PageModel): void {
    const pv = this.views.get(pm.id)
    if (!pv) return
    pv.spec = paperOf(pm.page, this.eng.night)
    this.placePaper(pv)
    for (const l of ['pdf', 'hl', 'ink'] as const)
      for (const lv of ['base', 'detail'] as const) {
        const s = pv.slots[l][lv]
        if (s) s.stale = true
        const j = pv.jobs.get(l + lv)
        if (j) this.kill(j)
      }
    this.dirtyView = true
  }

  setGesture(on: boolean): void {
    if (this.gesture === on) return
    this.gesture = on
    for (const k of ['paper', 'items', 'tape'] as const) this.L[k].style.willChange = on ? 'transform' : ''
    this.dirtyView = true
  }

  markDirty(): void {
    this.dirtyView = true
  }

  private settled(now: number): boolean {
    return !this.gesture && now - this.view.lastScaleAt > SETTLE_MS
  }

  /* ---------- 프레임 ---------- */

  /** 한 프레임: 변환 → 틀 → 필요한 슬롯 → 나눠 그리기. 할 일이 남으면 true */
  frame(now: number, budgetMs: number): boolean {
    this.frameNo++
    const v = this.view
    if (this.dirtyView || v.s !== this.lastS) {
      this.applyTransforms()
      this.drawTemplates()
      this.lastS = v.s
      this.dirtyView = false
      this.wasSettled = this.settled(now)
      this.ensure(now)
    } else if ((!this.wasSettled && this.settled(now)) || (this.detailWait && this.still(now))) {
      // 확대·이동이 멈췄다: 새 배율로 보이는 곳부터
      this.wasSettled = true
      this.ensure(now)
    }
    this.runJobs(now + budgetMs)
    return this.jobs.length > 0 || !this.wasSettled || this.detailWait
  }

  private wasSettled = false
  /** 움직이는 동안 미룬 detail (멈추면 그린다 — 매 프레임 큰 캔버스를 새로 만들지 않게) */
  private detailWait = false

  private still(now: number): boolean {
    return this.settled(now) && now - this.view.lastMoveAt > 120 && !this.view.moving
  }

  applyTransforms(): void {
    const v = this.view
    const tx = v.tx, ty = v.ty
    const world = `translate(${tx}px, ${ty}px) scale(${v.s})`
    this.L.paper.style.transform = world
    this.L.items.style.transform = world
    this.L.tape.style.transform = world
    const t = `translate(${tx}px, ${ty}px)`
    this.L.pdf.style.transform = t
    this.L.hlm.style.transform = t
    this.L.hln.style.transform = t
    this.L.ink.style.transform = t
    for (const pv of this.views.values())
      for (const l of ['pdf', 'hl', 'ink'] as const)
        for (const lv of ['base', 'detail'] as const) {
          const s = pv.slots[l][lv]
          if (s) this.placeSlot(pv, s)
        }
  }

  private placeSlot(pv: PageView, s: Slot): void {
    const v = this.view
    const f = v.s / s.s
    const ox = (pv.box.x + s.region[0]) * v.s
    const oy = (pv.box.y + s.region[1]) * v.s
    s.el.style.transform = f === 1 ? `translate(${ox}px, ${oy}px)` : `translate(${ox}px, ${oy}px) scale(${f})`
  }

  /** 화면 크기 틀 캔버스: 보이는 쪽의 줄 · 모눈 · 점 · 코넬을 장치 픽셀에 맞춰 */
  drawTemplates(): void {
    const v = this.view
    const ctx = this.tctx
    const dpr = v.dpr
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.tpl.width, this.tpl.height)
    const [i0, i1] = v.range(0)
    if (i0 < 0) return
    const k = v.s * dpr
    const ox = v.tx * dpr, oy = v.ty * dpr
    for (let i = i0; i <= i1; i++) {
      const b = v.boxes[i]!
      const pm = this.eng.doc.byId.get(b.id)
      if (!pm || pm.page.pdf || pm.page.template === 'blank') continue
      const spec = paperOf(pm.page, this.eng.night)
      drawTemplate(ctx, pm.page.template, b, k, ox, oy, dpr, spec, this.tpl.width, this.tpl.height)
    }
  }

  /** 보이는 쪽(+미리)에 슬롯을 마련하고, 먼 쪽은 놓는다 */
  ensure(now: number): void {
    const v = this.view
    const [i0, i1] = v.range(v.H * PREFETCH)
    const [v0, v1] = v.range(0)
    if (i0 < 0) return
    const settled = this.settled(now)
    const still = this.still(now)
    this.detailWait = false
    // 보이는 쪽 먼저, 그다음 미리 볼 쪽
    const order: number[] = []
    for (let i = v0; i <= v1; i++) if (i >= 0) order.push(i)
    for (let d = 1; d <= i1 - i0; d++) {
      if (v1 + d <= i1) order.push(v1 + d)
      if (v0 - d >= i0) order.push(v0 - d)
    }
    for (const i of order) {
      const pv = this.viewFor(i)
      if (!pv) continue
      pv.used = this.frameNo
      const pm = pv.pm
      if (pm.state !== 'ready') {
        void this.eng.doc.load(pm)
        continue
      }
      const visible = i >= v0 && i <= v1
      if (pm.page.pdf) this.ensureLayer(pv, 'pdf', visible, settled, still)
      if (pm.hl > 0) this.ensureLayer(pv, 'hl', visible, settled, still)
      else this.releaseLayer(pv, 'hl')
      this.ensureLayer(pv, 'ink', visible, settled, still)
    }
    // 먼 쪽: 예산을 넘거나 3화면 넘게 멀면 놓는다
    const far = (pv: PageView) => {
      const i = v.boxes.findIndex((b) => b.id === pv.pm.id)
      return i < i0 - 1 || i > i1 + 1
    }
    for (const pv of this.views.values()) {
      if (pv.used === this.frameNo) continue
      if (far(pv) && (this.px > BUDGET_PX * 0.6 || pv.used < this.frameNo - 600)) {
        for (const l of ['pdf', 'hl', 'ink'] as const) this.releaseLayer(pv, l)
      } else {
        // 안 보이는 쪽은 detail을 놓는다
        for (const l of ['pdf', 'hl', 'ink'] as const) this.releaseLayer(pv, l, 'detail')
      }
    }
    this.sortJobs()
  }

  private ensureLayer(pv: PageView, l: LayerName, visible: boolean, settled: boolean, still: boolean): void {
    const v = this.view
    const { w, h } = pv.box
    const dpr = v.dpr
    const k = v.s * dpr
    const fullK = Math.min(k, Math.sqrt(FULL_PX / (w * h)))
    const st = pv.slots[l]
    const full: BBox = [0, 0, w, h]
    const base = st.base
    // 확대 중에는 지금 base를 늘여 쓰고(없을 때만 새로), 멈추면 새 배율로
    const want = settled || !base ? fullK : base.k
    const fits = (s: Slot | null | undefined) => !!s && !s.stale && Math.abs((s.reqK ?? s.k) - want) < 1e-6 && s.X === pv.box.x && s.Y === pv.box.y
    if (!fits(base) && !fits(pv.jobs.get(l + 'base')?.slot) && (settled || !base)) this.schedule(pv, l, 'base', want, full)
    if (k > fullK * LIM.detailAt) {
      if (!visible || !settled) return
      const need = this.visiblePart(pv, 0)
      if (!need) return
      const covers = (s: Slot | null | undefined) => !!s && !s.stale && Math.abs((s.reqK ?? s.k) - k) < 1e-6 && s.X === pv.box.x && s.Y === pv.box.y && contains(s.region, need)
      if (covers(st.detail) || covers(pv.jobs.get(l + 'detail')?.slot)) return
      if (!still) {
        this.detailWait = true
        return
      }
      this.schedule(pv, l, 'detail', k, this.visiblePart(pv, 0.18) ?? need)
    } else {
      this.releaseLayer(pv, l, 'detail')
    }
  }

  /** 쪽에서 화면에 보이는 부분(+여유, 쪽 좌표) — detail 크기 상한 안 */
  private visiblePart(pv: PageView, margin: number): BBox | null {
    const v = this.view
    const mx = (v.W / v.s) * margin, my = (v.H / v.s) * margin
    const r: BBox = [v.vx - pv.box.x - mx, v.vy - pv.box.y - my, v.vx - pv.box.x + v.W / v.s + mx, v.vy - pv.box.y + v.H / v.s + my]
    const inter = bboxInter(r, [0, 0, pv.box.w, pv.box.h])
    if (!inter) return null
    const k = v.s * v.dpr
    const area = (inter[2] - inter[0]) * (inter[3] - inter[1]) * k * k
    if (area > DETAIL_PX) {
      const f = Math.sqrt(DETAIL_PX / area)
      const cx = (inter[0] + inter[2]) / 2, cy = (inter[1] + inter[3]) / 2
      const hw = ((inter[2] - inter[0]) * f) / 2, hh = ((inter[3] - inter[1]) * f) / 2
      return [cx - hw, cy - hh, cx + hw, cy + hh]
    }
    return inter
  }

  private schedule(pv: PageView, l: LayerName, level: Level, k: number, region: BBox): void {
    this.diagDirty = true
    const old = pv.jobs.get(l + level)
    if (old) this.kill(old)
    const X = pv.box.x, Y = pv.box.y
    const reqK = k
    let dx0 = 0, dy0 = 0, cw = 1, ch = 1
    let made: { el: HTMLCanvasElement; ctx: CanvasRenderingContext2D | null } | null = null
    // 캔버스를 못 만들면(폭·높이 0, 문맥 없음 — 모바일 메모리) 배율을 낮춰 다시 (최대 3번)
    for (let tryN = 0; tryN < 4; tryN++, k *= 0.7) {
      dx0 = Math.floor((X + region[0]) * k)
      dy0 = Math.floor((Y + region[1]) * k)
      cw = Math.max(1, Math.ceil((X + region[2]) * k) - dx0)
      ch = Math.max(1, Math.ceil((Y + region[3]) * k) - dy0)
      // 예산: 넘으면 먼 쪽부터 놓는다
      this.evictFor(cw * ch, pv)
      made = makeCanvas(cw, ch, l === 'pdf')
      if (made.ctx && made.el.width === cw && made.el.height === ch) break
      freeCanvas(made.el)
      made = null
    }
    if (!made?.ctx) return
    const el = made.el
    const ctx = made.ctx
    const dpr = this.view.dpr
    el.style.width = cw / dpr + 'px'
    el.style.height = ch / dpr + 'px'
    const rx0 = dx0 / k - X, ry0 = dy0 / k - Y
    const slot: Slot = { el, ctx, s: k / dpr, k, dx0, dy0, cw, ch, region: [rx0, ry0, rx0 + cw / k, ry0 + ch / k], X, Y, stale: false, reqK }
    // 2D 문맥을 잃으면(크롬: 메모리 압박 · GPU 재시작) 그 슬롯을 다시 그린다
    el.addEventListener('contextlost', () => {
      this.ctxLost++
      this.diagDirty = true
    })
    el.addEventListener('contextrestored', () => {
      slot.stale = true
      this.dirtyView = true
      this.eng.requestFrame()
    })
    ctx.setTransform(k, 0, 0, k, X * k - dx0, Y * k - dy0)
    const layerKind = l === 'hl' ? 'highlight' : 'ink'
    const list = l === 'pdf' ? [] : pv.pm.sorted().filter((m) => m.row.layer === layerKind && !m.hidden && bboxOverlap(m.bbox, slot.region))
    if (l === 'hl') ctx.globalCompositeOperation = hlComposite(pv.spec)
    const job: Job = { pv, layer: l, level, slot, list, i: 0, pdf: null, pdfState: 'idle', dead: false }
    pv.jobs.set(l + level, job)
    this.jobs.push(job)
  }

  private evictFor(need: number, keep: PageView): void {
    if (this.px + need <= BUDGET_PX) return
    const vs = [...this.views.values()].filter((p) => p !== keep).sort((a, b) => a.used - b.used)
    for (const pv of vs) {
      if (this.px + need <= BUDGET_PX) break
      for (const l of ['pdf', 'hl', 'ink'] as const) this.releaseLayer(pv, l)
    }
  }

  private sortJobs(): void {
    const v = this.view
    const [v0, v1] = v.range(0)
    const idx = new Map(v.boxes.map((b, i) => [b.id, i]))
    const pri = (j: Job) => {
      const i = idx.get(j.pv.pm.id) ?? 1e9
      const vis = i >= v0 && i <= v1 ? 0 : 1000
      return vis + Math.abs(i - v0) * 10 + (j.level === 'base' && !j.pv.slots[j.layer].base ? 0 : 3) + (j.layer === 'pdf' ? 0 : 1)
    }
    this.jobs = this.jobs.filter((j) => !j.dead).sort((a, b) => pri(a) - pri(b))
  }

  private runJobs(deadline: number): void {
    let i = 0
    while (i < this.jobs.length) {
      const j = this.jobs[i]!
      if (j.dead) {
        this.jobs.splice(i, 1)
        continue
      }
      if (j.layer === 'pdf') {
        if (j.pdfState === 'idle') this.startPdf(j)
        if (j.pdfState === 'done') {
          this.finish(j)
          this.jobs.splice(i, 1)
          continue
        }
        if (j.pdfState === 'fail') {
          j.pv.jobs.delete(j.layer + j.level)
          freeCanvas(j.slot.el)
          this.jobs.splice(i, 1)
          continue
        }
        i++
        continue
      }
      const ctx = j.slot.ctx
      const look = j.pv.look
      const k = j.slot.k
      let n = 0
      while (j.i < j.list.length) {
        const m = j.list[j.i++]!
        if (!m.hidden) drawStroke(ctx, m, look, k)
        if (++n % 6 === 0 && performance.now() > deadline) return
      }
      this.finish(j)
      this.jobs.splice(i, 1)
      if (performance.now() > deadline) return
    }
  }

  private startPdf(j: Job): void {
    const pdf = j.pv.pm.page.pdf
    if (!pdf) {
      j.pdfState = 'fail'
      return
    }
    j.pdfState = 'running'
    const s = j.slot
    const task = renderPdfRegion(this.eng.db, pdf.assetId, pdf.pageNo, s.ctx, s.k, s.region[0], s.region[1])
    j.pdf = task
    task.promise.then(
      () => {
        if (j.dead) return
        j.pdfState = 'done'
        this.eng.requestFrame()
      },
      () => {
        if (!j.dead) j.pdfState = 'fail'
        this.eng.requestFrame()
      },
    )
  }

  private finish(j: Job): void {
    const pv = j.pv
    j.pv.jobs.delete(j.layer + j.level)
    if (j.dead) return
    const old = pv.slots[j.layer][j.level]
    if (old) {
      this.px -= old.cw * old.ch
      freeCanvas(old.el)
    }
    pv.slots[j.layer][j.level] = j.slot
    this.px += j.slot.cw * j.slot.ch
    this.diagDirty = true
    const host = j.layer === 'pdf' ? this.L.pdf : j.layer === 'ink' ? this.L.ink : pv.spec.hlBlend === 'multiply' ? this.L.hlm : this.L.hln
    // detail은 base 위
    host.appendChild(j.slot.el)
    this.placeSlot(pv, j.slot)
    if (j.level === 'base') {
      const d = pv.slots[j.layer].detail
      if (d) host.appendChild(d.el)
    }
    this.eng.onSlotReady(pv.pm)
  }

  /** 형광 층(곱하기/밤) 옮기기: 종이가 바뀌었을 때 */
  private moveHl(pv: PageView): void {
    const host = pv.spec.hlBlend === 'multiply' ? this.L.hlm : this.L.hln
    for (const lv of ['base', 'detail'] as const) {
      const s = pv.slots.hl[lv]
      if (s && s.el.parentElement !== host) host.appendChild(s.el)
    }
  }

  /* ---------- 바뀐 획 반영 (같은 프레임, 동기) ---------- */

  /** 새 획: 지금 슬롯과 진행 중인 일감에 더한다 */
  drawAdded(pm: PageModel, ms: StrokeModel[]): void {
    const pv = this.views.get(pm.id)
    if (!pv) return
    for (const m of ms) {
      const l: LayerName = m.row.layer === 'highlight' ? 'hl' : 'ink'
      if (l === 'hl' && !pv.slots.hl.base && !pv.jobs.get('hlbase')) {
        this.dirtyView = true
        continue
      }
      for (const lv of ['base', 'detail'] as const) {
        const s = pv.slots[l][lv]
        // 낡은(stale) 슬롯에도 그린다: 새 슬롯이 준비될 때까지 화면에 남아 있으니 잉크가 잠깐이라도 사라지지 않게
        if (s && bboxOverlap(m.bbox, s.region)) {
          const ctx = s.ctx
          ctx.save()
          ctx.setTransform(s.k, 0, 0, s.k, s.X * s.k - s.dx0, s.Y * s.k - s.dy0)
          if (l === 'hl') ctx.globalCompositeOperation = hlComposite(pv.spec)
          drawStroke(ctx, m, pv.look, s.k)
          ctx.restore()
        }
        const j = pv.jobs.get(l + lv)
        if (j && bboxOverlap(m.bbox, j.slot.region) && !j.list.includes(m)) j.list.push(m)
      }
    }
  }

  /** 상자 안을 지우고 다시 그린다 (지우기 · 옮기기 · 숨기기) */
  redraw(pm: PageModel, b: BBox, layers: LayerName[] = ['hl', 'ink']): void {
    const pv = this.views.get(pm.id)
    if (!pv) return
    for (const l of layers) {
      if (l === 'pdf') continue
      const kind = l === 'hl' ? 'highlight' : 'ink'
      for (const lv of ['base', 'detail'] as const) {
        const s = pv.slots[l][lv]
        if (s && !s.stale) {
          const r = bboxInter([b[0] - 1, b[1] - 1, b[2] + 1, b[3] + 1], s.region)
          if (r) {
            const x0 = Math.max(0, Math.floor((s.X + r[0]) * s.k - s.dx0)), y0 = Math.max(0, Math.floor((s.Y + r[1]) * s.k - s.dy0))
            const x1 = Math.min(s.cw, Math.ceil((s.X + r[2]) * s.k - s.dx0)), y1 = Math.min(s.ch, Math.ceil((s.Y + r[3]) * s.k - s.dy0))
            if (x1 > x0 && y1 > y0) {
              const ctx = s.ctx
              ctx.save()
              ctx.setTransform(1, 0, 0, 1, 0, 0)
              ctx.clearRect(x0, y0, x1 - x0, y1 - y0)
              ctx.beginPath()
              ctx.rect(x0, y0, x1 - x0, y1 - y0)
              ctx.clip()
              ctx.setTransform(s.k, 0, 0, s.k, s.X * s.k - s.dx0, s.Y * s.k - s.dy0)
              if (l === 'hl') ctx.globalCompositeOperation = hlComposite(pv.spec)
              const qb: BBox = [(x0 + s.dx0) / s.k - s.X, (y0 + s.dy0) / s.k - s.Y, (x1 + s.dx0) / s.k - s.X, (y1 + s.dy0) / s.k - s.Y]
              for (const m of pm.query(qb, kind)) if (!m.hidden) drawStroke(ctx, m, pv.look, s.k)
              ctx.restore()
            }
          }
        }
        // 진행 중인 일감은 처음부터 (목록도 새로)
        const j = pv.jobs.get(l + lv)
        if (j && bboxOverlap(b, j.slot.region)) {
          const s2 = j.slot
          s2.ctx.save()
          s2.ctx.setTransform(1, 0, 0, 1, 0, 0)
          s2.ctx.clearRect(0, 0, s2.cw, s2.ch)
          s2.ctx.restore()
          j.list = pm.sorted().filter((m) => m.row.layer === kind && !m.hidden && bboxOverlap(m.bbox, s2.region))
          j.i = 0
        }
      }
    }
  }

  /** 획 바뀜 (doc 훅) */
  strokesChanged(pm: PageModel, added: StrokeModel[], removed: StrokeModel[]): void {
    const pv = this.views.get(pm.id)
    if (!pv) return
    // 한꺼번에 많이 바뀌면(붙이기 · 합성 · 쪽 복제) 동기로 그리지 않고 나눠 그리기로 넘긴다 (한 프레임 ≤ 8ms)
    if (added.length + removed.length > 48) {
      this.invalidatePage(pm)
      return
    }
    if (!removed.length) {
      this.drawAdded(pm, added)
    } else {
      let b: BBox | null = null
      const layers = new Set<LayerName>()
      for (const m of [...removed, ...added]) {
        b = b ? [Math.min(b[0], m.bbox[0]), Math.min(b[1], m.bbox[1]), Math.max(b[2], m.bbox[2]), Math.max(b[3], m.bbox[3])] : [...m.bbox]
        layers.add(m.row.layer === 'highlight' ? 'hl' : 'ink')
      }
      if (b) this.redraw(pm, b, [...layers])
    }
    if (pm.hl > 0 && !pv.slots.hl.base) this.dirtyView = true
    if (pm.hl === 0 && pv.slots.hl.base) this.releaseLayer(pv, 'hl')
  }

  /** 쪽 종이 · 틀이 바뀜 */
  pageChanged(pm: PageModel): void {
    const pv = this.views.get(pm.id)
    if (pv) {
      pv.spec = paperOf(pm.page, this.eng.night)
      this.placePaper(pv)
      this.moveHl(pv)
    }
    this.dirtyView = true
  }

  /* ---------- 계측 ---------- */

  diagDirty = true
  ctxLost = 0

  diagInfo(): { slots: number; slotMP: number; budgetMP: number; ctxLost: number } {
    this.diagDirty = false
    let n = 0
    for (const pv of this.views.values()) for (const l of ['pdf', 'hl', 'ink'] as const) for (const lv of ['base', 'detail'] as const) if (pv.slots[l][lv]) n++
    return { slots: n, slotMP: Math.round(this.px / 1e4) / 100, budgetMP: BUDGET_PX / 1e6, ctxLost: this.ctxLost }
  }

  get canvasPx(): number {
    return this.px + this.tpl.width * this.tpl.height
  }
  get pendingJobs(): number {
    return this.jobs.length
  }
  visibleCount(): number {
    const [a, b] = this.view.range(0)
    return a < 0 ? 0 : b - a + 1
  }

  destroy(): void {
    for (const pv of [...this.views.values()]) this.dropView(pv)
    this.jobs = []
    this.tpl.width = this.tpl.height = 0
    this.stage.remove()
  }
}

function contains(outer: BBox, inner: BBox): boolean {
  return inner[0] >= outer[0] - 0.5 && inner[1] >= outer[1] - 0.5 && inner[2] <= outer[2] + 0.5 && inner[3] <= outer[3] + 0.5
}

/* ---------- 틀 (design-ink 1-6) ---------- */

export const TEMPLATE_SPEC = {
  ruled: { gap: 20, first: 64 },
  grid: { gap: 14.17 },
  dot: { gap: 14.17, d: 1.0 },
  cornell: { head: 64, cue: 0.3, summary: 0.2, gap: 20 },
} as const

/**
 * 쪽 하나의 틀을 화면 장치 픽셀로. 선은 1 CSS px(장치 격자에 맞춤), 점은 지름 max(1.6px, 1pt).
 * ox, oy = 세계 원점의 장치 px, k = 장치 px / pt.
 */
export function drawTemplate(ctx: CanvasRenderingContext2D, t: PageTemplate, b: { x: number; y: number; w: number; h: number }, k: number, ox: number, oy: number, dpr: number, spec: PaperSpec, cw: number, ch: number): void {
  const px0 = ox + b.x * k, py0 = oy + b.y * k
  const pw = b.w * k, ph = b.h * k
  const lw = Math.max(1, Math.round(dpr))
  const X0 = Math.max(0, Math.round(px0)), X1 = Math.min(cw, Math.round(px0 + pw))
  const Y0 = Math.max(0, Math.round(py0)), Y1 = Math.min(ch, Math.round(py0 + ph))
  if (X1 <= X0 || Y1 <= Y0) return
  ctx.fillStyle = spec.line
  const hline = (y: number, xa = 0, xb = b.w) => {
    const yy = Math.round(py0 + y * k)
    if (yy < Y0 - 1 || yy > Y1) return
    const a = Math.max(X0, Math.round(px0 + xa * k)), z = Math.min(X1, Math.round(px0 + xb * k))
    if (z > a) ctx.fillRect(a, yy, z - a, lw)
  }
  const vline = (x: number, ya = 0, yb = b.h) => {
    const xx = Math.round(px0 + x * k)
    if (xx < X0 - 1 || xx > X1) return
    const a = Math.max(Y0, Math.round(py0 + ya * k)), z = Math.min(Y1, Math.round(py0 + yb * k))
    if (z > a) ctx.fillRect(xx, a, lw, z - a)
  }
  // 보이는 세로 범위의 줄만
  const yFrom = (Y0 - py0) / k, yTo = (Y1 - py0) / k
  if (t === 'ruled') {
    const { gap, first } = TEMPLATE_SPEC.ruled
    const s = Math.max(0, Math.ceil((yFrom - first) / gap))
    for (let i = s; first + i * gap < Math.min(b.h - 8, yTo + gap); i++) hline(first + i * gap)
  } else if (t === 'grid') {
    const g = TEMPLATE_SPEC.grid.gap
    const off = (b.w % g) / 2
    for (let x = off; x <= b.w; x += g) vline(x, Math.max(0, yFrom - g), Math.min(b.h, yTo + g))
    const s = Math.max(0, Math.floor(yFrom / g))
    for (let y = s * g + ((b.h % g) / 2); y <= Math.min(b.h, yTo + g); y += g) hline(y)
  } else if (t === 'dot') {
    const g = TEMPLATE_SPEC.dot.gap
    const d = Math.max(1.6 * dpr, TEMPLATE_SPEC.dot.d * k)
    ctx.fillStyle = spec.dot
    const offx = (b.w % g) / 2, offy = (b.h % g) / 2
    const r = d / 2
    const sy = Math.max(0, Math.floor((yFrom - offy) / g))
    ctx.beginPath()
    for (let y = offy + sy * g; y <= Math.min(b.h, yTo + g); y += g) {
      const yy = Math.round(py0 + y * k)
      if (yy < Y0 - d || yy > Y1 + d) continue
      for (let x = offx; x <= b.w; x += g) {
        const xx = Math.round(px0 + x * k)
        if (xx < X0 - d || xx > X1 + d) continue
        ctx.moveTo(xx + r, yy)
        ctx.arc(xx, yy, r, 0, Math.PI * 2)
      }
    }
    ctx.fill()
  } else if (t === 'cornell') {
    const c = TEMPLATE_SPEC.cornell
    const cueX = b.w * c.cue, sumY = b.h * (1 - c.summary)
    const s = Math.max(0, Math.ceil((yFrom - c.head) / c.gap))
    for (let i = s; c.head + i * c.gap < Math.min(sumY - 4, yTo + c.gap); i++) hline(c.head + i * c.gap, cueX)
    ctx.fillStyle = spec.line.replace(/[\d.]+\)$/, (a) => `${Math.min(1, parseFloat(a) * 2.2)})`)
    hline(c.head)
    hline(sumY)
    vline(cueX, c.head, sumY)
  }
}
