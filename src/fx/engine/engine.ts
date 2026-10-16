/**
 * 결 필드 엔진 — 화면 전체에 캔버스 1개, rAF 루프 1개.
 * React는 이 객체의 메서드만 부른다(프레임마다 리렌더하지 않음). 유니폼은 여기서 직접 갱신한다.
 *
 * 레이어 규칙(프로토타입에서 실제로 난 버그):
 *   html에 배경(--bg-0), body는 transparent, 이 캔버스는 position:fixed; inset:0; z-index:0,
 *   앱 루트는 position:relative; z-index:1. body에 배경을 칠하거나 캔버스를 z-index:-1로 두면 필드가 가려진다.
 */
import type { RefObject } from 'react'
import { MOODS, PORTRAIT_KNOTS } from '../moods'
import type { FieldData, Mood, MoodName, MotionLevel, MotionPrefs, PauseReason, RippleOptions, ThemeName, Tier } from '../types'
import { GLField, type FrameUniforms } from './gl'
import { drawStill2D } from './fallback2d'
import { mixRGBA, readPalette, resolveColor, type Palette, type RGBA } from './color'
import { input, pointer } from './input'

export type Mode = 'rich' | 'calm' | 'off'

export interface MoodSpec {
  preset: MoodName
  override?: Partial<Mood>
  knotRef?: RefObject<Element | null>
  transitionMs?: number
}
export interface PinSpec {
  ref: RefObject<Element | null>
  strength?: number
  followPointer?: boolean
}
interface PauseSpec {
  reason: PauseReason
  active: boolean
  until: number
}
export interface StampItem {
  id: number
  x: number
  y: number
  text: string
  sub?: string
}
export interface FieldStats {
  fps: number
  tier: Tier
  tierAuto: boolean
  res: number
  megapixels: number
  jsMs: number
  p95: number
  renderer: string
  render: 'webgl2' | 'canvas2d'
  mode: Mode
  running: boolean
  paused: boolean
  view: [number, number]
}

/* 성능 등급 (design-v2 §5-3) */
const TIER_SCALE: Record<Tier, number> = { A: 0.66, B: 0.5, C: 0.4 }
const TIER_BUDGET: Record<Tier, number> = { A: 1000 / 120, B: 1000 / 60, C: 1000 / 30 }
const TIER_CAP: Record<Tier, number> = { A: 0, B: 1000 / 60, C: 1000 / 30 }
/* B도 2옥타브: 두 번째 옥타브가 결의 잔무늬를 만든다. 비용이 작아(측정값은 dev-notes) B까지 유지, C만 1옥타브 */
const TIER_OCT: Record<Tier, number> = { A: 2, B: 2, C: 1 }
const TIER_MAXPX: Record<Tier, number> = { A: 4.2e6, B: 2.4e6, C: 1.2e6 }
const LOWER: Record<Tier, Tier | null> = { A: 'B', B: 'C', C: null }

const SEED_TIME = 2.4 // '끔'일 때 정지 프레임의 시드
const FOLLOW = 0.92 // 옹이가 포인터 쪽으로 가는 비율
const FOLLOW_HOLD = 2600 // 무입력이면 프리셋 위치로

/* 보간 가능한 값의 자리 */
const SPEED = 0, STEP = 1, AX = 2, AY = 3, KS = 4, TINT = 8, TINTA = 11, DIM = 12
const N = 13

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)
const easeIn = (t: number) => t * t * t

interface Slot {
  ratio: [number, number] | null
  fromX: number
  fromY: number
  homeX: number
  homeY: number
  x: number
  y: number
  init: boolean
}

function guessTier(renderer: string): Tier {
  const r = renderer.toLowerCase()
  if (/swiftshader|llvmpipe|software|basic render|microsoft basic/.test(r)) return 'C'
  if (/apple m\d|apple gpu|nvidia|geforce|rtx|quadro|radeon|amd|apple a1[5-9]/.test(r)) return 'A'
  if (/intel|mali|adreno|powervr|apple a1[0-4]|uhd|iris/.test(r)) return 'B'
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4
  return cores >= 8 ? 'A' : 'B'
}

function samePalette(a: Palette, b: Palette) {
  const eq = (x: RGBA, y: RGBA) => Math.abs(x[0] - y[0]) + Math.abs(x[1] - y[1]) + Math.abs(x[2] - y[2]) + Math.abs(x[3] - y[3]) < 0.004
  return eq(a.minor, b.minor) && eq(a.major, b.major) && eq(a.accent, b.accent)
}

export class FieldEngine {
  /* 설정 */
  private level: MotionLevel = 'rich'
  private theme: ThemeName = 'dark'
  private tierSetting: 'auto' | Tier = 'auto'
  private debug = false
  private osReduced = false
  private tier: Tier = 'B'
  private tierDecided = false
  private stillDegraded = false
  private forced2d = false

  /* DOM */
  private host: HTMLDivElement | null = null
  private canvas: HTMLCanvasElement | null = null
  private canvas2d: HTMLCanvasElement | null = null
  private gl: GLField | null = null
  private renderMode: 'gl' | '2d' = 'gl'
  private renderer = ''
  private hud: HTMLElement | null = null
  private viewW = 1
  private viewH = 1
  private res = 1
  private portrait = false
  private cleanups: Array<() => void> = []
  private attached = false

  /* 등록부 (Map은 넣은 순서 유지 → 마지막이 맨 위) */
  private moods = new Map<number, MoodSpec>()
  private datas = new Map<number, FieldData>()
  private pins = new Map<number, PinSpec>()
  private pauses = new Map<number, PauseSpec>()
  private nextId = 1

  /* 보간 상태 */
  private cur = new Float64Array(N)
  private from = new Float64Array(N)
  private to = new Float64Array(N)
  private twT0 = 0
  private twDur = 0
  private slots: Slot[] = Array.from({ length: 4 }, () => ({ ratio: null, fromX: 0, fromY: 0, homeX: 0, homeY: 0, x: 0, y: 0, init: false }))
  private knotEl: RefObject<Element | null> | null = null
  private followAllowed = true
  private activeKnots = 0
  private targetBreath = false
  private preset: MoodName = 'today'
  private tintCss: string | undefined
  private ringsFrom = 0
  private ringsTo = 0
  private ringsCur = 0
  private ringsT0 = 0
  private ringsDur = 0
  private palFrom: Palette
  private palTo: Palette
  private palCur: Palette
  private palT0 = 0
  private palDur = 0
  private follow = 0
  private pk = { x: 0, y: 0, s: 0, init: false }
  private breathK = 0
  private time = SEED_TIME
  private epoch = typeof performance !== 'undefined' ? performance.now() : 0
  private ripples: Array<{ x: number; y: number; t0: number; amp: number; acc: number }> = []
  private phFrom = 0
  private phTo = 0
  private phT0 = -1e9
  private phDur = 700
  private sealT0 = -1e9
  private sealX = 0
  private sealY = 0
  private sealLast = -1e9
  private sealColorOnly = false
  private ovDim = 1
  private hardPaused = false
  private overlay = false
  private pauseTimer = 0

  /* 루프 */
  private raf = 0
  private running = false
  private lastRender = 0
  private stillQueued = 0
  private paletteQueued = 0

  /* 측정 */
  private samples: number[] = []
  private measurePhase: 'initial' | 'rolling' = 'initial'
  private windowStart = 0
  private cStrikes = 0
  private p95 = 0
  private jsMs = 0
  private fps = 0
  private fpsCount = 0
  private fpsT0 = 0
  private hudT = 0

  /* 바깥으로 알리는 값 */
  private prefs: MotionPrefs = { level: 'rich', reduced: false, tier: 'B', fps: 0 }
  private prefSubs = new Set<() => void>()
  private stamps: StampItem[] = []
  private stampSubs = new Set<() => void>()

  /* 미리 만든 유니폼 버퍼 */
  private U: FrameUniforms = {
    viewW: 1, viewH: 1, res: 1, time: 0, now: 0, step: 0.09, ax: 0.55, ay: 1.45, scale: 0.0024, amp: 1, octaves: 2,
    knots: new Float32Array(16), knotR: 110, ripples: new Float32Array(16), rippleAcc: new Float32Array(4), phase: 0,
    glow: 0, tint: new Float32Array(4), rings: new Float32Array(4), seal: new Float32Array(4), sealBump: 1, dim: 1,
    minor: new Float32Array(4), major: new Float32Array(4), accent: new Float32Array(3),
  }

  constructor() {
    const pal = readPaletteSafe('dark')
    this.palFrom = pal
    this.palTo = pal
    this.palCur = pal
    if (typeof window !== 'undefined' && window.matchMedia) {
      this.osReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    }
    this.applyTarget(true)
    this.prefs = { level: this.level, reduced: this.mode === 'off', tier: this.tier, fps: 0 }
  }

  /* ---------- 상태 ---------- */

  get mode(): Mode {
    return this.osReduced || this.level === 'off' ? 'off' : this.level
  }

  private get fieldStill(): boolean {
    return this.mode === 'off' || this.stillDegraded
  }

  configure(o: { level: MotionLevel; theme: ThemeName; tier: 'auto' | Tier; debug: boolean }): void {
    const prevMode = this.mode
    const themeChanged = o.theme !== this.theme
    const tierChanged = o.tier !== this.tierSetting
    this.level = o.level
    this.theme = o.theme
    this.debug = o.debug
    if (tierChanged) {
      this.tierSetting = o.tier
      this.stillDegraded = false
      this.resetMeasure()
      if (o.tier !== 'auto') this.setTier(o.tier)
      else if (this.attached) this.setTier(guessTier(this.renderer))
    }
    if (themeChanged) this.schedulePalette()
    if (prevMode !== this.mode) this.onModeChange()
    this.emitPrefs()
  }

  private onModeChange() {
    if (this.mode === 'off') {
      this.ripples = []
      this.phT0 = -1e9
      this.sealT0 = -1e9
      this.applyTarget(true)
    }
    this.refresh()
  }

  /* ---------- DOM 연결 ---------- */

  attach(host: HTMLDivElement): void {
    if (this.attached) this.detach()
    this.attached = true
    this.host = host
    const canvas = document.createElement('canvas')
    canvas.setAttribute('aria-hidden', 'true')
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block'
    host.appendChild(canvas)
    this.canvas = canvas

    try {
      this.gl = new GLField(canvas)
      this.renderer = this.gl.renderer
      this.renderMode = 'gl'
    } catch {
      this.gl = null
      this.renderMode = '2d'
    }
    if (!this.tierDecided || this.tierSetting !== 'auto') {
      this.setTier(this.tierSetting === 'auto' ? this.initialTier() : this.tierSetting, false)
      this.tierDecided = true
    }

    const on = <K extends keyof WindowEventMap>(t: K, f: (e: WindowEventMap[K]) => void, opt?: AddEventListenerOptions) => {
      window.addEventListener(t, f, opt)
      this.cleanups.push(() => window.removeEventListener(t, f, opt))
    }
    const onVis = () => {
      this.lastRender = 0
      this.refresh()
    }
    document.addEventListener('visibilitychange', onVis)
    this.cleanups.push(() => document.removeEventListener('visibilitychange', onVis))

    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onMq = () => {
      const prev = this.mode
      this.osReduced = mq.matches
      if (prev !== this.mode) this.onModeChange()
      this.emitPrefs()
    }
    mq.addEventListener('change', onMq)
    this.cleanups.push(() => mq.removeEventListener('change', onMq))

    const ro = new ResizeObserver(() => this.resize())
    ro.observe(host)
    this.cleanups.push(() => ro.disconnect())
    on('resize', () => this.resize())

    // 포인터가 움직이면 루프가 멈춰 있지 않은지만 확인 (값은 input.ts가 기록)
    on('pointermove', () => {
      if (!this.running && this.shouldRun()) this.kick()
    }, { passive: true })
    // '끔'·정지 프레임에서 옹이가 요소에 붙어 있으면 스크롤에 맞춰 다시 그림
    on('scroll', () => {
      if (!this.running && this.knotEl) this.requestStill()
    }, { passive: true, capture: true })

    const mo = new MutationObserver(() => this.schedulePalette())
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] })
    this.cleanups.push(() => mo.disconnect())

    if (this.gl) {
      const lost = (e: Event) => {
        e.preventDefault()
        this.stop()
        this.renderMode = '2d'
        this.requestStill()
      }
      const restored = () => {
        try {
          this.gl?.init()
          if (!this.forced2d) this.renderMode = 'gl'
        } catch {
          this.renderMode = '2d'
        }
        this.syncCanvases()
        this.refresh()
      }
      canvas.addEventListener('webglcontextlost', lost)
      canvas.addEventListener('webglcontextrestored', restored)
      this.cleanups.push(() => {
        canvas.removeEventListener('webglcontextlost', lost)
        canvas.removeEventListener('webglcontextrestored', restored)
      })
    }

    this.batterySaver()
    input.ensure()
    this.readPaletteNow(false)
    this.resize()
    for (const sl of this.slots) sl.init = false
    this.applyTarget(true)
    this.syncCanvases()
    this.refresh()
    if (this.debug) this.checkLayers()
  }

  detach(): void {
    this.stop()
    this.cleanups.forEach((f) => f())
    this.cleanups = []
    window.clearTimeout(this.pauseTimer)
    if (this.stillQueued) cancelAnimationFrame(this.stillQueued)
    if (this.paletteQueued) cancelAnimationFrame(this.paletteQueued)
    this.stillQueued = 0
    this.paletteQueued = 0
    if (this.gl) {
      this.gl.dispose()
      try {
        this.gl.gl.getExtension('WEBGL_lose_context')?.loseContext()
      } catch {
        /* 무시 */
      }
    }
    this.gl = null
    this.canvas?.remove()
    this.canvas2d?.remove()
    this.canvas = null
    this.canvas2d = null
    this.host = null
    this.attached = false
  }

  setHud(el: HTMLElement | null): void {
    this.hud = el
    this.updateHud(performance.now(), true)
  }

  private initialTier(): Tier {
    let t: Tier = this.renderMode === 'gl' ? guessTier(this.renderer) : 'C'
    const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
    if (conn?.saveData && t === 'A') t = 'B'
    return t
  }

  private batterySaver() {
    const nav = navigator as Navigator & { getBattery?: () => Promise<{ level: number; charging: boolean; addEventListener: (t: string, f: () => void) => void }> }
    if (!nav.getBattery) return
    nav
      .getBattery()
      .then((b) => {
        const check = () => {
          if (this.tierSetting === 'auto' && this.tier === 'A' && b.level <= 0.2 && !b.charging) this.setTier('B')
        }
        check()
        b.addEventListener('levelchange', check)
        b.addEventListener('chargingchange', check)
      })
      .catch(() => {})
  }

  private checkLayers() {
    try {
      const bg = getComputedStyle(document.body).backgroundColor
      const c = resolveColor(bg)
      if (c && c[3] > 0.01) console.warn('[fx] body에 배경색이 있어 결 필드가 가려집니다. html에 --bg-0, body는 transparent로 두세요.')
    } catch {
      /* 무시 */
    }
  }

  private setTier(t: Tier, doResize = true) {
    if (t === this.tier && this.tierDecided) return
    this.tier = t
    this.resetMeasure()
    if (doResize) this.resize()
    this.emitPrefs()
  }

  private resize() {
    const host = this.host
    const canvas = this.canvas
    if (!host || !canvas) return
    const w = Math.max(1, host.clientWidth || window.innerWidth)
    const h = Math.max(1, host.clientHeight || window.innerHeight)
    this.viewW = w
    this.viewH = h
    const dpr = window.devicePixelRatio || 1
    let res = dpr * TIER_SCALE[this.tier]
    const maxPx = TIER_MAXPX[this.tier]
    if (w * h * res * res > maxPx) res = Math.sqrt(maxPx / (w * h))
    res = Math.max(0.35, res)
    this.res = res
    const W = Math.max(1, Math.round(w * res))
    const H = Math.max(1, Math.round(h * res))
    if (canvas.width !== W) canvas.width = W
    if (canvas.height !== H) canvas.height = H
    const portrait = h > w || w < 600
    if (portrait !== this.portrait) {
      this.portrait = portrait
      this.applyTarget(false, 500)
    }
    // 크기를 바꾸면 버퍼가 비므로 멈춰 있어도 한 장은 다시 그린다
    if (!this.running) this.requestStill(true)
  }

  private syncCanvases() {
    if (!this.host || !this.canvas) return
    const use2d = this.renderMode === '2d' || this.forced2d || !this.gl
    if (use2d && !this.canvas2d) {
      const c = document.createElement('canvas')
      c.setAttribute('aria-hidden', 'true')
      c.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block'
      this.host.appendChild(c)
      this.canvas2d = c
    }
    this.canvas.style.display = use2d ? 'none' : 'block'
    if (this.canvas2d) this.canvas2d.style.display = use2d ? 'block' : 'none'
  }

  /* ---------- 등록부 ---------- */

  pushMood(spec: MoodSpec): number {
    const id = this.nextId++
    this.moods.set(id, spec)
    this.applyTarget()
    return id
  }
  updateMood(id: number, spec: MoodSpec): void {
    if (!this.moods.has(id)) return
    this.moods.set(id, spec)
    this.applyTarget()
  }
  removeMood(id: number): void {
    if (this.moods.delete(id) && this.moods.size) this.applyTarget()
  }

  pushData(d: FieldData): number {
    const id = this.nextId++
    this.datas.set(id, d)
    this.applyTarget()
    return id
  }
  updateData(id: number, d: FieldData): void {
    if (!this.datas.has(id)) return
    this.datas.set(id, d)
    this.applyTarget()
  }
  removeData(id: number): void {
    if (this.datas.delete(id)) this.applyTarget()
  }

  pushPin(p: PinSpec): number {
    const id = this.nextId++
    this.pins.set(id, p)
    this.applyTarget()
    return id
  }
  updatePin(id: number, p: PinSpec): void {
    if (!this.pins.has(id)) return
    this.pins.set(id, p)
    this.applyTarget()
  }
  removePin(id: number): void {
    if (this.pins.delete(id)) this.applyTarget()
  }

  pauseId(): number {
    return this.nextId++
  }
  setPause(id: number, reason: PauseReason, active: boolean): void {
    const prev = this.pauses.get(id)
    if (active) this.pauses.set(id, { reason, active: true, until: 0 })
    else if (prev) prev.active = false
    else return
    if (!active && prev) prev.until = performance.now() + (reason === 'overlay' ? 0 : 1500)
    this.evalPause()
  }
  removePause(id: number): void {
    const p = this.pauses.get(id)
    if (!p) return
    if (p.active) {
      p.active = false
      p.until = performance.now() + (p.reason === 'overlay' ? 0 : 1500)
    }
    this.evalPause()
  }

  private evalPause() {
    const now = performance.now()
    let hard = false
    let ov = false
    let next = Infinity
    for (const [id, p] of this.pauses) {
      const on = p.active || now < p.until
      if (!on) {
        if (!p.active) this.pauses.delete(id)
        continue
      }
      if (p.reason === 'overlay') ov = true
      else hard = true
      if (!p.active) next = Math.min(next, p.until)
    }
    window.clearTimeout(this.pauseTimer)
    if (next < Infinity) this.pauseTimer = window.setTimeout(() => this.evalPause(), Math.max(16, next - now + 8))
    const changed = hard !== this.hardPaused
    this.hardPaused = hard
    this.overlay = ov
    if (this.host) {
      this.host.style.opacity = hard ? '0.35' : '1'
    }
    if (changed) {
      this.lastRender = 0
      this.refresh()
    }
  }

  /* ---------- 목표 분위기 계산 ---------- */

  private topMood(): MoodSpec | null {
    let top: MoodSpec | null = null
    for (const m of this.moods.values()) top = m
    return top
  }
  private topPin(): PinSpec | null {
    let top: PinSpec | null = null
    for (const p of this.pins.values()) top = p
    return top
  }

  /** 등록부 → 목표값. instant면 보간 없이 바로 */
  private applyTarget(instant = false, durOverride?: number) {
    const now = typeof performance !== 'undefined' ? performance.now() : 0
    const spec = this.topMood() ?? { preset: this.preset }
    const ov = spec.override ?? {}
    const base = MOODS[spec.preset]
    const m: Mood = { ...base, ...ov }
    const data: FieldData = {}
    for (const d of this.datas.values()) {
      if (d.rings != null) data.rings = d.rings
      if (d.load != null) data.load = d.load
      if (d.pressure != null) data.pressure = d.pressure
      if (d.tint != null) data.tint = d.tint
    }
    const pin = this.topPin()

    // 옹이 자리
    let pos: Array<[number, number]>
    if (ov.knots) pos = ov.knots.slice(0, 4)
    else if ('knot' in ov) pos = ov.knot ? [ov.knot] : []
    else if (base.knots?.length) pos = base.knots.slice(0, 4)
    else pos = base.knot ? [base.knot] : []
    const portraitKnot = PORTRAIT_KNOTS[spec.preset]
    if (this.portrait && portraitKnot && pos.length === 1 && !('knot' in ov) && !ov.knots) pos = [portraitKnot]
    const ks = [0, 0, 0, 0]
    for (let i = 0; i < pos.length; i++) ks[i] = m.knotStrength
    this.knotEl = null
    this.followAllowed = true
    if (pin) {
      this.knotEl = pin.ref
      this.followAllowed = pin.followPointer !== false
      ks[0] = pin.strength ?? (m.knotStrength > 0 ? m.knotStrength : 0.8)
      if (!pos.length) pos = [[0.5, 0.5]]
    } else if (spec.knotRef) {
      this.knotEl = spec.knotRef
      if (!pos.length) pos = [[0.5, 0.5]]
      if (ks[0] === 0) ks[0] = m.knotStrength
    }

    const load = data.load
    const pressure = data.pressure
    const step = m.step * (load != null ? 1.3 + (0.72 - 1.3) * clamp01(load) : 1)
    const speed = m.speed * (pressure != null ? 1 + 0.6 * clamp01(pressure) : 1)
    this.tintCss = data.tint ?? m.tint
    const tint = resolveColor(this.tintCss) ?? this.palTo.accent
    const rings = Math.max(0, Math.min(14, data.rings ?? m.rings ?? 0))

    const mode = this.mode
    const dur = instant || mode === 'off' ? 0 : (durOverride ?? spec.transitionMs ?? 900)

    // 지금 값을 출발점으로
    this.sampleTween(now)
    this.from.set(this.cur)
    const to = this.to
    to[SPEED] = speed
    to[STEP] = step
    to[AX] = m.aniso[0]
    to[AY] = m.aniso[1]
    for (let i = 0; i < 4; i++) to[KS + i] = ks[i]!
    to[TINT] = tint[0]
    to[TINT + 1] = tint[1]
    to[TINT + 2] = tint[2]
    to[TINTA] = m.tintAmount ?? 1
    to[DIM] = m.dim ?? 1
    this.twT0 = now
    this.twDur = dur
    if (dur === 0) {
      this.cur.set(to)
      this.from.set(to)
    }

    let active = 0
    for (let i = 0; i < 4; i++) {
      const s = this.slots[i]!
      if (ks[i]! > 0.01) active++
      if (pos[i]) s.ratio = pos[i]!
      s.fromX = s.homeX
      s.fromY = s.homeY
      // 새로 생기는 옹이는 제자리에서 피어난다 (보간 없음이면 전부 제자리로)
      if (dur === 0 || !s.init || (this.cur[KS + i]! < 0.02 && ks[i]! > 0)) {
        const [tx, ty] = this.slotTarget(i)
        s.fromX = s.homeX = s.x = tx
        s.fromY = s.homeY = s.y = ty
        s.init = true
      }
    }
    this.activeKnots = active
    this.targetBreath = !!m.breath
    this.preset = spec.preset

    if (Math.abs(rings - this.ringsTo) > 1e-4 || dur === 0) {
      this.ringsFrom = dur === 0 ? rings : this.ringsCur
      this.ringsTo = rings
      this.ringsT0 = now
      this.ringsDur = dur === 0 ? 0 : mode === 'calm' ? 400 : 1200
      if (dur === 0) this.ringsCur = rings
    }
    if (!this.running) {
      this.kick()
      this.requestStill()
    }
  }

  private slotTarget(i: number): [number, number] {
    const s = this.slots[i]!
    if (i === 0 && this.knotEl) {
      const el = this.knotEl.current
      if (el && el.isConnected) {
        const r = el.getBoundingClientRect()
        if (r.width || r.height || r.left || r.top) return [r.left + r.width / 2, r.top + r.height / 2]
      }
    }
    if (s.ratio) return [s.ratio[0] * this.viewW, s.ratio[1] * this.viewH]
    return [s.homeX || this.viewW * 0.5, s.homeY || this.viewH * 0.5]
  }

  private sampleTween(now: number) {
    const p = this.twDur > 0 ? clamp01((now - this.twT0) / this.twDur) : 1
    const e = easeInOut(p)
    for (let i = 0; i < N; i++) this.cur[i] = this.from[i]! + (this.to[i]! - this.from[i]!) * e
    return e
  }

  /* ---------- 팔레트 (테마) ---------- */

  private schedulePalette() {
    if (typeof window === 'undefined' || this.paletteQueued) return
    this.paletteQueued = requestAnimationFrame(() => {
      this.paletteQueued = 0
      this.readPaletteNow(true)
      // 스타일시트가 늦게 붙는 경우 한 번 더
      window.setTimeout(() => this.readPaletteNow(true), 150)
    })
  }

  private readPaletteNow(animate: boolean) {
    const next = readPaletteSafe(this.theme)
    if (samePalette(next, this.palTo)) return
    const now = performance.now()
    this.palFrom = this.palCur
    this.palTo = next
    this.palT0 = now
    this.palDur = animate && this.mode !== 'off' ? 680 : 0
    if (this.palDur === 0) this.palCur = next
    // 색조가 인주색을 따르거나 var()면 테마 값으로 다시 풀어야 한다
    this.applyTarget(!animate, 680)
  }

  private samplePalette(now: number) {
    if (this.palDur <= 0) {
      this.palCur = this.palTo
      return
    }
    const p = clamp01((now - this.palT0) / this.palDur)
    const e = easeInOut(p)
    this.palCur = {
      minor: mixRGBA(this.palFrom.minor, this.palTo.minor, e),
      major: mixRGBA(this.palFrom.major, this.palTo.major, e),
      accent: mixRGBA(this.palFrom.accent, this.palTo.accent, e),
    }
    if (p >= 1) this.palDur = 0
  }

  /* ---------- 연출 ---------- */

  ripple(x: number, y: number, o?: RippleOptions): void {
    const mode = this.mode
    if (mode === 'off' || this.hardPaused || this.fieldStill) return
    const now = performance.now()
    const amp = (o?.strength ?? 1) * (mode === 'calm' ? 0.4 : 1)
    if (amp <= 0) return
    const t0 = (now - this.epoch) / 1000
    this.ripples = this.ripples.filter((r) => t0 - r.t0 < 2.6)
    this.ripples.push({ x, y, t0, amp, acc: o?.accent ? 1 : 0 })
    while (this.ripples.length > 4) this.ripples.shift()
    this.kick()
  }

  /** 결 와이프: 위상 ±1 (700ms in-out) */
  wipe(dir: 1 | -1): void {
    if (this.mode !== 'rich' || this.fieldStill) return
    const now = performance.now()
    const cur = this.phaseAt(now)
    let from = cur
    let base = 0
    if (Math.abs(from) > 8) {
      base = Math.round(from / 4) * 4
      from -= base
    }
    this.phFrom = from
    this.phTo = from + dir
    this.phT0 = now
    this.phDur = 700
    this.kick()
  }

  private phaseAt(now: number): number {
    const p = clamp01((now - this.phT0) / this.phDur)
    return this.phFrom + (this.phTo - this.phFrom) * easeInOut(p)
  }

  /** 인주 번짐. 10초에 1회 상한. 실제로 번졌으면 true */
  seal(x: number, y: number): boolean {
    const mode = this.mode
    if (mode === 'off' || this.fieldStill) return false
    const now = performance.now()
    if (now - this.sealLast < 10000) return false
    this.sealLast = now
    this.sealT0 = now
    this.sealX = x
    this.sealY = y
    this.sealColorOnly = mode === 'calm'
    this.kick()
    return true
  }

  /** 실험실용: 10초 상한 초기화 */
  resetSealCooldown(): void {
    this.sealLast = -1e9
  }

  sealCooldownLeft(): number {
    return Math.max(0, 10000 - (performance.now() - this.sealLast))
  }

  showStamp(s: Omit<StampItem, 'id'>): void {
    const item = { ...s, id: this.nextId++ }
    this.stamps = [...this.stamps, item].slice(-3)
    this.stampSubs.forEach((f) => f())
  }
  removeStamp(id: number): void {
    this.stamps = this.stamps.filter((s) => s.id !== id)
    this.stampSubs.forEach((f) => f())
  }
  subscribeStamps = (f: () => void) => {
    this.stampSubs.add(f)
    return () => {
      this.stampSubs.delete(f)
    }
  }
  getStamps = () => this.stamps

  /* ---------- prefs 스토어 ---------- */

  subscribe = (f: () => void) => {
    this.prefSubs.add(f)
    return () => {
      this.prefSubs.delete(f)
    }
  }
  getPrefs = () => this.prefs

  private emitPrefs() {
    const p = this.prefs
    const reduced = this.mode === 'off'
    if (p.level === this.level && p.reduced === reduced && p.tier === this.tier && p.fps === this.fps) return
    this.prefs = { level: this.level, reduced, tier: this.tier, fps: this.fps }
    this.prefSubs.forEach((f) => f())
  }

  /* ---------- 루프 ---------- */

  private shouldRun(): boolean {
    return (
      this.attached &&
      this.renderMode === 'gl' &&
      !this.forced2d &&
      !!this.gl &&
      !this.gl.lost &&
      typeof document !== 'undefined' &&
      !document.hidden &&
      !this.hardPaused &&
      !this.fieldStill
    )
  }

  private kick() {
    if (!this.attached) return
    if (this.shouldRun()) {
      if (!this.running) {
        this.running = true
        this.lastRender = 0
        this.raf = requestAnimationFrame(this.frame)
      }
    } else if (this.running) this.stop()
  }

  /** 상태가 바뀌었을 때: 돌 수 있으면 루프, 아니면 정지 프레임 한 장 */
  private refresh() {
    this.kick()
    if (!this.running && !this.hardPaused && typeof document !== 'undefined' && !document.hidden) this.requestStill()
  }

  private stop() {
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0
    this.running = false
  }

  private capPeriod(now: number): number {
    let cap = TIER_CAP[this.tier]
    if (this.overlay || now - input.last() > 120000) cap = Math.max(cap, 1000 / 30)
    return cap
  }

  private frame = (now: number) => {
    this.raf = 0
    if (!this.shouldRun()) {
      this.running = false
      if (!this.hardPaused) this.requestStill()
      return
    }
    this.raf = requestAnimationFrame(this.frame)
    const cap = this.capPeriod(now)
    if (cap > 0 && this.lastRender > 0 && now - this.lastRender < cap - 2) return
    const interval = this.lastRender > 0 ? now - this.lastRender : 0
    const dt = Math.min(64, interval || 16.7)
    this.lastRender = now
    const t0 = performance.now()
    this.update(now, dt)
    this.draw(now)
    const js = performance.now() - t0
    this.measure(now, interval, js, cap > TIER_CAP[this.tier])
  }

  /** 멈춘 상태(끔·대체·정지 등급)에서 한 장 그리기. force면 일시정지 중에도 */
  requestStill(force = false) {
    if (typeof window === 'undefined' || !this.attached) return
    if (this.running) return
    if (this.hardPaused && !force) return
    if (this.stillQueued) return
    this.stillQueued = requestAnimationFrame(() => {
      this.stillQueued = 0
      if (this.running) return
      const now = performance.now()
      if (!this.hardPaused) {
        if (this.fieldStill || this.renderMode === '2d' || this.forced2d) {
          this.time = this.mode === 'off' ? SEED_TIME : this.time
          this.snapAll(now)
        }
      }
      this.draw(now)
    })
  }

  /** 정지 프레임용: 보간 없이 목표값으로 */
  private snapAll(now: number) {
    this.twDur = 0
    this.cur.set(this.to)
    this.from.set(this.to)
    this.ringsCur = this.ringsTo
    this.ringsDur = 0
    this.palDur = 0
    this.palCur = this.palTo
    this.breathK = 0
    this.follow = 0
    this.pk.s = 0
    for (let i = 0; i < 4; i++) {
      const s = this.slots[i]!
      const [tx, ty] = this.slotTarget(i)
      s.homeX = s.x = s.fromX = tx
      s.homeY = s.y = s.fromY = ty
    }
    void now
  }

  private update(now: number, dt: number) {
    const mode = this.mode
    const e = this.sampleTween(now)
    // 고리
    if (this.ringsDur > 0) {
      const p = clamp01((now - this.ringsT0) / this.ringsDur)
      this.ringsCur = this.ringsFrom + (this.ringsTo - this.ringsFrom) * easeOut(p)
      if (p >= 1) this.ringsDur = 0
    } else this.ringsCur = this.ringsTo
    this.samplePalette(now)

    const idle = now - input.last()
    const deep = idle > 120000
    const wantBreath = mode === 'rich' && ((this.targetBreath && idle > 20000) || this.preset === 'focus')
    this.breathK += ((wantBreath ? 1 : 0) - this.breathK) * (1 - Math.pow(0.25, dt / 1000))

    let mul = mode === 'calm' ? 0.3 : 1
    if (deep) mul *= 0.3
    if (this.overlay) mul *= 0.5
    this.time += (dt / 1000) * 0.055 * this.cur[SPEED]! * mul
    this.ovDim += ((this.overlay ? 0.6 : 1) - this.ovDim) * (1 - Math.pow(0.002, dt / 1000))

    // 옹이: 프리셋 자리(보간) → 포인터 쪽으로 0.92 → dt 보정 지수 보간
    const ptrActive = pointer.inside && now - pointer.t < FOLLOW_HOLD && pointer.x >= 0
    const canFollow = this.followAllowed && this.activeKnots >= 1
    const fT = ptrActive && canFollow ? FOLLOW : 0
    const kf = fT > this.follow ? 1 - Math.pow(0.0005, dt / 1000) : 1 - Math.pow(0.12, dt / 1000)
    this.follow += (fT - this.follow) * kf
    const eS = 1 - Math.pow(0.0005, dt / 1000)
    const bx = this.breathK * 5 * Math.sin(now * 0.00031)
    const by = this.breathK * 4 * Math.cos(now * 0.00023)
    const single = this.activeKnots === 1
    for (let i = 0; i < 4; i++) {
      const s = this.slots[i]!
      const [tx, ty] = this.slotTarget(i)
      s.homeX = s.fromX + (tx - s.fromX) * e
      s.homeY = s.fromY + (ty - s.fromY) * e
      let gx = s.homeX + bx
      let gy = s.homeY + by
      if (single && i === 0 && this.follow > 0.001) {
        gx += (pointer.x - gx) * this.follow
        gy += (pointer.y - gy) * this.follow
      }
      s.x += (gx - s.x) * eS
      s.y += (gy - s.y) * eS
    }
    // 옹이가 여러 개인 분위기(그래프)에서는 포인터가 별 하나가 된다
    const multi = this.activeKnots >= 2 && this.activeKnots <= 3
    const pkT = multi && canFollow ? (0.75 * this.follow) / FOLLOW : 0
    this.pk.s += (pkT - this.pk.s) * (1 - Math.pow(0.02, dt / 1000))
    if (ptrActive) {
      if (!this.pk.init) {
        this.pk.x = pointer.x
        this.pk.y = pointer.y
        this.pk.init = true
      }
      this.pk.x += (pointer.x - this.pk.x) * eS
      this.pk.y += (pointer.y - this.pk.y) * eS
    }
  }

  private draw(now: number) {
    if (!this.attached) return
    const U = this.U
    const W = this.viewW
    const H = this.viewH
    const mode = this.mode
    const still = this.fieldStill || this.renderMode === '2d' || this.forced2d
    const R = Math.max(110, Math.min(W, H) * 0.22)
    const breathWave = 0.5 - 0.5 * Math.cos((now / 6000) * Math.PI * 2)
    const cur = this.cur
    const pal = this.palCur

    if (still) {
      if (!this.canvas2d && (this.renderMode === '2d' || this.forced2d || !this.gl)) this.syncCanvases()
      if (this.renderMode === '2d' || this.forced2d || !this.gl) {
        if (!this.canvas2d) return
        drawStill2D(this.canvas2d, W, H, {
          time: this.time,
          step: cur[STEP]!,
          ax: cur[AX]!,
          ay: cur[AY]!,
          scale: 0.0024,
          knots: this.slots.map((s, i) => ({ x: s.x, y: s.y, s: cur[KS + i]! })),
          knotR: R,
          tint: [cur[TINT]!, cur[TINT + 1]!, cur[TINT + 2]!, 1],
          tintAmt: cur[TINTA]!,
          rings: this.ringsCur,
          ringScale: Math.min(1.25, Math.max(0.75, R / 170)),
          palette: pal,
          dim: cur[DIM]!,
          octaves: 2,
        })
        this.updateHud(now)
        return
      }
    }

    U.viewW = W
    U.viewH = H
    U.res = this.res
    U.time = this.time
    U.now = (now - this.epoch) / 1000
    U.step = cur[STEP]!
    U.ax = cur[AX]!
    U.ay = cur[AY]!
    U.amp = 1 - 0.08 * this.breathK * breathWave
    U.octaves = TIER_OCT[this.tier]
    const focusPulse = this.preset === 'focus' ? 1 - 0.22 * this.breathK * breathWave : 1
    for (let i = 0; i < 4; i++) {
      const s = this.slots[i]!
      let ks = cur[KS + i]! * (i === 0 ? focusPulse : 1)
      let x = s.x
      let y = s.y
      if (i === 3 && this.pk.s > ks) {
        ks = this.pk.s
        x = this.pk.x
        y = this.pk.y
      }
      U.knots[i * 4] = x
      U.knots[i * 4 + 1] = y
      U.knots[i * 4 + 2] = ks
      U.knots[i * 4 + 3] = 0
    }
    U.knotR = R
    const tNow = U.now
    for (let i = 0; i < 4; i++) {
      const r = this.ripples[i]
      const live = r && !still && tNow - r.t0 < 2.6
      U.ripples[i * 4] = live ? r.x : 0
      U.ripples[i * 4 + 1] = live ? r.y : 0
      U.ripples[i * 4 + 2] = live ? r.t0 : 0
      U.ripples[i * 4 + 3] = live ? r.amp : 0
      U.rippleAcc[i] = live ? r.acc : 0
    }
    const php = clamp01((now - this.phT0) / this.phDur)
    U.phase = still ? 0 : this.phaseAt(now)
    U.glow = still || php >= 1 ? 0 : 0.45 * Math.sin(Math.PI * php)
    U.tint[0] = cur[TINT]!
    U.tint[1] = cur[TINT + 1]!
    U.tint[2] = cur[TINT + 2]!
    U.tint[3] = cur[TINTA]!
    U.rings[0] = this.ringsCur
    U.rings[1] = Math.min(1.25, Math.max(0.75, R / 170))
    U.rings[2] = 1
    U.rings[3] = 0
    // 인주 번짐: 0→1 300ms ease-out, 1→0 600ms ease-in
    const st = now - this.sealT0
    let env = 0
    let grow = 0
    if (!still && st >= 0 && st < 900) {
      env = st < 300 ? easeOut(st / 300) : 1 - easeIn((st - 300) / 600)
      grow = easeOut(st / 900)
    }
    U.seal[0] = this.sealX
    U.seal[1] = this.sealY
    U.seal[2] = env
    U.seal[3] = grow
    U.sealBump = this.sealColorOnly ? 0 : 1
    U.dim = cur[DIM]! * this.ovDim
    U.minor.set(pal.minor)
    U.major.set(pal.major)
    U.accent[0] = pal.accent[0]
    U.accent[1] = pal.accent[1]
    U.accent[2] = pal.accent[2]
    void mode
    this.gl?.draw(U)
    this.fpsCount++
    this.updateHud(now)
  }

  /* ---------- 측정 · 등급 ---------- */

  private resetMeasure() {
    this.samples = []
    this.measurePhase = 'initial'
    this.windowStart = 0
    this.cStrikes = 0
  }

  private measure(now: number, interval: number, js: number, extraCap: boolean) {
    this.jsMs = this.jsMs ? this.jsMs * 0.95 + js * 0.05 : js
    if (!this.fpsT0) this.fpsT0 = now
    if (now - this.fpsT0 >= 1000) {
      this.fps = Math.round((this.fpsCount * 1000) / (now - this.fpsT0))
      this.fpsCount = 0
      this.fpsT0 = now
      this.emitPrefs()
    }
    if (extraCap || document.hidden || interval <= 0 || interval > 250) return
    this.samples.push(interval)
    if (!this.windowStart) this.windowStart = now
    const enough = this.measurePhase === 'initial' ? this.samples.length >= 120 : now - this.windowStart >= 2000
    if (!enough) return
    const sorted = [...this.samples].sort((a, b) => a - b)
    const pick = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))]!
    const p95 = pick(0.95)
    const p10 = pick(0.1)
    this.p95 = p95
    this.samples = []
    this.windowStart = now
    this.measurePhase = 'rolling'
    if (this.tierSetting !== 'auto') return
    // 화면 주사율보다 빠를 수는 없으니 p10(≈주사율)과 등급 예산 중 큰 쪽이 기준
    const budget = Math.max(TIER_BUDGET[this.tier], p10 * 0.98)
    if (p95 > 1.2 * budget) {
      const lower = LOWER[this.tier]
      if (lower) this.setTier(lower)
      else if (p95 > 1.5 * budget && ++this.cStrikes >= 2) {
        this.stillDegraded = true
        this.refresh()
      }
    } else this.cStrikes = 0
  }

  private updateHud(now: number, force = false) {
    const el = this.hud
    if (!el) return
    if (!force && now - this.hudT < 500) return
    this.hudT = now
    const s = this.stats()
    el.textContent =
      `${s.running ? s.fps : 0} fps · 등급 ${s.tier}${s.tierAuto ? ' 자동' : ' 고정'} · ${s.res.toFixed(2)}× ${s.megapixels.toFixed(1)}MP · ` +
      `js ${s.jsMs.toFixed(2)}ms · p95 ${s.p95 ? s.p95.toFixed(1) : '–'}ms · ${s.render === 'webgl2' ? 'WebGL2' : '2D 정지'} · ${s.paused ? '일시정지' : s.mode}`
  }

  stats(): FieldStats {
    const c = this.canvas
    return {
      fps: this.fps,
      tier: this.tier,
      tierAuto: this.tierSetting === 'auto',
      res: this.res,
      megapixels: c ? (c.width * c.height) / 1e6 : 0,
      jsMs: this.jsMs,
      p95: this.p95,
      renderer: this.renderer,
      render: this.renderMode === 'gl' && !this.forced2d && this.gl ? 'webgl2' : 'canvas2d',
      mode: this.mode,
      running: this.running,
      paused: this.hardPaused,
      view: [this.viewW, this.viewH],
    }
  }

  /* ---------- 실험실용 ---------- */

  simulateContextLoss(): boolean {
    return this.gl?.simulateLoss() ?? false
  }

  force2d(on: boolean): void {
    this.forced2d = on
    this.syncCanvases()
    this.stop()
    this.refresh()
  }

  ringsValue(): number {
    return this.ringsTo
  }

  /** 검증용 스냅샷 (옹이·포인터) */
  debugState() {
    return {
      preset: this.preset,
      follow: +this.follow.toFixed(3),
      activeKnots: this.activeKnots,
      pointer: { ...pointer },
      knots: this.slots.map((s, i) => ({ x: Math.round(s.x), y: Math.round(s.y), home: [Math.round(s.homeX), Math.round(s.homeY)], s: +this.cur[KS + i]!.toFixed(2) })),
      rings: +this.ringsCur.toFixed(2),
    }
  }
}

function readPaletteSafe(theme: ThemeName): Palette {
  return readPalette(theme)
}
