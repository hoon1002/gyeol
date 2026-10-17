/**
 * 결 손글씨 엔진 — React 밖의 순수 TS. 한 노트(또는 메모 칸 한 쪽)마다 하나.
 *
 *   const eng = createInkEngine({ host, noteId })   // host 크기는 앱이 정한다
 *   await eng.ready
 *   eng.setTool('pen'); eng.setPen({ color: '#2251C9', width: 2 })
 *   eng.on('history', ({ canUndo }) => …); eng.undo()
 *   eng.destroy()
 *
 * 하늘: 쓰는 동안(펜이 닿아 있거나 마지막 획 뒤 2초) 'active' 이벤트 true → 래퍼가 useFieldPause(true, 'ink').
 * :root[data-inking]도 같은 동안 붙인다(툴팁 · 첫 회 안내가 뜨지 않게). 잉크 입력은 하늘 kick()을 부르지 않는다.
 */
import { appInkDB, getInkMeta, newPageRow, saveAsset, setInkMeta, touchNote, type InkDB, type InkItem, type InkStroke } from '@/db/ink'
import { uid, type Page, type PageTemplate } from '@/db/schema'
import { alive, deleted, History, InkDoc, stamp, type Command, type PageModel, type Snap } from './doc'
import { apply as mApply, bboxInter, bboxOverlap, bboxTransform, IDENT, inv, matAngle, matScale, mul, pointInPoly, translate, type BBox, type Mat } from './geom'
import { INK_THRESHOLDS as T } from './input/thresholds'
import { InputRouter } from './input/router'
import { itemMatrix } from './items'
import { LiveLayer } from './live'
import { HL_SLOTS, inkColor, PEN_SLOTS, tapeColor, TAPE_SLOTS } from './palette'
import { Renderer } from './render'
import { drawStroke, pathOf, strokeBBox, StrokeModel, zCompare } from './stroke'
import { EraserSession, LassoSession, PanSession, PenSession, PieSession, SelectDragSession, TapeSession, TapSession, transformItemRow, transformStrokeRow, type Handle, type InPt, type Session } from './tools'
import type { EraserStyle, HighlighterStyle, InkEngineOptions, InkEvents, InkPrefs, InkStats, PageInfo, PenOnlyMode, PenStyle, PieEvent, SelectionInfo, TapeStyle, ToolName, ViewInfo } from './types'
import { View, type PageBox } from './view'
import { INK_COMMANDS, matchKey } from './commands'

type Listener<K extends keyof InkEvents> = (v: InkEvents[K]) => void

export interface InkDiag {
  /** [clientWidth, clientHeight, rect.width, rect.height] */
  host: [number, number, number, number]
  dpr: number
  slots: number
  slotMP: number
  budgetMP: number
  ctxLost: number
  /** [clientX, clientY, 호스트 x, 호스트 y] (펜) */
  lastPen: [number, number, number, number]
}

export interface Selection {
  pageId: string
  strokes: Set<string>
  items: Set<string>
  /** 고를 때의 상자 (쪽 좌표) */
  box: BBox
  /** 고른 뒤 쌓인 변환 (상자 표시용) */
  m: Mat
}

interface Fade {
  pm: PageModel
  models: StrokeModel[]
  t0: number
  dur: number
  dir: 'in' | 'out'
}

interface Clip {
  strokes: InkStroke[]
  items: InkItem[]
  box: BBox
  pageId: string
}

let active: InkEngine | null = null
let inkingCount = 0
let clipboard: Clip | null = null
const FINGER_KEY = 'gyeol.ink.fingerDraw'

/** ⌘K 등 밖에서 부를 때: 마지막으로 손댄 엔진 */
export function getActiveInkEngine(): InkEngine | null {
  return active && !active.destroyed ? active : null
}

function readFingerDraw(): boolean | null {
  try {
    const v = localStorage.getItem(FINGER_KEY)
    return v === null ? null : v === '1'
  } catch {
    return null
  }
}

function isEditable(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  return !!el?.closest?.('textarea, input, select, [contenteditable=""], [contenteditable="true"]')
}

const NULL_SESSION: Session = { kind: 'null', usesLive: false, move() {}, up() {}, cancel() {} }

export class InkEngine {
  readonly host: HTMLElement
  readonly db: InkDB
  readonly noteId: string
  readonly mode: 'note' | 'pad'
  readonly doc: InkDoc
  readonly view = new View()
  readonly r: Renderer
  readonly live: LiveLayer
  readonly input: InputRouter
  readonly history = new History(200)
  readonly ready: Promise<void>
  night: boolean
  standalone: boolean
  tool: ToolName = 'pen'
  pen: PenStyle = { kind: 'ball', color: PEN_SLOTS[0]!, width: 2.0, pressure: true }
  hl: HighlighterStyle = { color: HL_SLOTS[0]!, width: 12, straight: true }
  eraser: EraserStyle = { mode: 'stroke', size: 16 }
  tape: TapeStyle = { color: TAPE_SLOTS[0]!, width: 22 }
  /** 글 상자 색 = 펜 1번 칸 */
  textColor = PEN_SLOTS[0]!
  prefs: InkPrefs = { scratch: true, penPie: true, eraserReturn: false }
  penOnlyMode: PenOnlyMode
  penOnly: boolean
  shapeArmed = false
  sel: Selection | null = null
  /** 닫는 전환 중: 입력 무시 */
  blocked = false
  destroyed = false
  /** 두·세 손가락 탭을 UI가 먼저 받는다(열린 층 닫기). true면 되돌리기 안 함 */
  interceptTap: ((kind: 'undo' | 'redo') => boolean) | null = null
  /** 획 수 (이번에 연 동안 늘어난 것) */
  strokesAdded = 0

  private listeners = new Map<string, Set<(v: unknown) => void>>()
  private raf = 0
  private lastTick = 0
  private gestureOn = false
  private activeOn = false
  private activeTimer = 0
  private markInking: boolean
  private keysOn: boolean
  private ro: ResizeObserver | null = null
  private fades: Fade[] = []
  private ringEl: HTMLDivElement
  private hoverPt: { x: number; y: number; type: string } | null = null
  private cursorPt: { x: number; y: number; type: string } | null = null
  private lassoState: { box: PageBox; poly: number[] } | null = null
  private tapePrev: { box: PageBox; rect: { x: number; y: number; w: number; h: number; rot: number } | null; color: string } | null = null
  private dragM: Mat | null = null
  private pie: { pageId: string | null; px: number; py: number; type: string } | null = null
  private colors = { t1: '#F2EFE8', t2: '#B9BDCB', t3: '#8E94A8', paper: '#0E1322' }
  private off: Array<() => void> = []
  private viewSaveTimer = 0
  private settleTimer = 0
  private thumbs = new Map<string, { v: string; c: HTMLCanvasElement }>()
  private thumbTimers = new Map<string, number>()
  private pagesTimer = 0
  private lastView = ''
  private st = { inN: 0, inSum: 0, inMax: 0, latSum: 0, latMax: 0, latN: 0, fwSum: 0, fwMax: 0, fwN: 0, events: 0 }

  constructor(o: InkEngineOptions) {
    this.host = o.host
    this.db = o.db ?? appInkDB
    this.noteId = o.noteId
    this.mode = o.mode ?? 'note'
    this.night = o.night ?? document.documentElement.getAttribute('data-theme') !== 'light'
    this.standalone = o.standalone ?? (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches)
    this.markInking = o.markInking ?? true
    this.keysOn = o.keys ?? true
    this.penOnlyMode = o.penOnly ?? 'auto'
    const fd = readFingerDraw()
    this.penOnly = this.penOnlyMode === 'on' ? true : this.penOnlyMode === 'off' ? false : fd === false
    if (this.mode === 'pad') this.view.fixed = true
    this.host.classList.add('ink-host')
    if (this.mode === 'pad') this.host.classList.add('ink-pad')
    this.r = new Renderer(this)
    this.host.appendChild(this.r.stage)
    this.live = new LiveLayer(this.r.stage)
    this.ringEl = document.createElement('div')
    this.ringEl.className = 'ink-ring'
    this.ringEl.innerHTML = '<svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="13" pathLength="100"/></svg>'
    this.r.stage.appendChild(this.ringEl)
    this.input = new InputRouter(this, this.host)
    this.doc = new InkDoc(this.db, this.noteId, {
      strokes: (pm, added, removed) => {
        this.r.strokesChanged(pm, added, removed)
        this.pageTouched(pm)
        this.requestFrame()
      },
      items: (pm) => {
        const pv = this.r.views.get(pm.id)
        if (pv) this.r.items.sync(pv)
        this.pageTouched(pm)
      },
      pages: () => this.relayout(),
      loaded: (pm) => {
        const pv = this.r.views.get(pm.id)
        if (pv) this.r.items.sync(pv)
        this.r.markDirty()
        this.requestFrame()
        this.emitPagesSoon()
      },
      error: (e) => this.emit('error', e instanceof Error ? e : new Error(String(e))),
      saved: () => {},
    })
    this.ready = this.open(o)
  }

  private async open(o: InkEngineOptions): Promise<void> {
    const pad = this.mode === 'pad' ? o.padSize ?? [this.host.clientWidth || 320, this.host.clientHeight || 240] : null
    await this.doc.open(pad ? { template: 'blank', w: pad[0], h: pad[1] } : { template: o.template ?? 'ruled' })
    if (this.destroyed) return
    // 메모 칸: 쪽이 하나뿐이니 미리 읽는다 (다시 붙였을 때 획 · 획 수가 바로 맞게)
    if (this.mode === 'pad' && this.doc.pages[0]) await this.doc.load(this.doc.pages[0])
    if (this.destroyed) return
    const [scratch, penPie, eraserReturn] = await Promise.all([getInkMeta(this.db, 'ink.scratch', true), getInkMeta(this.db, 'ink.penPie', true), getInkMeta(this.db, 'ink.eraserReturn', false)])
    this.prefs = { scratch, penPie, eraserReturn }
    this.readColors()
    this.measure()
    this.view.layout(this.doc.pages.map((p) => p.page), false)
    if (this.mode === 'note') await this.restoreView()
    this.r.syncPages()
    this.input.attach()
    this.attachKeys()
    if (typeof ResizeObserver === 'function') {
      this.ro = new ResizeObserver(() => this.onResize())
      this.ro.observe(this.host)
    }
    const mq = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`)
    const onDpr = () => this.onResize()
    mq.addEventListener?.('change', onDpr)
    this.off.push(() => mq.removeEventListener?.('change', onDpr))
    this.requestFrame()
    this.emit('ready', undefined)
    this.emitPages()
    this.emitHistory()
    this.emit('penOnly', this.penOnly)
  }

  /* ---------- 이벤트 ---------- */

  on<K extends keyof InkEvents>(name: K, fn: Listener<K>): () => void {
    let s = this.listeners.get(name)
    if (!s) this.listeners.set(name, (s = new Set()))
    s.add(fn as (v: unknown) => void)
    return () => s!.delete(fn as (v: unknown) => void)
  }

  emit<K extends keyof InkEvents>(name: K, v: InkEvents[K]): void {
    const s = this.listeners.get(name)
    if (!s) return
    for (const f of [...s]) {
      try {
        f(v)
      } catch (e) {
        console.error('[ink]', name, e)
      }
    }
  }

  /* ---------- 크기 · 보기 ---------- */

  private rectCache: { r: DOMRect; at: number; sx: number; sy: number } | null = null

  /**
   * 화면 좌표(clientX/Y) → 호스트 레이아웃 CSS px. 조상에 transform(열리는 중 scale .96 등)이 있어도 맞다.
   * 사각형은 50ms 동안만 캐시한다(전환 중에도 따라가게).
   */
  toLocal(cx: number, cy: number, fresh = false): [number, number] {
    const now = performance.now()
    let c = this.rectCache
    if (!c || fresh || now - c.at > 50) {
      const r = this.host.getBoundingClientRect()
      c = this.rectCache = { r, at: now, sx: r.width > 0 ? (this.host.clientWidth || r.width) / r.width : 1, sy: r.height > 0 ? (this.host.clientHeight || r.height) / r.height : 1 }
    }
    return [(cx - c.r.left) * c.sx, (cy - c.r.top) * c.sy]
  }

  /** 진단 칸(?diag=1)용: 마지막 값만 덮어쓴다 */
  diag(patch: Partial<InkDiag>): void {
    const w = window as Window & { __inkDiag?: InkDiag }
    w.__inkDiag = Object.assign(w.__inkDiag ?? ({} as InkDiag), patch)
  }

  private measure(): void {
    // 레이아웃 크기로 잰다: 종이가 열리는 중(scale .96 등 transform)에 재면 getBoundingClientRect가 줄어든 크기를 줘서
    // 그 뒤로 펜촉과 잉크가 어긋났다(갤럭시탭 보고). clientWidth/Height는 transform의 영향을 받지 않는다.
    const r = this.host.getBoundingClientRect()
    const dpr = Math.min(3, window.devicePixelRatio || 1)
    this.view.setSize(this.host.clientWidth || Math.round(r.width) || 1, this.host.clientHeight || Math.round(r.height) || 1, dpr)
    this.rectCache = null
    this.r.resize()
    this.live.resize(this.view.W, this.view.H, dpr)
    this.diag({ host: [this.host.clientWidth, this.host.clientHeight, Math.round(r.width), Math.round(r.height)], dpr })
  }

  private onResize(): void {
    if (this.destroyed) return
    const before = [this.view.W, this.view.H, this.view.dpr].join()
    this.measure()
    if ([this.view.W, this.view.H, this.view.dpr].join() === before) return
    this.relayout()
    this.emit('pie', { phase: 'cancel', x: 0, y: 0, pointerType: '', pageId: null, px: 0, py: 0 })
  }

  /** 쪽 목록이 바뀌었을 때: 화면 가운데 쪽의 같은 점을 붙든다 */
  relayout(): void {
    const v = this.view
    const ci = v.centerPage()
    const cb = v.boxes[ci]
    const anchor = cb ? { id: cb.id, dy: v.vy + v.H / (2 * v.s) - cb.y } : null
    v.layout(this.doc.pages.map((p) => p.page), true)
    if (anchor) {
      const nb = v.boxes.find((b) => b.id === anchor.id)
      if (nb) {
        v.vy = nb.y + anchor.dy - v.H / (2 * v.s)
        v.clampView()
      }
    }
    this.r.syncPages()
    this.r.markDirty()
    this.requestFrame()
    this.emitPages()
    this.selectionChanged()
  }

  /** 제스처 시작·끝 (will-change, 멈춘 뒤 다시 그리기) */
  viewChanged(gesture: boolean): void {
    if (this.gestureOn !== gesture) {
      this.gestureOn = gesture
      this.r.setGesture(gesture)
    }
    this.r.markDirty()
    this.requestFrame()
  }

  settleSoon(): void {
    clearTimeout(this.settleTimer)
    this.settleTimer = window.setTimeout(() => this.viewChanged(false), 120)
  }

  requestFrame(): void {
    if (!this.raf && !this.destroyed) this.raf = requestAnimationFrame(this.tick)
  }

  private tick = (now: number): void => {
    this.raf = 0
    if (this.destroyed) return
    const t0 = performance.now()
    const dt = this.lastTick ? now - this.lastTick : 16
    this.lastTick = now
    let more = false
    const moved = this.view.step(now, dt)
    if (moved) {
      this.r.markDirty()
      more = true
      if (!this.view.moving) this.viewChanged(this.gestureOn)
    }
    more = this.r.frame(now, this.gestureOn || this.view.moving ? 5 : 9) || more
    const v = this.view
    const vk = `${v.s.toFixed(5)}|${v.vx.toFixed(2)}|${v.vy.toFixed(2)}`
    if (vk !== this.lastView) {
      this.lastView = vk
      this.emitView(true)
      if (this.sel || this.hoverPt || this.cursorPt) this.drawOverlay()
      if (this.sel) this.selectionChanged()
      this.saveViewSoon()
      more = true
    } else if (this.lastViewMoving) {
      this.emitView(false)
    }
    if (this.fades.length) {
      this.drawFades(now)
      more = true
    }
    if (this.r.diagDirty) this.diag(this.r.diagInfo())
    const fw = performance.now() - t0
    this.st.fwSum += fw
    this.st.fwN++
    if (fw > this.st.fwMax) this.st.fwMax = fw
    if (fw > 12 && import.meta.env.DEV) console.debug('[ink] long frame work', fw.toFixed(1), Math.round(now))
    if (more) this.requestFrame()
  }

  private lastViewMoving = false

  private emitView(moving: boolean): void {
    const v = this.view
    this.lastViewMoving = moving
    const info: ViewInfo = { scale: v.s, fit: v.fit, zoom: v.zoom, page: v.centerPage(), pages: v.boxes.length, moving }
    this.emit('view', info)
  }

  private saveViewSoon(): void {
    if (this.mode !== 'note') return
    clearTimeout(this.viewSaveTimer)
    this.viewSaveTimer = window.setTimeout(() => void this.saveView(), 600)
  }

  private async saveView(): Promise<void> {
    const v = this.view
    const i = v.centerPage()
    const b = v.boxes[i]
    if (!b) return
    await setInkMeta(this.db, `ink.view.${this.noteId}`, { pageId: b.id, y: v.vy - b.y, zoom: v.zoom })
  }

  private async restoreView(): Promise<void> {
    const s = await getInkMeta<{ pageId: string; y: number; zoom: number } | null>(this.db, `ink.view.${this.noteId}`, null)
    if (!s) return
    const v = this.view
    const b = v.boxes.find((x) => x.id === s.pageId)
    if (!b) return
    v.s = Math.max(v.fit, Math.min(v.maxS, v.fit * (s.zoom || 1)))
    v.vx = -v.W / (2 * v.s)
    v.vy = b.y + s.y
    v.clampView()
  }

  /* ---------- 쓰는 중 (하늘 쉼 · data-inking) ---------- */

  private setActive(on: boolean): void {
    clearTimeout(this.activeTimer)
    if (on === this.activeOn) return
    this.activeOn = on
    if (this.markInking) {
      inkingCount += on ? 1 : -1
      if (inkingCount > 0) document.documentElement.setAttribute('data-inking', '')
      else {
        inkingCount = 0
        document.documentElement.removeAttribute('data-inking')
      }
    }
    this.emit('active', on)
  }

  get isActive(): boolean {
    return this.activeOn
  }

  /** 첫 잉크를 그린 뒤 (도구 칸 접힘은 다음 rAF) */
  inkStarted(tool: ToolName, x: number, y: number): void {
    this.setActive(true)
    this.emit('inkstart', { tool, x, y })
  }

  inkEnded(x: number, y: number): void {
    clearTimeout(this.activeTimer)
    this.activeTimer = window.setTimeout(() => this.setActive(false), T.activeTailMs)
    this.emit('inkend', { tool: this.tool, x, y })
  }

  /* ---------- 입력에서 부르는 것 ---------- */

  focusEngine(): void {
    active = this
  }

  penSeen(): void {
    if (this.penOnlyMode !== 'auto' || this.penOnly) return
    this.penOnly = true
    try {
      localStorage.setItem(FINGER_KEY, '0')
    } catch {
      /* 없음 */
    }
    void setInkMeta(this.db, 'ink.fingerDraw', false)
    this.emit('penOnly', true)
  }

  setPenOnly(mode: PenOnlyMode): void {
    this.penOnlyMode = mode
    const fd = readFingerDraw()
    this.penOnly = mode === 'on' ? true : mode === 'off' ? false : fd === false
    this.emit('penOnly', this.penOnly)
  }

  /** 손가락으로 쓰기 켬·끔 (⌘K 'ink.toggle.finger') */
  setFingerDraw(on: boolean): void {
    try {
      localStorage.setItem(FINGER_KEY, on ? '1' : '0')
    } catch {
      /* 없음 */
    }
    void setInkMeta(this.db, 'ink.fingerDraw', on)
    this.penOnlyMode = 'auto'
    this.penOnly = !on
    this.emit('penOnly', this.penOnly)
  }

  setPrefs(p: Partial<InkPrefs>): void {
    this.prefs = { ...this.prefs, ...p }
    if (p.scratch !== undefined) void setInkMeta(this.db, 'ink.scratch', p.scratch)
    if (p.penPie !== undefined) void setInkMeta(this.db, 'ink.penPie', p.penPie)
    if (p.eraserReturn !== undefined) void setInkMeta(this.db, 'ink.eraserReturn', p.eraserReturn)
  }

  recordInput(ms: number, ts: number, n: number): void {
    const s = this.st
    s.inN++
    s.events += n
    s.inSum += ms
    if (ms > s.inMax) s.inMax = ms
    const lat = performance.now() - ts
    if (lat >= 0 && lat < 1000) {
      s.latN++
      s.latSum += lat
      if (lat > s.latMax) s.latMax = lat
    }
  }

  stats(reset = false): InkStats {
    const s = this.st
    const out: InkStats = {
      strokes: this.doc.strokeCount,
      pages: this.doc.pages.length,
      loadedPages: this.doc.pages.filter((p) => p.state === 'ready').length,
      visiblePages: this.r.visibleCount(),
      canvasMPx: Math.round(this.r.canvasPx / 1e4) / 100,
      inputAvg: s.inN ? s.inSum / s.inN : 0,
      inputMax: s.inMax,
      inputEvents: s.events,
      latencyAvg: s.latN ? s.latSum / s.latN : 0,
      latencyMax: s.latMax,
      frameWorkMax: s.fwMax,
      frameWorkAvg: s.fwN ? s.fwSum / s.fwN : 0,
      jobs: this.r.pendingJobs,
    }
    if (reset) this.st = { inN: 0, inSum: 0, inMax: 0, latSum: 0, latMax: 0, latN: 0, fwSum: 0, fwMax: 0, fwN: 0, events: 0 }
    return out
  }

  /** 화면 점 → 쪽 */
  pageAtScreen(x: number, y: number, tolPx = 0): { pm: PageModel; box: PageBox; px: number; py: number } | null {
    const v = this.view
    const [wx, wy] = v.toWorld(x, y)
    const i = v.pageAt(wx, wy, tolPx / v.s)
    const box = v.boxes[i]
    if (!box) return null
    const pm = this.doc.byId.get(box.id)
    if (!pm) return null
    return { pm, box, px: wx - box.x, py: wy - box.y }
  }

  boxOf(pm: PageModel): PageBox | undefined {
    return this.view.boxes.find((b) => b.id === pm.id)
  }

  private penSpec(tool: 'pen' | 'highlighter') {
    const isHL = tool === 'highlighter'
    return {
      tool,
      kind: this.pen.kind,
      color: isHL ? this.hl.color : this.pen.color,
      width: isHL ? this.hl.width : this.pen.width,
      pressure: this.pen.pressure,
      straight: this.hl.straight,
      shapeOnce: !isHL && this.shapeArmed,
      shapeHold: !isHL,
      scratch: this.prefs.scratch,
      pieMs: 0,
    }
  }

  /** 누른 순간: 도구 · 고른 것 · 물건에 따라 세션을 고른다 */
  beginSession(p: InPt): Session | null {
    this.finishFades()
    if (this.r.items.editing) {
      // 글 상자 밖을 누르면 편집만 끝낸다 (점을 찍지 않는다)
      ;(document.activeElement as HTMLElement | null)?.blur?.()
      this.endTextEdit()
      return NULL_SESSION
    }
    if (this.sel) {
      const h = this.selHandleAt(p.x, p.y)
      if (h) return new SelectDragSession(this, h, p)
      this.clearSelection()
      if (this.tool !== 'lasso') return NULL_SESSION
    }
    const hit = this.pageAtScreen(p.x, p.y, this.tool === 'lasso' || this.tool === 'hand' ? 24 : 0)
    if (this.tool === 'hand') return new PanSession(this, p)
    if (!hit) return null
    const { pm, box, px, py } = hit
    if (pm.state !== 'ready') void this.doc.load(pm)
    const item = this.itemAt(pm, px, py)
    const longMs = p.type === 'touch' ? T.fingerLongMs : p.type === 'pen' ? T.penLongMs : T.mouseLongMs
    switch (this.tool) {
      case 'pen':
      case 'highlighter': {
        const tool = this.tool
        const spec = this.penSpec(tool)
        const mkPen = (first: InPt, pieOk: boolean) => {
          const empty = pieOk && this.isEmptyAt(pm, px, py)
          return new PenSession(this, pm, box, { ...spec, pieMs: empty && (p.type !== 'pen' || this.prefs.penPie) ? longMs : 0 }, first, empty)
        }
        if (item) {
          // 테이프: 누르면 걷기·붙이기, 끌면 쓰기. 사진·글: 길게 누르면 고르기
          return new TapSession(
            p,
            (q) => (item.kind === 'tape' ? this.toggleTape(pm, item, [px, py]) : this.tapPage(pm, px, py, tool, q)),
            (first) => mkPen(first, false),
            longMs,
            () => this.select(pm, [], [item.id]),
          )
        }
        return mkPen(p, true)
      }
      case 'eraser':
        return new EraserSession(this, pm, box, this.eraser.mode, this.eraser.size, p)
      case 'lasso':
        return new LassoSession(this, pm, box, p)
      case 'tape':
        if (item?.kind === 'tape') return new TapSession(p, () => this.toggleTape(pm, item, [px, py]), (first) => new TapeSession(this, pm, box, this.tape.color, this.tape.width, first), longMs, () => this.select(pm, [], [item.id]))
        return new TapeSession(this, pm, box, this.tape.color, this.tape.width, p)
      case 'text':
        return new TapSession(p, () => this.tapPage(pm, px, py, 'text'), () => null)
    }
    return null
  }

  /**
   * 밖에서 받은 점으로 획을 쓴다 (메모 칸 첫 펜 버퍼 · 시험). 점은 화면 좌표(clientX/Y).
   * 끝난 획은 injectStroke, 아직 누르고 있는 획은 externalStroke로 이어 받는다.
   */
  externalStroke(first: { clientX: number; clientY: number; pressure: number; t: number; type: string }): { move(p: typeof first): void; up(p: typeof first | null): void } | null {
    const conv = (p: typeof first): InPt => {
      const [x, y] = this.toLocal(p.clientX, p.clientY, true)
      return { x, y, p: p.pressure, t: p.t, ts: p.t - performance.timeOrigin, type: p.type, alt: Math.PI / 2 }
    }
    const s = this.beginSession(conv(first))
    if (!s) return null
    return { move: (p) => s.move([conv(p)], null), up: (p) => s.up(p ? conv(p) : null) }
  }

  injectStroke(pts: Array<{ clientX: number; clientY: number; pressure: number; t: number; type: string }>): void {
    if (!pts.length) return
    const h = this.externalStroke(pts[0]!)
    if (!h) return
    for (let i = 1; i < pts.length - 1; i++) h.move(pts[i]!)
    h.up(pts.length > 1 ? pts[pts.length - 1]! : null)
  }

  /** 펜·마우스 길게 누르기(빈 곳) → 둥근 메뉴: 같은 포인터를 메뉴 세션으로 */
  becomePie(down: InPt, pm: PageModel, box: PageBox): void {
    const px = this.view.vx + down.x / this.view.s - box.x
    const py = this.view.vy + down.y / this.view.s - box.y
    this.pie = { pageId: pm.id, px, py, type: down.type }
    this.input.replaceSession(new PieSession(this))
    this.emit('pie', { phase: 'open', x: down.x, y: down.y, pointerType: down.type, pageId: pm.id, px, py })
  }

  pieEvent(phase: PieEvent['phase'], x: number, y: number, type: string): void {
    const p = this.pie
    this.emit('pie', { phase, x, y, pointerType: type || p?.type || '', pageId: p?.pageId ?? null, px: p?.px ?? 0, py: p?.py ?? 0 })
    if (phase !== 'move') this.pie = null
  }

  /** 손가락 길게 누르기 (펜만 쓰기): 빈 곳 → 둥근 메뉴, 잉크·물건 → 고르기(그대로 끌면 옮긴다) */
  fingerLong(x: number, y: number): Session | null {
    const hit = this.pageAtScreen(x, y)
    if (!hit) return null
    const { pm, box, px, py } = hit
    const item = this.itemAt(pm, px, py)
    const pt: InPt = { x, y, p: 0.5, t: performance.timeOrigin + performance.now(), ts: performance.now(), type: 'touch', alt: Math.PI / 2 }
    if (item) {
      this.select(pm, [], [item.id])
      return new SelectDragSession(this, 'move', pt)
    }
    const s = this.strokeAt(pm, px, py, T.emptyRadius / this.view.s)
    if (s) {
      this.select(pm, this.clusterOf(pm, s).map((m) => m.id), [])
      return new SelectDragSession(this, 'move', pt)
    }
    this.becomePieTouch(pm, box, x, y, px, py)
    return new PieSession(this)
  }

  private becomePieTouch(pm: PageModel, _box: PageBox, x: number, y: number, px: number, py: number): void {
    this.pie = { pageId: pm.id, px, py, type: 'touch' }
    this.emit('pie', { phase: 'open', x, y, pointerType: 'touch', pageId: pm.id, px, py })
  }

  /** 마우스 오른쪽 클릭: 빈 곳 = 메뉴(고정), 잉크·물건 = 고르기 */
  contextAt(p: InPt): void {
    const hit = this.pageAtScreen(p.x, p.y)
    if (!hit) return
    const { pm, px, py } = hit
    const item = this.itemAt(pm, px, py)
    if (item) return this.select(pm, [], [item.id])
    const s = this.strokeAt(pm, px, py, T.emptyRadius / this.view.s)
    if (s) return this.select(pm, this.clusterOf(pm, s).map((m) => m.id), [])
    this.clearSelection()
    this.pie = { pageId: pm.id, px, py, type: 'mouse' }
    this.emit('pie', { phase: 'open', x: p.x, y: p.y, pointerType: 'mouse', pageId: pm.id, px, py })
    this.pie = null
  }

  /** 손가락 탭 (펜만 쓰기) */
  fingerTap(x: number, y: number): void {
    const hit = this.pageAtScreen(x, y)
    if (this.sel) {
      if (!this.selHandleAt(x, y)) this.clearSelection()
      return
    }
    if (!hit) return
    const { pm, px, py } = hit
    const item = this.itemAt(pm, px, py)
    if (item?.kind === 'tape') {
      if (this.tool === 'lasso') return this.select(pm, [], [item.id])
      if (this.tool === 'eraser') return this.deleteItems(pm, [item.id])
      return this.toggleTape(pm, item, [px, py])
    }
    if (item?.kind === 'text' && this.tool === 'text') return this.editText(pm, item, false)
    if (this.tool === 'text') this.tapPage(pm, px, py, 'text')
  }

  /** 쪽 위 누르기 (세션이 누르기로 끝났을 때) */
  tapPage(pm: PageModel, px: number, py: number, tool: string, q?: InPt): void {
    const item = this.itemAt(pm, px, py)
    if (tool === 'text') {
      if (item?.kind === 'text') return this.editText(pm, item, false)
      if (item?.kind === 'tape') return this.toggleTape(pm, item, [px, py])
      return void this.insertText({ pageId: pm.id, x: px, y: py })
    }
    if (tool === 'tape') {
      if (item?.kind === 'tape') this.toggleTape(pm, item, [px, py])
      return
    }
    // 펜·형광으로 사진·글 위를 톡: 점 하나 (보통 쓰기)
    if ((tool === 'pen' || tool === 'highlighter') && q) {
      const box = this.boxOf(pm)
      if (!box) return
      const s = new PenSession(this, pm, box, this.penSpec(tool as 'pen' | 'highlighter'), q, false)
      s.up(q)
    }
  }

  hover(p: InPt | null): void {
    if (!p) {
      if (this.hoverPt) {
        this.hoverPt = null
        this.drawOverlay()
      }
      this.emit('hover', null)
      return
    }
    this.emit('hover', { x: p.x, y: p.y, type: p.type })
    const show = (p.type === 'pen' && (this.tool === 'pen' || this.tool === 'highlighter')) || this.tool === 'eraser'
    if (!show && !this.hoverPt) return
    this.hoverPt = show ? { x: p.x, y: p.y, type: p.type } : null
    this.drawOverlay()
  }

  cursor(x: number | null, y = 0, type = ''): void {
    this.cursorPt = x === null ? null : { x, y, type }
    this.drawOverlay()
  }

  /* ---------- 고리 예고 (펜 길게 누르기 300→600ms) ---------- */

  ringStart(x: number, y: number, type: string): void {
    if (type !== 'pen') return
    const el = this.ringEl
    el.style.transform = `translate(${x - 20}px, ${y - 20}px)`
    el.classList.remove('is-on')
    void el.offsetWidth
    el.classList.add('is-on')
  }

  ringStop(): void {
    this.ringEl.classList.remove('is-on')
  }

  /* ---------- 맞히기 ---------- */

  itemAt(pm: PageModel, px: number, py: number): InkItem | null {
    const items = pm.itemsSorted()
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i]!
      const size = it.kind === 'text' ? this.r.items.measure(pm.id, it.id) ?? { w: it.w, h: it.h } : { w: it.w, h: it.h }
      const m = itemMatrix({ ...it, w: size.w, h: size.h })
      const [lx, ly] = mApply(inv(m), px, py)
      if (lx >= 0 && ly >= 0 && lx <= size.w && ly <= size.h) return it
    }
    return null
  }

  strokeAt(pm: PageModel, px: number, py: number, r: number): StrokeModel | null {
    const c = pm.query([px - r, py - r, px + r, py + r])
    for (let i = c.length - 1; i >= 0; i--) {
      const m = c[i]!
      if (m.hidden) continue
      const pts = m.pts
      const rr = r + m.row.width / 2
      for (let j = 0; j < m.n; j++) {
        const dx = pts[j * 4]! - px, dy = pts[j * 4 + 1]! - py
        if (dx * dx + dy * dy <= rr * rr) return m
        if (j) {
          const ax = pts[j * 4 - 4]!, ay = pts[j * 4 - 3]!
          const ex = pts[j * 4]! - ax, ey = pts[j * 4 + 1]! - ay
          const l2 = ex * ex + ey * ey
          const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * ex + (py - ay) * ey) / l2)) : 0
          const qx = ax + t * ex - px, qy = ay + t * ey - py
          if (qx * qx + qy * qy <= rr * rr) return m
        }
      }
    }
    return null
  }

  hitAt(pm: PageModel, px: number, py: number, r: number): { item?: InkItem; stroke?: StrokeModel } | null {
    const item = this.itemAt(pm, px, py)
    if (item) return { item }
    const stroke = this.strokeAt(pm, px, py, r)
    return stroke ? { stroke } : null
  }

  isEmptyAt(pm: PageModel, px: number, py: number): boolean {
    return !this.hitAt(pm, px, py, T.emptyRadius / this.view.s)
  }

  /** 24pt 안에 이어진 획 묶음 (같은 줄: 세로로 겹치는 것만 잇는다) */
  clusterOf(pm: PageModel, seed: StrokeModel): StrokeModel[] {
    const g = T.clusterGap
    const out = new Set<StrokeModel>([seed])
    const queue = [seed]
    while (queue.length && out.size < 400) {
      const m = queue.shift()!
      const b = m.bbox
      for (const n of pm.query([b[0] - g, b[1] - 4, b[2] + g, b[3] + 4])) {
        if (out.has(n) || n.hidden || n.row.layer !== seed.row.layer) continue
        const vOverlap = Math.min(b[3], n.bbox[3]) - Math.max(b[1], n.bbox[1])
        if (vOverlap < -4) continue
        out.add(n)
        queue.push(n)
      }
    }
    return [...out].sort(zCompare)
  }

  /* ---------- 획 확정 · 명령 ---------- */

  /** 펜 획 하나 확정: 메모리 → 정적 층(같은 프레임) → 저장 큐 → 되돌리기 */
  commitStroke(pm: PageModel, row: InkStroke): void {
    const cmd: Command = { label: 'stroke', before: { strokes: [deleted(row, row.updatedAt)] }, after: { strokes: [row] }, pageId: pm.id }
    this.doc.apply(cmd.after)
    this.doc.persist(cmd.after)
    this.history.push(cmd)
    this.strokesAdded++
    this.emitHistory()
    this.emit('stroke', { pageId: pm.id, id: row.id, tool: row.tool })
    this.emit('change', { pageIds: [pm.id] })
  }

  /** 명령을 기록한다. applied = 이미 메모리에 반영됨 */
  pushCommand(cmd: Command, applied = false): void {
    if (!applied) this.doc.apply(cmd.after)
    this.doc.persist(cmd.after)
    this.history.push(cmd)
    this.emitHistory()
    this.emit('change', { pageIds: cmd.pageId ? [cmd.pageId] : [] })
  }

  private emitHistory(): void {
    this.emit('history', { canUndo: this.history.canUndo, canRedo: this.history.canRedo })
  }

  /** 긁어 지우기: 긁은 획(저장 안 함)과 겹친 획을 함께 지운다 (1단계) */
  scratchErase(pm: PageModel, _box: PageBox, scratch: InkStroke, hits: StrokeModel[]): void {
    const now = Date.now()
    const scratchModel = new StrokeModel(scratch)
    this.live.clear()
    this.fadeStrokes(pm, [...hits, scratchModel], 'out', 140)
    const before = hits.map((m) => ({ ...m.row, updatedAt: now }))
    const after = hits.map((m) => deleted(m.row, now))
    this.pushCommand({ label: 'scratch', before: { strokes: before }, after: { strokes: after }, pageId: pm.id })
  }

  undo(): boolean {
    return this.step('undo')
  }

  redo(): boolean {
    return this.step('redo')
  }

  private undoRun = 0
  private undoRunAt = 0

  private step(kind: 'undo' | 'redo'): boolean {
    this.finishFades()
    if (this.r.items.editing) this.endTextEdit()
    const c = kind === 'undo' ? this.history.undo() : this.history.redo()
    const now = performance.now()
    this.undoRun = now - this.undoRunAt < 800 ? this.undoRun + 1 : 1
    this.undoRunAt = now
    if (!c) {
      this.emit('undo', { kind, ok: false, n: this.undoRun })
      return false
    }
    const snap = stamp(kind === 'undo' ? c.before : c.after)
    // 모션: 사라지는 획은 120ms 페이드 아웃, 되살아나는 획은 페이드 인. 화면 밖이면 먼저 그곳으로
    const outs = new Map<PageModel, StrokeModel[]>()
    for (const r of snap.strokes ?? []) {
      if (!r.deletedAt) continue
      const pm = this.doc.byId.get(r.pageId)
      const m = pm?.strokes.get(r.id)
      if (pm && m && m.row.layer === 'ink') outs.set(pm, [...(outs.get(pm) ?? []), m])
    }
    if (this.sel) this.clearSelection()
    this.doc.apply(snap)
    this.doc.persist(snap)
    for (const [pm, ms] of outs) this.fadeStrokes(pm, ms, 'out', 120)
    const ins = new Map<PageModel, StrokeModel[]>()
    for (const r of snap.strokes ?? []) {
      if (r.deletedAt) continue
      const pm = this.doc.byId.get(r.pageId)
      const m = pm?.strokes.get(r.id)
      if (pm && m && m.row.layer === 'ink') ins.set(pm, [...(ins.get(pm) ?? []), m])
    }
    for (const [pm, ms] of ins) this.fadeStrokes(pm, ms, 'in', 120)
    this.revealChange(snap)
    this.emitHistory()
    this.emit('undo', { kind, ok: true, n: this.undoRun })
    this.emit('change', { pageIds: c.pageId ? [c.pageId] : [] })
    return true
  }

  /** 바뀐 곳이 화면 밖이면 그곳으로 (320ms) */
  private revealChange(s: Snap): void {
    let pageId: string | null = null
    let b: BBox | null = null
    for (const r of s.strokes ?? []) {
      pageId ??= r.pageId
      if (r.pageId !== pageId) continue
      b = b ? [Math.min(b[0], r.bbox[0]), Math.min(b[1], r.bbox[1]), Math.max(b[2], r.bbox[2]), Math.max(b[3], r.bbox[3])] : [...r.bbox]
    }
    for (const it of s.items ?? []) {
      pageId ??= it.pageId
      if (it.pageId !== pageId) continue
      const ib: BBox = [it.x, it.y, it.x + it.w, it.y + it.h]
      b = b ? [Math.min(b[0], ib[0]), Math.min(b[1], ib[1]), Math.max(b[2], ib[2]), Math.max(b[3], ib[3])] : ib
    }
    if (!pageId) pageId = s.pages?.[0]?.id ?? null
    if (!pageId) return
    const i = this.view.boxes.findIndex((x) => x.id === pageId)
    if (i < 0) return
    if (b ? this.view.reveal(i, b[1], b[3], 320) : false) this.requestFrame()
  }

  /** 두·세 손가락 탭 · 대고 있기 */
  gestureUndo(kind: 'undo' | 'redo', n: number): void {
    if (n === 1 && this.interceptTap?.(kind)) return
    if (this.pie) {
      this.pieEvent('cancel', NaN, NaN, '')
      return
    }
    this.step(kind)
  }

  /* ---------- 페이드 (지우개 · 긁기 · 되돌리기) ---------- */

  fadeStrokes(pm: PageModel, models: StrokeModel[], dir: 'in' | 'out', dur: number): void {
    const ms = models.filter((m) => m.row.layer === 'ink')
    if (!ms.length || this.input.session?.usesLive || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    if (dir === 'in') {
      let b: BBox | null = null
      for (const m of ms) {
        m.hidden = true
        b = b ? [Math.min(b[0], m.bbox[0]), Math.min(b[1], m.bbox[1]), Math.max(b[2], m.bbox[2]), Math.max(b[3], m.bbox[3])] : [...m.bbox]
      }
      if (b) this.r.redraw(pm, b, ['ink'])
    }
    this.fades.push({ pm, models: ms, t0: performance.now(), dur, dir })
    this.requestFrame()
  }

  private drawFades(now: number): void {
    const L = this.live
    if (this.input.session?.usesLive) return this.finishFades()
    L.actx.setTransform(1, 0, 0, 1, 0, 0)
    L.actx.clearRect(0, 0, L.a.width, L.a.height)
    const v = this.view
    const k = v.s * v.dpr
    const keep: Fade[] = []
    for (const f of this.fades) {
      const t = Math.min(1, (now - f.t0) / f.dur)
      const box = this.boxOf(f.pm)
      if (box && t < 1) {
        const ctx = L.actx
        ctx.save()
        L.clipPage(ctx, v, box)
        L.pageTransform(ctx, v, box)
        ctx.globalAlpha = f.dir === 'out' ? 1 - t : t
        const look = { dark: this.r.views.get(f.pm.id)?.spec.dark ?? this.night }
        for (const m of f.models) drawStroke(ctx, m, look, k)
        ctx.restore()
        keep.push(f)
      } else this.endFade(f)
    }
    L.aDirty = keep.length > 0
    this.fades = keep
    if (!keep.length) L.clearA()
  }

  private endFade(f: Fade): void {
    if (f.dir !== 'in') return
    let b: BBox | null = null
    for (const m of f.models) {
      m.hidden = false
      b = b ? [Math.min(b[0], m.bbox[0]), Math.min(b[1], m.bbox[1]), Math.max(b[2], m.bbox[2]), Math.max(b[3], m.bbox[3])] : [...m.bbox]
    }
    if (b) this.r.redraw(f.pm, b, ['ink'])
  }

  finishFades(): void {
    if (!this.fades.length) return
    for (const f of this.fades) this.endFade(f)
    this.fades = []
    this.live.clearA()
  }

  /* ---------- 덧층 (올가미 · 고른 상자 · 지우개 원 · 펜 호버 · 테이프 미리) ---------- */

  readColors(): void {
    const cs = getComputedStyle(this.host)
    const g = (n: string, f: string) => cs.getPropertyValue(n).trim() || f
    this.colors = { t1: g('--text-1', '#F2EFE8'), t2: g('--text-2', '#B9BDCB'), t3: g('--text-3', '#8E94A8'), paper: this.night ? '#0E1322' : '#FBFAF7' }
  }

  drawLasso(box: PageBox, poly: number[]): void {
    this.lassoState = { box, poly }
    this.drawOverlay()
  }

  drawTapePreview(box: PageBox, rect: { x: number; y: number; w: number; h: number; rot: number } | null, color: string): void {
    this.tapePrev = { box, rect, color }
    this.drawOverlay()
  }

  private drawOverlay(): void {
    const s = this.input.session
    if (s && s.kind === 'pen') return
    const L = this.live
    const ctx = L.bctx
    const v = this.view
    const dpr = v.dpr
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, L.b.width, L.b.height)
    L.tail = null
    let any = false
    if (this.lassoState && s?.kind === 'lasso') {
      const { box, poly } = this.lassoState
      const k = v.s * dpr
      const ox = v.tx * dpr + box.x * k, oy = v.ty * dpr + box.y * k
      ctx.lineWidth = dpr
      ctx.setLineDash([4 * dpr, 4 * dpr])
      ctx.strokeStyle = this.colors.t2
      ctx.beginPath()
      for (let i = 0; i + 1 < poly.length; i += 2) (i ? ctx.lineTo : ctx.moveTo).call(ctx, ox + poly[i]! * k, oy + poly[i + 1]! * k)
      ctx.stroke()
      if (poly.length >= 4) {
        ctx.globalAlpha = 0.4
        ctx.beginPath()
        ctx.moveTo(ox + poly[poly.length - 2]! * k, oy + poly[poly.length - 1]! * k)
        ctx.lineTo(ox + poly[0]! * k, oy + poly[1]! * k)
        ctx.stroke()
        ctx.globalAlpha = 1
      }
      ctx.setLineDash([])
      any = true
    } else this.lassoState = null
    if (this.tapePrev && s?.kind === 'tape') {
      const { box, rect, color } = this.tapePrev
      if (rect) {
        const k = v.s * dpr
        ctx.save()
        ctx.setTransform(k, 0, 0, k, v.tx * dpr + box.x * k, v.ty * dpr + box.y * k)
        const m = itemMatrix(rect)
        ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5])
        ctx.globalAlpha = 0.6
        ctx.fillStyle = color
        ctx.fillRect(0, 0, rect.w, rect.h)
        ctx.restore()
      }
      any = true
    } else this.tapePrev = null
    if (this.sel) {
      this.drawSelection(ctx)
      any = true
    }
    const c = this.cursorPt ?? this.hoverPt
    if (c) {
      if (this.tool === 'eraser') {
        ctx.lineWidth = dpr
        ctx.strokeStyle = this.colors.t2
        ctx.beginPath()
        ctx.arc(c.x * dpr, c.y * dpr, Math.max(2, (this.eraser.size / 2) * v.s) * dpr, 0, Math.PI * 2)
        ctx.stroke()
        any = true
      } else if (c.type === 'pen' && (this.tool === 'pen' || this.tool === 'highlighter')) {
        const hit = this.pageAtScreen(c.x, c.y)
        const dark = hit ? (this.r.views.get(hit.pm.id)?.spec.dark ?? this.night) : this.night
        const col = this.tool === 'highlighter' ? this.hl.color : inkColor(this.pen.color, dark)
        const w = (this.tool === 'highlighter' ? this.hl.width : this.pen.width) * v.s
        ctx.globalAlpha = 0.5
        ctx.fillStyle = col
        ctx.beginPath()
        ctx.arc(c.x * dpr, c.y * dpr, Math.max(1, w / 2) * dpr, 0, Math.PI * 2)
        ctx.fill()
        ctx.globalAlpha = 1
        any = true
      }
    }
    L.bDirty = any
  }

  /* ---------- 고르기 ---------- */

  select(pm: PageModel, strokeIds: string[], itemIds: string[]): void {
    if (!strokeIds.length && !itemIds.length) return this.clearSelection()
    let b: BBox | null = null
    for (const id of strokeIds) {
      const m = pm.strokes.get(id)
      if (!m) continue
      b = b ? [Math.min(b[0], m.bbox[0]), Math.min(b[1], m.bbox[1]), Math.max(b[2], m.bbox[2]), Math.max(b[3], m.bbox[3])] : [...m.bbox]
    }
    for (const id of itemIds) {
      const it = pm.items.get(id)
      if (!it) continue
      const size = it.kind === 'text' ? this.r.items.measure(pm.id, it.id) ?? it : it
      const ib = bboxTransform([0, 0, size.w, size.h], itemMatrix({ ...it, w: size.w, h: size.h }))
      b = b ? [Math.min(b[0], ib[0]), Math.min(b[1], ib[1]), Math.max(b[2], ib[2]), Math.max(b[3], ib[3])] : ib
    }
    if (!b) return this.clearSelection()
    // 하나만 고른 돌아간 물건은 그 각도의 상자로
    let m: Mat = IDENT
    if (!strokeIds.length && itemIds.length === 1) {
      const it = pm.items.get(itemIds[0]!)!
      const size = it.kind === 'text' ? this.r.items.measure(pm.id, it.id) ?? it : it
      if (it.rot) {
        b = [it.x + it.w / 2 - size.w / 2, it.y + it.h / 2 - size.h / 2, it.x + it.w / 2 + size.w / 2, it.y + it.h / 2 + size.h / 2]
        const c = Math.cos(it.rot), s = Math.sin(it.rot)
        const cx = it.x + it.w / 2, cy = it.y + it.h / 2
        m = [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy]
      }
    }
    this.sel = { pageId: pm.id, strokes: new Set(strokeIds), items: new Set(itemIds), box: b, m }
    this.drawOverlay()
    this.selectionChanged()
  }

  clearSelection(): void {
    if (!this.sel) return
    this.sel = null
    this.dragM = null
    this.drawOverlay()
    this.selectionChanged()
  }

  selectAll(): void {
    const pm = this.currentPage()
    if (!pm) return
    this.select(pm, [...pm.strokes.keys()], [...pm.items.keys()])
  }

  get selectionInfo(): SelectionInfo | null {
    const s = this.sel
    if (!s) return null
    const pm = this.doc.byId.get(s.pageId)
    if (!pm) return null
    const poly = this.selScreenPoly()
    const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1])
    const x0 = Math.min(...xs), y0 = Math.min(...ys)
    let color: string | null | undefined = undefined
    let hl = s.strokes.size > 0
    for (const id of s.strokes) {
      const m = pm.strokes.get(id)
      if (!m) continue
      if (m.row.layer !== 'highlight') hl = false
      color = color === undefined ? m.row.color : color === m.row.color ? color : null
    }
    const kinds = new Set<string>()
    if (s.strokes.size) kinds.add('ink')
    let flag: boolean | null = null
    for (const id of s.items) {
      const it = pm.items.get(id)
      if (!it) continue
      kinds.add(it.kind)
      if (it.kind === 'tape') flag = !!it.flag
      if (it.kind !== 'image') color = color === undefined ? (it.color ?? null) : color === (it.color ?? null) ? color : null
    }
    return {
      pageId: s.pageId,
      strokes: s.strokes.size,
      items: s.items.size,
      only: kinds.size === 1 ? ([...kinds][0] as SelectionInfo['only']) : 'mixed',
      rect: { x: x0, y: y0, w: Math.max(...xs) - x0, h: Math.max(...ys) - y0 },
      color: color ?? null,
      highlight: hl,
      dragging: !!this.dragM,
      flag,
    }
  }

  private selectionChanged(): void {
    this.emit('selection', this.selectionInfo)
  }

  private selPageBox(): PageBox | null {
    return this.sel ? (this.view.boxes.find((b) => b.id === this.sel!.pageId) ?? null) : null
  }

  /** 고른 상자의 네 모서리 (쪽 좌표, 지금 끄는 변환 포함): nw ne se sw */
  selCorners(withDrag = false): Array<[number, number]> {
    const s = this.sel!
    const m = withDrag && this.dragM ? mul(this.dragM, s.m) : s.m
    const [x0, y0, x1, y1] = s.box
    return [mApply(m, x0, y0), mApply(m, x1, y0), mApply(m, x1, y1), mApply(m, x0, y1)]
  }

  selCenter(): [number, number] {
    const s = this.sel!
    return mApply(s.m, (s.box[0] + s.box[2]) / 2, (s.box[1] + s.box[3]) / 2)
  }

  toSelPage(x: number, y: number): [number, number] {
    const b = this.selPageBox()
    const [wx, wy] = this.view.toWorld(x, y)
    return b ? [wx - b.x, wy - b.y] : [wx, wy]
  }

  /** 화면 px의 상자 다각형 (여백 8px) */
  private selScreenPoly(): Array<[number, number]> {
    const b = this.selPageBox()
    if (!b || !this.sel) return [[0, 0], [0, 0], [0, 0], [0, 0]]
    const v = this.view
    const c = this.selCorners(true).map(([x, y]) => v.toScreen(b.x + x, b.y + y))
    const [c0, c1, , c3] = c as [[number, number], [number, number], [number, number], [number, number]]
    let ux = c1[0] - c0[0], uy = c1[1] - c0[1]
    let vx = c3[0] - c0[0], vy = c3[1] - c0[1]
    const ul = Math.hypot(ux, uy) || 1, vl = Math.hypot(vx, vy) || 1
    ux /= ul
    uy /= ul
    vx /= vl
    vy /= vl
    const M = 8
    const sgn = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const
    return c.map(([x, y], i) => [x + (sgn[i]![0] * ux + sgn[i]![1] * vx) * M, y + (sgn[i]![0] * uy + sgn[i]![1] * vy) * M] as [number, number])
  }

  private rotHandle(poly: Array<[number, number]>): { at: [number, number]; base: [number, number] } {
    const [c0, c1, , c3] = poly as [[number, number], [number, number], [number, number], [number, number]]
    const mx = (c0[0] + c1[0]) / 2, my = (c0[1] + c1[1]) / 2
    let vx = c3[0] - c0[0], vy = c3[1] - c0[1]
    const vl = Math.hypot(vx, vy) || 1
    vx /= vl
    vy /= vl
    return { at: [mx - vx * 24, my - vy * 24], base: [mx, my] }
  }

  selHandleAt(x: number, y: number): Handle | null {
    if (!this.sel) return null
    const poly = this.selScreenPoly()
    const r = T.handleHit / 2
    const rh = this.rotHandle(poly)
    if (Math.hypot(x - rh.at[0], y - rh.at[1]) <= r) return 'rot'
    const names: Handle[] = ['nw', 'ne', 'se', 'sw']
    for (let i = 0; i < 4; i++) if (Math.hypot(x - poly[i]![0], y - poly[i]![1]) <= r) return names[i]!
    if (pointInPoly(x, y, poly.flat())) return 'move'
    return null
  }

  private drawSelection(ctx: CanvasRenderingContext2D): void {
    const dpr = this.view.dpr
    const poly = this.selScreenPoly().map(([x, y]) => [x * dpr, y * dpr] as [number, number])
    ctx.save()
    ctx.lineWidth = dpr
    ctx.strokeStyle = this.colors.t3
    ctx.setLineDash([4 * dpr, 4 * dpr])
    ctx.beginPath()
    poly.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
    ctx.closePath()
    ctx.stroke()
    ctx.setLineDash([])
    if (!this.dragM) {
      const rh = this.rotHandle(poly.map(([x, y]) => [x / dpr, y / dpr] as [number, number]))
      ctx.beginPath()
      ctx.moveTo(rh.base[0] * dpr, rh.base[1] * dpr)
      ctx.lineTo(rh.at[0] * dpr, rh.at[1] * dpr)
      ctx.stroke()
      const dot = (x: number, y: number) => {
        ctx.beginPath()
        ctx.arc(x, y, 5 * dpr, 0, Math.PI * 2)
        ctx.fillStyle = this.colors.t1
        ctx.fill()
        ctx.lineWidth = dpr
        ctx.strokeStyle = this.colors.paper
        ctx.stroke()
      }
      poly.forEach(([x, y]) => dot(x, y))
      dot(rh.at[0] * dpr, rh.at[1] * dpr)
    }
    ctx.restore()
  }

  /** 끄는 동안: 고른 획은 정적 층에서 빼고 실시간 층 A에 변환해 그린다 */
  dragSelection(m: Mat | null): void {
    const s = this.sel
    if (!s) return
    const pm = this.doc.byId.get(s.pageId)
    const box = this.selPageBox()
    if (!pm || !box) return
    const models = [...s.strokes].map((id) => pm.strokes.get(id)).filter((x): x is StrokeModel => !!x)
    if (m && !this.dragM) {
      let b: BBox | null = null
      for (const x of models) {
        x.hidden = true
        b = b ? [Math.min(b[0], x.bbox[0]), Math.min(b[1], x.bbox[1]), Math.max(b[2], x.bbox[2]), Math.max(b[3], x.bbox[3])] : [...x.bbox]
      }
      if (b) this.r.redraw(pm, b)
    }
    if (!m) {
      // 취소: 원래대로
      let b: BBox | null = null
      for (const x of models) {
        x.hidden = false
        b = b ? [Math.min(b[0], x.bbox[0]), Math.min(b[1], x.bbox[1]), Math.max(b[2], x.bbox[2]), Math.max(b[3], x.bbox[3])] : [...x.bbox]
      }
      if (b && this.dragM) this.r.redraw(pm, b)
      this.dragM = null
      this.live.clearA()
      this.r.items.setDrag(pm.id, s.items, null)
      this.drawOverlay()
      this.selectionChanged()
      return
    }
    this.dragM = m
    const L = this.live
    const v = this.view
    const k = v.s * v.dpr
    const ctx = L.actx
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, L.a.width, L.a.height)
    L.setMode('ink')
    ctx.save()
    L.pageTransform(ctx, v, box)
    ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5])
    const look = { dark: this.r.views.get(pm.id)?.spec.dark ?? this.night }
    const ks = k * matScale(m)
    for (const x of models.sort(zCompare)) drawStroke(ctx, x, look, ks)
    ctx.restore()
    L.aDirty = true
    this.r.items.setDrag(pm.id, s.items, m)
    this.drawOverlay()
    this.selectionChanged()
  }

  commitSelectionTransform(m: Mat): void {
    const s = this.sel
    if (!s) return
    const pm = this.doc.byId.get(s.pageId)
    if (!pm) return
    const now = Date.now()
    const before: InkStroke[] = [], after: InkStroke[] = []
    for (const id of s.strokes) {
      const x = pm.strokes.get(id)
      if (!x) continue
      before.push({ ...x.row, updatedAt: now })
      after.push(transformStrokeRow(x.row, m, now))
    }
    const ib: InkItem[] = [], ia: InkItem[] = []
    for (const id of s.items) {
      const it = pm.items.get(id)
      if (!it) continue
      ib.push({ ...it, updatedAt: now })
      ia.push(transformItemRow(it, m, now))
    }
    this.r.items.setDrag(pm.id, s.items, null)
    this.dragM = null
    this.live.clearA()
    // 옮긴 상자 가운데가 다른 쪽에 들면 그 쪽으로 (지우고 새 id로 넣기 = 되돌리기 1단계)
    const box = this.selPageBox()
    if (box && this.mode === 'note') {
      const [cx, cy] = mApply(mul(m, s.m), (s.box[0] + s.box[2]) / 2, (s.box[1] + s.box[3]) / 2)
      const ti = this.view.pageAt(box.x + cx, box.y + cy, 0)
      const tb = this.view.boxes[ti]
      const target = tb ? this.doc.byId.get(tb.id) : undefined
      if (tb && target && target !== pm) {
        const M = mul(translate(box.x - tb.x, box.y - tb.y), m)
        let z = Math.max(0, ...[...target.items.values()].map((i) => i.z))
        const ns = before.map((r) => ({ ...transformStrokeRow(r, M, now), id: uid('st'), pageId: target.id }))
        const ni = ib.map((it) => ({ ...transformItemRow(it, M, now), id: uid('it'), pageId: target.id, z: ++z + (it.kind === 'tape' ? 1000 : 0) }))
        this.sel = null
        this.pushCommand({
          label: 'move-page',
          before: { strokes: [...before, ...ns.map((r) => deleted(r, now))], items: [...ib, ...ni.map((r) => deleted(r, now))] },
          after: { strokes: [...before.map((r) => deleted(r, now)), ...ns], items: [...ib.map((r) => deleted(r, now)), ...ni] },
          pageId: target.id,
        })
        if (target.state === 'ready') this.select(target, ns.map((r) => r.id), ni.map((r) => r.id))
        else this.selectionChanged()
        return
      }
    }
    this.pushCommand({ label: 'transform', before: { strokes: before, items: ib }, after: { strokes: after, items: ia }, pageId: pm.id })
    s.m = mul(m, s.m)
    this.drawOverlay()
    this.selectionChanged()
  }

  /** 고른 것의 행들 */
  private selRows(): { pm: PageModel; strokes: InkStroke[]; items: InkItem[] } | null {
    const s = this.sel
    if (!s) return null
    const pm = this.doc.byId.get(s.pageId)
    if (!pm) return null
    return {
      pm,
      strokes: [...s.strokes].map((id) => pm.strokes.get(id)?.row).filter((r): r is InkStroke => !!r),
      items: [...s.items].map((id) => pm.items.get(id)).filter((r): r is InkItem => !!r),
    }
  }

  setSelectionColor(hex: string): void {
    const r = this.selRows()
    if (!r) return
    const now = Date.now()
    const strokes = r.strokes.filter((x) => x.color !== hex)
    const items = r.items.filter((x) => x.kind !== 'image' && x.color !== hex)
    if (!strokes.length && !items.length) return
    this.pushCommand({
      label: 'color',
      before: { strokes: strokes.map((x) => ({ ...x, updatedAt: now })), items: items.map((x) => ({ ...x, updatedAt: now })) },
      after: { strokes: strokes.map((x) => ({ ...x, color: hex, updatedAt: now })), items: items.map((x) => ({ ...x, color: hex, updatedAt: now })) },
      pageId: r.pm.id,
    })
    this.selectionChanged()
  }

  /** 고른 획 굵기 배율 */
  setSelectionWidth(f: number): void {
    const r = this.selRows()
    if (!r || !r.strokes.length) return
    const now = Date.now()
    this.pushCommand({
      label: 'width',
      before: { strokes: r.strokes.map((x) => ({ ...x, updatedAt: now })) },
      after: { strokes: r.strokes.map((x) => ({ ...x, width: x.width * f, bbox: strokeBBox(new Float32Array(x.points), x.width * f), updatedAt: now })) },
      pageId: r.pm.id,
    })
  }

  deleteSelection(): void {
    const r = this.selRows()
    if (!r) return
    const now = Date.now()
    this.clearSelection()
    this.pushCommand({
      label: 'delete',
      before: { strokes: r.strokes.map((x) => ({ ...x, updatedAt: now })), items: r.items.map((x) => ({ ...x, updatedAt: now })) },
      after: { strokes: r.strokes.map((x) => deleted(x, now)), items: r.items.map((x) => deleted(x, now)) },
      pageId: r.pm.id,
    })
  }

  deleteItems(pm: PageModel, ids: string[]): void {
    const now = Date.now()
    const items = ids.map((id) => pm.items.get(id)).filter((x): x is InkItem => !!x)
    if (!items.length) return
    this.pushCommand({ label: 'delete', before: { items: items.map((x) => ({ ...x, updatedAt: now })) }, after: { items: items.map((x) => deleted(x, now)) }, pageId: pm.id })
  }

  copySelection(): boolean {
    const r = this.selRows()
    if (!r || !this.sel) return false
    clipboard = { strokes: r.strokes, items: r.items, box: bboxTransform(this.sel.box, this.sel.m), pageId: r.pm.id }
    // 시스템 클립보드에 PNG도 (되는 곳에서만)
    void this.selectionPng().then(async (blob) => {
      try {
        const CI = (window as unknown as { ClipboardItem?: new (d: Record<string, Blob>) => unknown }).ClipboardItem
        if (blob && CI && navigator.clipboard?.write) await navigator.clipboard.write([new CI({ 'image/png': blob }) as ClipboardItem])
      } catch {
        /* 권한 없음 */
      }
    })
    return true
  }

  cutSelection(): void {
    if (this.copySelection()) this.deleteSelection()
  }

  get hasClipboard(): boolean {
    return !!clipboard
  }

  /** 붙이기: at = 쪽 좌표(누른 점), 없으면 같은 쪽 +16pt 또는 보이는 곳 가운데 */
  async paste(at?: { pageId: string; x: number; y: number }): Promise<boolean> {
    const pm = at ? this.doc.byId.get(at.pageId) : this.currentPage()
    if (!pm) return false
    if (!clipboard) return this.pasteSystem(pm, at)
    const cb = clipboard
    let dx: number, dy: number
    if (at) {
      dx = at.x - (cb.box[0] + cb.box[2]) / 2
      dy = at.y - (cb.box[1] + cb.box[3]) / 2
    } else if (cb.pageId === pm.id) {
      dx = 16
      dy = 16
    } else {
      const c = this.visibleCenter(pm)
      dx = c[0] - (cb.box[0] + cb.box[2]) / 2
      dy = c[1] - (cb.box[1] + cb.box[3]) / 2
    }
    cb.box = [cb.box[0] + (cb.pageId === pm.id && !at ? 16 : 0), cb.box[1] + (cb.pageId === pm.id && !at ? 16 : 0), cb.box[2], cb.box[3]]
    this.placeClones(pm, cb.strokes, cb.items, translate(dx, dy))
    return true
  }

  duplicateSelection(): void {
    const r = this.selRows()
    if (!r) return
    this.placeClones(r.pm, r.strokes, r.items, translate(16, 16))
  }

  private placeClones(pm: PageModel, strokes: InkStroke[], items: InkItem[], m: Mat): void {
    const now = Date.now()
    const maxZ = Math.max(0, ...[...pm.items.values()].map((i) => i.z))
    const ns = strokes
      .slice()
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((r, i) => ({ ...transformStrokeRow(r, m, now), id: uid('st'), pageId: pm.id, createdAt: now + i, updatedAt: now, deletedAt: null }))
    const ni = items.map((it, i) => ({ ...transformItemRow(it, m, now), id: uid('it'), pageId: pm.id, z: maxZ + 1 + i, createdAt: now, updatedAt: now, deletedAt: null }))
    this.pushCommand({ label: 'paste', before: { strokes: ns.map((r) => deleted(r, now)), items: ni.map((r) => deleted(r, now)) }, after: { strokes: ns, items: ni }, pageId: pm.id })
    this.select(pm, ns.map((r) => r.id), ni.map((r) => r.id))
  }

  private async pasteSystem(pm: PageModel, at?: { x: number; y: number }): Promise<boolean> {
    try {
      const cb = navigator.clipboard as Clipboard & { read?: () => Promise<ClipboardItems> }
      if (cb?.read) {
        for (const item of await cb.read()) {
          const img = item.types.find((t) => t.startsWith('image/'))
          if (img) {
            await this.insertImage(await item.getType(img), at ? { pageId: pm.id, x: at.x, y: at.y } : undefined)
            return true
          }
          if (item.types.includes('text/plain')) {
            const text = await (await item.getType('text/plain')).text()
            if (text.trim()) {
              await this.insertText(at ? { pageId: pm.id, x: at.x, y: at.y } : undefined, text)
              return true
            }
          }
        }
      } else if (cb?.readText) {
        const text = await cb.readText()
        if (text.trim()) {
          await this.insertText(at ? { pageId: pm.id, x: at.x, y: at.y } : undefined, text)
          return true
        }
      }
    } catch {
      /* 권한 없음 · 비었음 */
    }
    return false
  }

  /** 고른 상자 위에 테이프 (여백 4pt, 지금 테이프 색) */
  coverSelection(): void {
    const s = this.sel
    if (!s) return
    const pm = this.doc.byId.get(s.pageId)
    if (!pm) return
    const [x0, y0, x1, y1] = s.box
    const k = matScale(s.m)
    const c = mApply(s.m, (x0 + x1) / 2, (y0 + y1) / 2)
    const w = (x1 - x0) * k + 8, h = (y1 - y0) * k + 8
    this.clearSelection()
    this.addTape(pm, { x: c[0] - w / 2, y: c[1] - h / 2, w, h, rot: matAngle(s.m) }, this.tape.color)
  }

  /** 고른 것을 그림으로 (PNG) */
  async selectionPng(scale = 2): Promise<Blob | null> {
    const s = this.sel
    const r = this.selRows()
    if (!s || !r) return null
    const b = bboxTransform(s.box, s.m)
    const pad = 4
    const w = b[2] - b[0] + pad * 2, h = b[3] - b[1] + pad * 2
    const c = document.createElement('canvas')
    c.width = Math.ceil(w * scale)
    c.height = Math.ceil(h * scale)
    const ctx = c.getContext('2d')!
    ctx.setTransform(scale, 0, 0, scale, (pad - b[0]) * scale, (pad - b[1]) * scale)
    const look = { dark: false }
    for (const row of r.strokes.slice().sort((a, b2) => a.createdAt - b2.createdAt)) drawStroke(ctx, new StrokeModel(row), look, scale)
    return new Promise((res) => c.toBlob((bl) => res(bl), 'image/png'))
  }

  /** 물건 맨 앞으로 · 맨 뒤로 */
  arrangeSelection(where: 'front' | 'back'): void {
    const r = this.selRows()
    if (!r || !r.items.length) return
    const zs = [...r.pm.items.values()].map((i) => i.z)
    const now = Date.now()
    const base = where === 'front' ? Math.max(...zs) + 1 : Math.min(...zs) - r.items.length
    this.pushCommand({
      label: 'arrange',
      before: { items: r.items.map((x) => ({ ...x, updatedAt: now })) },
      after: { items: r.items.map((x, i) => ({ ...x, z: base + i, updatedAt: now })) },
      pageId: r.pm.id,
    })
  }

  /** 고른 테이프의 헷갈림 표시 */
  toggleFlag(): void {
    const r = this.selRows()
    if (!r) return
    const tapes = r.items.filter((x) => x.kind === 'tape')
    if (!tapes.length) return
    const on = !tapes.every((t) => t.flag)
    const now = Date.now()
    this.pushCommand({ label: 'flag', before: { items: tapes.map((x) => ({ ...x, updatedAt: now })) }, after: { items: tapes.map((x) => ({ ...x, flag: on, updatedAt: now })) }, pageId: r.pm.id })
    this.selectionChanged()
  }

  /* ---------- 물건 ---------- */

  private nextZ(pm: PageModel): number {
    return Math.max(0, ...[...pm.items.values()].map((i) => i.z)) + 1
  }

  private visibleCenter(pm: PageModel): [number, number] {
    const v = this.view
    const b = this.boxOf(pm)
    if (!b) return [pm.page.w / 2, pm.page.h / 2]
    const [wx, wy] = v.toWorld(v.W / 2, v.H / 2)
    return [Math.max(24, Math.min(b.w - 24, wx - b.x)), Math.max(24, Math.min(b.h - 24, wy - b.y))]
  }

  /** 사진 넣기: 누른 자리(없으면 보이는 곳 가운데)에 쪽 너비 60%까지, 넣으면 고른 상태 */
  async insertImage(blob: Blob, at?: { pageId: string; x: number; y: number }): Promise<InkItem | null> {
    const pm = at ? this.doc.byId.get(at.pageId) : this.currentPage()
    if (!pm) return null
    await this.doc.load(pm)
    let iw = 400, ih = 300
    try {
      const bm = await createImageBitmap(blob)
      iw = bm.width
      ih = bm.height
      bm.close()
    } catch {
      /* 크기 모름 */
    }
    const assetId = await saveAsset(this.db, blob, this.noteId)
    const maxW = pm.page.w * 0.6
    const f = Math.min(1, maxW / iw, (pm.page.h * 0.6) / ih)
    const w = iw * f, h = ih * f
    const c = at ? [at.x, at.y] : this.visibleCenter(pm)
    const now = Date.now()
    const it: InkItem = { id: uid('it'), pageId: pm.id, kind: 'image', x: Math.max(0, Math.min(pm.page.w - w, c[0]! - w / 2)), y: Math.max(0, Math.min(pm.page.h - h, c[1]! - h / 2)), w, h, rot: 0, assetId, z: this.nextZ(pm), createdAt: now, updatedAt: now, deletedAt: null }
    this.pushCommand({ label: 'image', before: { items: [deleted(it, now)] }, after: { items: [it] }, pageId: pm.id })
    this.select(pm, [], [it.id])
    return it
  }

  /** 글 상자: 누른 자리에 만들고 키보드를 연다 (text가 있으면 바로 넣기) */
  async insertText(at?: { pageId: string; x: number; y: number }, text?: string): Promise<void> {
    const pm = at ? this.doc.byId.get(at.pageId) : this.currentPage()
    if (!pm) return
    await this.doc.load(pm)
    const c = at ? [at.x, at.y] : this.visibleCenter(pm)
    const fs = 12
    const w = Math.max(60, Math.min(280, pm.page.w - c[0]! - 12))
    const now = Date.now()
    const it: InkItem = { id: uid('it'), pageId: pm.id, kind: 'text', x: c[0]!, y: c[1]! - fs * 0.75, w, h: fs * 1.5, rot: 0, text: text ?? '', color: this.textColor, fontSize: fs, z: this.nextZ(pm), createdAt: now, updatedAt: now, deletedAt: null }
    if (text) {
      this.pushCommand({ label: 'text', before: { items: [deleted(it, now)] }, after: { items: [it] }, pageId: pm.id })
      return
    }
    // 아직 기록하지 않는다 (비운 채 나가면 지운다)
    this.doc.apply({ items: [it] })
    this.editText(pm, it, true)
  }

  editText(pm: PageModel, it: InkItem, isNew: boolean): void {
    this.clearSelection()
    this.r.items.startEdit(pm.id, it, isNew)
  }

  /** 글 상자 편집 끝 (blur) */
  endTextEdit(): void {
    const e = this.r.items.finishEdit()
    if (!e) return
    const pm = this.doc.byId.get(e.pageId)
    if (!pm) return
    const now = Date.now()
    const cur = pm.items.get(e.id) ?? e.before
    if (!e.text.trim()) {
      if (e.isNew) this.doc.apply({ items: [deleted(cur, now)] })
      else this.pushCommand({ label: 'text', before: { items: [{ ...e.before, updatedAt: now }] }, after: { items: [deleted(cur, now)] }, pageId: pm.id })
      return
    }
    const next: InkItem = { ...cur, text: e.text, w: e.w, h: Math.max(e.h, (cur.fontSize ?? 12) * 1.5), updatedAt: now }
    if (e.isNew) this.pushCommand({ label: 'text', before: { items: [deleted(next, now)] }, after: { items: [next] }, pageId: pm.id })
    else if (e.text !== (e.before.text ?? '') || Math.abs(e.w - e.before.w) > 0.5) this.pushCommand({ label: 'text', before: { items: [{ ...e.before, updatedAt: now }] }, after: { items: [next] }, pageId: pm.id })
    else this.doc.apply({ items: [cur] })
  }

  /* ---------- 테이프 ---------- */

  addTape(pm: PageModel, r: { x: number; y: number; w: number; h: number; rot: number }, color: string): void {
    const now = Date.now()
    const it: InkItem = { id: uid('it'), pageId: pm.id, kind: 'tape', x: r.x, y: r.y, w: r.w, h: r.h, rot: r.rot, hidden: true, flag: false, color, z: this.nextZ(pm) + 1000, createdAt: now, updatedAt: now, deletedAt: null }
    this.pushCommand({ label: 'tape', before: { items: [deleted(it, now)] }, after: { items: [it] }, pageId: pm.id })
    this.emitPagesSoon()
  }

  /** 누르기: 걷기 · 다시 붙이기 (되돌리기 기록에 넣지 않는다 — 공부 동작) */
  toggleTape(pm: PageModel, it: InkItem, at: [number, number] | null): void {
    const next: InkItem = { ...it, hidden: !it.hidden, updatedAt: Date.now() }
    // 누른 점에서 가까운 끝부터
    let fromStart = true
    if (at) {
      const [lx] = mApply(inv(itemMatrix(it)), at[0], at[1])
      fromStart = lx < it.w / 2
    }
    this.doc.apply({ items: [next] })
    this.doc.persist({ items: [next] })
    this.r.items.animateTape(pm.id, next, !!next.hidden, fromStart, at)
    this.emitPagesSoon()
    this.emit('change', { pageIds: [pm.id] })
  }

  /** 모두 걷기 · 다시 붙이기 (읽는 순서, 30ms 간격). scope 'page' = 지금 쪽, 'note' = 노트 전체. only = 헷갈림 표시만 붙이기 */
  async setTapes(hidden: boolean, scope: 'page' | 'note', opts: { pageId?: string; onlyFlagged?: boolean } = {}): Promise<void> {
    const pms = scope === 'page' ? [opts.pageId ? this.doc.byId.get(opts.pageId) : this.currentPage()].filter((x): x is PageModel => !!x) : this.doc.pages
    let delay = 0
    const now = Date.now()
    const rows: InkItem[] = []
    for (const pm of pms) {
      await this.doc.load(pm)
      const tapes = [...pm.items.values()].filter((i) => i.kind === 'tape').sort((a, b) => a.y - b.y || a.x - b.x)
      const visible = this.r.views.has(pm.id)
      const changed: InkItem[] = []
      for (const t of tapes) {
        const want = opts.onlyFlagged ? !!t.flag && hidden : hidden
        if (!!t.hidden === want) continue
        const next = { ...t, hidden: want, updatedAt: now }
        changed.push(next)
      }
      if (!changed.length) continue
      this.doc.apply({ items: changed })
      rows.push(...changed)
      if (visible) {
        changed.forEach((t, i) => {
          this.r.items.animateTape(pm.id, t, !!t.hidden, true, !t.hidden && i === changed.length - 1 ? [t.x + t.w / 2, t.y + t.h / 2] : null, delay, t.hidden ? 160 : 200)
          delay += 30
        })
      }
    }
    if (rows.length) this.doc.persist({ items: rows })
    this.emitPagesSoon()
  }

  /** 이 쪽 테이프: 하나라도 붙어 있으면 모두 걷고, 다 걷혔으면 모두 붙인다 (테이프 칩) */
  toggleAllTapes(pageId?: string): void {
    const pm = pageId ? this.doc.byId.get(pageId) : this.currentPage()
    if (!pm) return
    const c = pm.tapeCounts()
    if (!c.total) return
    void this.setTapes(c.revealed < c.total, 'page', { pageId: pm.id }).then(() => {
      // 한 번 더 누르면 반대로 (setTapes(true)는 붙이기)
    })
  }

  /* ---------- 쪽 ---------- */

  currentPage(): PageModel | null {
    const b = this.view.boxes[this.view.centerPage()]
    return b ? (this.doc.byId.get(b.id) ?? null) : null
  }

  pageInfos(): PageInfo[] {
    return this.doc.pages.map((pm, n) => ({
      id: pm.id,
      index: pm.page.index,
      n,
      template: pm.page.template,
      w: pm.page.w,
      h: pm.page.h,
      pdf: !!pm.page.pdf,
      tapes: pm.tapeCounts(),
      strokes: pm.state === 'ready' ? pm.strokes.size : -1,
    }))
  }

  private emitPages(): void {
    clearTimeout(this.pagesTimer)
    this.pagesTimer = 0
    this.emit('pages', this.pageInfos())
  }

  private emitPagesSoon(): void {
    if (this.pagesTimer) return
    this.pagesTimer = window.setTimeout(() => this.emitPages(), 60)
  }

  private indexBetween(i: number): number {
    const ps = this.doc.pages
    const a = ps[i - 1]?.page.index, b = ps[i]?.page.index
    if (a === undefined && b === undefined) return 0
    if (a === undefined) return b! - 1
    if (b === undefined) return a + 1
    return (a + b) / 2
  }

  /** 쪽 추가: after = 쪽 id(그 뒤) · 'end' · 'start'. 같은 틀·크기, 그 쪽 맨 위로 420ms */
  addPage(after: string | 'end' | 'start' = this.currentPage()?.id ?? 'end', o: { template?: PageTemplate } = {}): Page {
    const ps = this.doc.pages
    const pos = after === 'end' ? ps.length : after === 'start' ? 0 : Math.max(0, ps.findIndex((p) => p.id === after)) + 1
    const ref = ps[Math.max(0, Math.min(ps.length - 1, pos - 1))]?.page
    const row = newPageRow(this.noteId, this.indexBetween(pos), { template: o.template ?? (ref?.pdf ? 'blank' : ref?.template) ?? 'ruled', w: ref?.w, h: ref?.h })
    const now = Date.now()
    this.pushCommand({ label: 'page', before: { pages: [deleted(row, now)] }, after: { pages: [row] }, pageId: row.id })
    const i = this.view.boxes.findIndex((b) => b.id === row.id)
    if (i >= 0) {
      this.view.scrollToPage(i, 420)
      this.requestFrame()
    }
    void touchNote(this.db, this.noteId, { pages: this.doc.pages.length })
    return row
  }

  async duplicatePage(id: string): Promise<void> {
    const pm = this.doc.byId.get(id)
    if (!pm) return
    await this.doc.load(pm)
    const pos = this.doc.pages.indexOf(pm) + 1
    const now = Date.now()
    const row: Page = { ...pm.page, id: uid('pg'), index: this.indexBetween(pos), createdAt: now, updatedAt: now, deletedAt: null }
    const strokes = pm.sorted().map((m, i) => ({ ...m.row, id: uid('st'), pageId: row.id, createdAt: m.row.createdAt + i * 0, updatedAt: now, deletedAt: null }))
    const items = pm.itemsSorted().map((it) => ({ ...it, id: uid('it'), pageId: row.id, createdAt: now, updatedAt: now, deletedAt: null }))
    this.pushCommand({
      label: 'page-dup',
      before: { pages: [deleted(row, now)], strokes: strokes.map((r) => deleted(r, now)), items: items.map((r) => deleted(r, now)) },
      after: { pages: [row], strokes, items },
      pageId: row.id,
    })
  }

  /** 쪽 지우기 (soft, 되돌리기 1단계). 마지막 한 쪽은 지우지 않는다 */
  deletePage(id: string): boolean {
    if (this.doc.pages.length <= 1) return false
    const pm = this.doc.byId.get(id)
    if (!pm) return false
    const now = Date.now()
    if (this.sel?.pageId === id) this.clearSelection()
    this.pushCommand({ label: 'page-del', before: { pages: [{ ...pm.page, updatedAt: now }] }, after: { pages: [deleted(pm.page, now)] }, pageId: id })
    void touchNote(this.db, this.noteId, { pages: this.doc.pages.length })
    return true
  }

  /** 쪽 순서: to = 새 자리(0부터, 옮긴 뒤 기준) */
  movePage(id: string, to: number): void {
    const ps = this.doc.pages
    const from = ps.findIndex((p) => p.id === id)
    if (from < 0) return
    const rest = ps.filter((p) => p.id !== id)
    const t = Math.max(0, Math.min(rest.length, to))
    if (t === from) return
    const a = rest[t - 1]?.page.index, b = rest[t]?.page.index
    const index = a === undefined ? (b ?? 0) - 1 : b === undefined ? a + 1 : (a + b) / 2
    const now = Date.now()
    const pm = ps[from]!
    this.pushCommand({ label: 'page-move', before: { pages: [{ ...pm.page, updatedAt: now }] }, after: { pages: [{ ...pm.page, index, updatedAt: now }] }, pageId: id })
  }

  /** 쪽 틀 (id = 'all'이면 모든 쪽) */
  setTemplate(id: string | 'all', template: PageTemplate): void {
    const targets = id === 'all' ? this.doc.pages : [this.doc.byId.get(id)].filter((x): x is PageModel => !!x)
    const ts = targets.filter((pm) => pm.page.template !== template && !pm.page.pdf)
    if (!ts.length) return
    const now = Date.now()
    this.pushCommand({ label: 'template', before: { pages: ts.map((pm) => ({ ...pm.page, updatedAt: now })) }, after: { pages: ts.map((pm) => ({ ...pm.page, template, updatedAt: now })) }, pageId: ts[0]!.id })
    void setInkMeta(this.db, 'ink.lastTemplate', template)
    for (const pm of ts) this.r.pageChanged(pm)
  }

  scrollToPage(id: string, dur = 420): void {
    const i = this.view.boxes.findIndex((b) => b.id === id)
    if (i < 0) return
    this.view.scrollToPage(i, dur)
    this.requestFrame()
  }

  nextPage(d: 1 | -1): void {
    const i = Math.max(0, Math.min(this.view.boxes.length - 1, this.view.centerPage() + d))
    const b = this.view.boxes[i]
    if (b) this.scrollToPage(b.id, 320)
  }

  /* ---------- 확대 ---------- */

  zoomFit(): void {
    const v = this.view
    const [wx, wy] = v.toWorld(v.W / 2, v.H / 2)
    const s = v.fit
    v.animateTo(s, wx - v.W / (2 * s), wy - v.H / (2 * s), 220)
    this.requestFrame()
  }

  zoomBy(f: number): void {
    const v = this.view
    const [wx, wy] = v.toWorld(v.W / 2, v.H / 2)
    const s = Math.max(v.fit, Math.min(v.maxS, v.s * f))
    v.animateTo(s, wx - v.W / (2 * s), wy - v.H / (2 * s), 200)
    this.requestFrame()
  }

  /* ---------- 도구 ---------- */

  /** 지우개를 고르기 전 도구 ('다 지우면 이전 도구로') */
  private prevTool: ToolName = 'pen'

  /** 지우개 획이 끝남: 옵션이 켜져 있으면 이전 도구로 */
  eraserDone(): void {
    if (this.prefs.eraserReturn && this.tool === 'eraser') this.setTool(this.prevTool)
  }

  setTool(t: ToolName): void {
    if (this.tool === t) return
    if (t === 'eraser') this.prevTool = this.tool
    if (this.sel && t !== 'lasso') this.clearSelection()
    if (this.r.items.editing && t !== 'text') this.endTextEdit()
    this.tool = t
    this.hoverPt = null
    this.drawOverlay()
    this.host.dataset.tool = t
    this.emit('tool', t)
  }

  setPen(p: Partial<PenStyle>): void {
    this.pen = { ...this.pen, ...p }
    if (p.color) this.textColor = this.textColor === PEN_SLOTS[0] ? this.textColor : this.textColor
  }
  setHighlighter(p: Partial<HighlighterStyle>): void {
    this.hl = { ...this.hl, ...p }
  }
  setEraser(p: Partial<EraserStyle>): void {
    this.eraser = { ...this.eraser, ...p }
  }
  setTape(p: Partial<TapeStyle>): void {
    this.tape = { ...this.tape, ...p }
  }

  /** 다음 한 획을 멈추지 않아도 도형으로 */
  shapeOnce(on = true): void {
    this.shapeArmed = on
    this.host.classList.toggle('is-shape-once', on)
  }

  shapeOnceUsed(): void {
    this.shapeOnce(false)
  }

  /* ---------- 종이 · 테마 ---------- */

  /** 밤 종이(밤 테마) 켬·끔 */
  setNight(night: boolean): void {
    if (this.night === night) return
    // 600ms 교차 페이드: 지금 화면을 한 장으로 찍어 위에 두고, 새 종이를 다 그린 뒤 걷어 낸다
    const snap = matchMedia('(prefers-reduced-motion: reduce)').matches ? null : this.snapshot()
    if (snap) {
      this.r.stage.insertBefore(snap, this.r.L.tape)
      const t0 = performance.now()
      const wait = () => {
        if (this.destroyed) return snap.remove()
        if (this.r.pendingJobs > 0 && performance.now() - t0 < 400) return void requestAnimationFrame(wait)
        snap.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 600, easing: 'cubic-bezier(.65,0,.35,1)', fill: 'forwards' }).onfinish = () => {
          snap.remove()
          snap.width = snap.height = 0
        }
      }
      requestAnimationFrame(wait)
    }
    this.night = night
    this.readColors()
    this.r.invalidateAll()
    for (const pv of this.r.views.values()) this.r.items.sync(pv)
    this.requestFrame()
    this.thumbs.clear()
  }

  /** 지금 보이는 종이 · 틀 · PDF · 형광 · 잉크를 화면 크기 한 장으로 (테마 교차 페이드용) */
  private snapshot(): HTMLCanvasElement {
    const v = this.view
    const c = document.createElement('canvas')
    c.width = Math.round(v.W * v.dpr)
    c.height = Math.round(v.H * v.dpr)
    c.className = 'ink-snap'
    c.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;z-index:9;pointer-events:none'
    const ctx = c.getContext('2d')!
    const dpr = v.dpr
    const [i0, i1] = v.range(0)
    for (let i = i0; i >= 0 && i <= i1; i++) {
      const b = v.boxes[i]!
      const pv = this.r.views.get(b.id)
      if (!pv) continue
      const [x, y] = v.toScreen(b.x, b.y)
      ctx.fillStyle = this.mode === 'pad' ? 'transparent' : pv.spec.bg.startsWith('var') ? '#FBFAF7' : pv.spec.bg
      ctx.fillRect(x * dpr, y * dpr, b.w * v.s * dpr, b.h * v.s * dpr)
    }
    ctx.drawImage(this.r.tpl, 0, 0)
    for (const l of ['pdf', 'hl', 'ink'] as const)
      for (const pv of this.r.views.values())
        for (const lv of ['base', 'detail'] as const) {
          const sl = pv.slots[l][lv]
          if (!sl) continue
          const [x, y] = v.toScreen(pv.box.x + sl.region[0], pv.box.y + sl.region[1])
          ctx.save()
          if (l === 'hl') {
            ctx.globalAlpha = pv.spec.hlOpacity
            ctx.globalCompositeOperation = pv.spec.hlBlend
          }
          ctx.drawImage(sl.el, x * dpr, y * dpr, (sl.region[2] - sl.region[0]) * v.s * dpr, (sl.region[3] - sl.region[1]) * v.s * dpr)
          ctx.restore()
        }
    return c
  }

  /* ---------- PDF · 내보내기 · 썸네일 ---------- */

  /** PDF 가져오기: 지금 쪽 뒤에 끼운다 (빈 첫 쪽 하나뿐이면 그 자리를 쓴다) */
  async importPdf(file: Blob, o: { after?: string | 'end' } = {}): Promise<Page[]> {
    const { readPdfSizes } = await import('./pdf')
    const sizes = await readPdfSizes(file, (i, n) => this.emit('progress', { kind: 'pdf', done: i, total: n }))
    const assetId = await saveAsset(this.db, new Blob([file], { type: 'application/pdf' }), this.noteId)
    const ps = this.doc.pages
    const only = ps.length === 1 ? ps[0]! : null
    if (only) await this.doc.load(only)
    const replaceEmpty = !!only && !only.page.pdf && only.strokes.size === 0 && only.items.size === 0
    const after = o.after ?? this.currentPage()?.id ?? 'end'
    const pos = after === 'end' ? ps.length : Math.max(0, ps.findIndex((p) => p.id === after)) + 1
    const a = ps[pos - 1]?.page.index ?? -1
    const b = ps[pos]?.page.index
    const now = Date.now()
    const rows = sizes.map(([w, h], i) => {
      const index = b === undefined ? a + 1 + i : a + ((b - a) * (i + 1)) / (sizes.length + 1)
      return newPageRow(this.noteId, index, { template: 'blank', w, h, pdf: { assetId, pageNo: i + 1 } })
    })
    const before: Page[] = rows.map((r) => deleted(r, now))
    const afterRows: Page[] = [...rows]
    if (replaceEmpty && only) {
      before.push({ ...only.page, updatedAt: now })
      afterRows.push(deleted(only.page, now))
    }
    this.pushCommand({ label: 'pdf', before: { pages: before }, after: { pages: afterRows }, pageId: rows[0]?.id })
    void touchNote(this.db, this.noteId, { pages: this.doc.pages.length })
    if (rows[0]) this.scrollToPage(rows[0].id, 420)
    return rows
  }

  async exportPdf(o: { tapes?: 'none' | 'hidden' } = {}): Promise<Blob> {
    const { exportPdf } = await import('./export')
    return exportPdf(this, { ...o, onProgress: (done, total) => this.emit('progress', { kind: 'export', done, total }) })
  }

  async exportPng(pageId?: string, o: { scale?: number; tapes?: 'none' | 'hidden' } = {}): Promise<Blob | null> {
    const pm = pageId ? this.doc.byId.get(pageId) : this.currentPage()
    if (!pm) return null
    const { exportPagePng } = await import('./export')
    return exportPagePng(this, pm, o)
  }

  /** 쪽 썸네일 (기본 너비 240px, 쪽이 바뀌면 다시) */
  async thumbnail(pageId: string, width = 240): Promise<HTMLCanvasElement | null> {
    const pm = this.doc.byId.get(pageId)
    if (!pm) return null
    await this.doc.load(pm)
    const key = `${pm.version}|${this.night}|${width}|${pm.page.template}`
    const hit = this.thumbs.get(pageId)
    if (hit && hit.v === key) return hit.c
    const { renderPageCanvas } = await import('./export')
    const c = await renderPageCanvas(this, pm, width / pm.page.w, { paper: 'theme', tapes: 'all' })
    const old = this.thumbs.get(pageId)
    if (old && old.c !== c) old.c.width = old.c.height = 0
    this.thumbs.set(pageId, { v: key, c })
    return c
  }

  private pageTouched(pm: PageModel): void {
    // 썸네일: 쉴 때 1초 디바운스
    clearTimeout(this.thumbTimers.get(pm.id))
    this.thumbTimers.set(pm.id, window.setTimeout(() => this.emit('thumb', { pageId: pm.id }), 1000))
    this.emitPagesSoon()
    void touchNote(this.db, this.noteId)
  }

  /* ---------- 파일 고르기 (사진 · PDF) ---------- */

  pickFile(accept: string): Promise<File | null> {
    return new Promise((res) => {
      const inp = document.createElement('input')
      inp.type = 'file'
      inp.accept = accept
      inp.style.display = 'none'
      inp.onchange = () => {
        res(inp.files?.[0] ?? null)
        inp.remove()
      }
      inp.addEventListener('cancel', () => {
        res(null)
        inp.remove()
      })
      document.body.appendChild(inp)
      inp.click()
    })
  }

  /* ---------- 키 ---------- */

  private attachKeys(): void {
    const down = (e: KeyboardEvent) => {
      if (!this.keysOn || this.destroyed || getActiveInkEngine() !== this) return
      if (e.isComposing || e.keyCode === 229 || isEditable(e.target)) return
      if (e.key === ' ' && !e.repeat) {
        this.input.spaceHeld = true
        this.host.classList.add('is-space')
      }
      if (e.key === 'Escape') {
        if (this.sel) {
          e.preventDefault()
          this.clearSelection()
        }
        return
      }
      for (const c of INK_COMMANDS) {
        if (c.keys && matchKey(e, c.keys) && (!c.enabled || c.enabled(this))) {
          e.preventDefault()
          void c.run(this)
          return
        }
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.key === ' ') {
        this.input.spaceHeld = false
        this.host.classList.remove('is-space')
      }
    }
    const paste = (e: ClipboardEvent) => {
      if (getActiveInkEngine() !== this || isEditable(e.target) || clipboard) return
      const f = [...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith('image/'))
      if (f) {
        e.preventDefault()
        void this.insertImage(f)
      }
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('paste', paste)
    this.off.push(() => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('paste', paste)
    })
  }

  /* ---------- 슬롯 준비 (render.ts) ---------- */

  onSlotReady(_pm: PageModel): void {
    /* 첫 그림 준비 등 — 필요하면 이벤트로 */
  }

  /* ---------- 시험용 ---------- */

  /** 합성 획 n개 (손글씨 비슷한 꾸불선) — 시험 페이지 전용 */
  async debugSynth(n = 2000, pageId?: string): Promise<{ ms: number; pageId: string }> {
    const t0 = performance.now()
    const pm = pageId ? this.doc.byId.get(pageId) : this.doc.byId.get(this.addPage('end', { template: 'ruled' }).id)
    if (!pm) throw new Error('쪽 없음')
    await this.doc.load(pm)
    const { w, h } = pm.page
    let seed = 7
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    const rows: InkStroke[] = []
    const now = Date.now()
    let x = 40, y = 70
    const colors = [PEN_SLOTS[0]!, PEN_SLOTS[0]!, PEN_SLOTS[0]!, PEN_SLOTS[1]!, PEN_SLOTS[2]!]
    for (let i = 0; i < n; i++) {
      const hl = i % 40 === 39
      const np = hl ? 12 : 18 + Math.floor(rnd() * 40)
      const pts = new Float32Array(np * 4)
      const sw = hl ? 40 + rnd() * 60 : 6 + rnd() * 10
      for (let j = 0; j < np; j++) {
        const f = j / (np - 1)
        pts[j * 4] = x + f * sw + (hl ? 0 : Math.sin(f * 9 + i) * 2.5)
        pts[j * 4 + 1] = y + (hl ? 2 : Math.sin(f * 12 + i * 0.7) * 6 + (rnd() - 0.5) * 1.5)
        pts[j * 4 + 2] = 0.35 + rnd() * 0.3
        pts[j * 4 + 3] = j * 8
      }
      const width = hl ? 12 : 1.6
      rows.push({ id: uid('st'), pageId: pm.id, layer: hl ? 'highlight' : 'ink', tool: hl ? 'highlighter' : 'pen', pen: hl ? null : 'ball', color: hl ? HL_SLOTS[0]! : colors[i % colors.length]!, width, points: pts.buffer, bbox: strokeBBox(pts, width), shape: null, createdAt: now + i, updatedAt: now, deletedAt: null })
      if (!hl) x += sw * 0.7 + (i % 6 === 5 ? 10 : 2)
      if (x > w - 60) {
        x = 40
        y += 20
        if (y > h - 40) y = 70 + (i % 7)
      }
    }
    this.doc.apply({ strokes: rows })
    await this.doc.persist({ strokes: rows })
    this.scrollToPage(pm.id, 0)
    return { ms: performance.now() - t0, pageId: pm.id }
  }

  /* ---------- 끝 ---------- */

  destroy(): void {
    if (this.destroyed) return
    if (this.r.items.editing) this.endTextEdit()
    void this.saveView()
    this.destroyed = true
    if (active === this) active = null
    cancelAnimationFrame(this.raf)
    clearTimeout(this.activeTimer)
    clearTimeout(this.viewSaveTimer)
    clearTimeout(this.settleTimer)
    clearTimeout(this.pagesTimer)
    for (const t of this.thumbTimers.values()) clearTimeout(t)
    if (this.activeOn) this.setActive(false)
    this.input.detach()
    this.ro?.disconnect()
    this.off.forEach((f) => f())
    this.off = []
    this.r.items.destroy()
    this.r.destroy()
    this.live.destroy()
    for (const t of this.thumbs.values()) t.c.width = t.c.height = 0
    this.thumbs.clear()
    this.history.clear()
    this.listeners.clear()
    this.host.classList.remove('ink-host', 'ink-pad')
  }
}

export function createInkEngine(o: InkEngineOptions): InkEngine {
  return new InkEngine(o)
}

export { alive, bboxInter, bboxOverlap, pathOf, tapeColor }
