/**
 * 결 하늘 엔진 — v3 은하수를 FieldProvider 뒤에서 돌린다 (team/v3-integration-brief.md, team/design-v3-motion.md).
 *
 * 캔버스 1개·rAF 1개(src/galaxy/sky/sky.ts). React는 이 객체의 메서드만 부른다(프레임마다 리렌더 없음).
 * 정적 하늘은 시작·화면 크기 변경 때만 굽는다. 화면 전환·사건은 모두 유니폼과 데이터 별(점 수십 개)만 바꾼다 → 굽기 0회.
 *
 * 레이어 규칙(그대로): html에 배경, body는 transparent, 하늘은 position:fixed; inset:0; z-index:0,
 * 앱 루트는 position:relative; z-index:1.
 */
import { Sky, type Cam, type LookOverride, type SpecialStar } from '../../galaxy/sky/sky'
import type { SceneName } from '../../galaxy/sky/compositions'
import { deviceOf, pickComposition } from '../../galaxy/sky/compositions'
import { mulberry32 } from '../../galaxy/sky/rng'
import { examStar, todayStarPositions } from '../../galaxy/scenes'
import type { FieldStats } from '../engine/engine'
import type { FieldData, Mood, MoodName, MotionLevel, MotionPrefs, PauseReason, RippleOptions, ThemeName, Tier } from '../types'

export type Mode = 'rich' | 'calm' | 'off'

export interface MoodSpec {
  preset: MoodName
  override?: Partial<Mood>
  knotRef?: unknown
  transitionMs?: number
}
export interface PinSpec {
  ref: unknown
  strength?: number
  followPointer?: boolean
}
export interface StampItem {
  id: number
  x: number
  y: number
  text: string
  sub?: string
}
export interface CaptionItem {
  id: number
  x: number
  y: number
  text: string
  until: number
}

export type SkyPhase = 'auto' | 'blue' | 'night' | 'dawn'
export type StarKind = 'set' | 'small' | 'card' | 'note' | 'exam'
type Layer = 'today' | 'review' | 'exam' | 'graph' | 'focus'
type At = 'next' | Element | { x: number; y: number }

export interface SkyStatsOut {
  bakes: number
  lastBakeMs: number
  longTasksInNav: number
  navP95Ms: number
  tier: Tier
  fps: number
  /** 비행 계측 (camera §6) */
  flights?: { count: number; p95FrameMs: number; maxFrameMs: number }
}

/** UI CSS가 하늘과 같은 박자를 쓰도록 (design-v3-motion §3) */
export const SKY_TIMING = {
  navMs: 450,
  outMs: 180,
  inDelayMs: 170,
  inMs: 220,
  staggerMs: 30,
  dataOutMs: 225,
  overlayMs: 200,
  ease: 'cubic-bezier(.4,0,.2,1)',
} as const

const GOLD: [number, number, number] = [0.953, 0.824, 0.604]
const SEAL: [number, number, number] = [1.0, 0.561, 0.471]

/** 공간 → 하늘 장면 + 노출 (50–100%, 한 번에 45%p 이하) */
function sceneFor(preset: MoodName, phase: Exclude<SkyPhase, 'auto'>): { scene: SceneName; look: LookOverride } {
  switch (preset) {
    case 'landing':
      return { scene: 'hero', look: { bright: 1 } }
    case 'today':
      if (phase === 'blue') return { scene: 'today-class', look: { bright: 0.8 } }
      if (phase === 'dawn') return { scene: 'today-night', look: { bright: 0.9, airglow: 1, blue: 0.4 } }
      return { scene: 'today-night', look: { bright: 1 } }
    case 'notes':
      return { scene: 'notes', look: { bright: 0.55 } }
    case 'graph':
      return { scene: 'graph', look: { bright: 0.45 } } // 띠 45% — 노트 별자리가 주인공 (review #6)
    case 'review':
      return { scene: 'review', look: { bright: 0.7 } }
    case 'focus':
      return { scene: 'focus', look: { bright: 0.65 } }
    case 'planner':
      return { scene: 'review', look: { bright: 0.7, fall: 0.4 } }
    case 'settings': {
      // 오늘과 같은 자리, 노출 × 0.65 (review #8)
      const t = sceneFor('today', phase)
      return { scene: t.scene, look: { ...t.look, bright: (t.look.bright ?? 1) * 0.65 } }
    }
  }
}

/** 공간마다 보이는 데이터 층 (나머지는 225ms 동안 꺼진다) */
const LAYERS: Record<MoodName, Partial<Record<Layer, number>>> = {
  landing: { today: 1 },
  today: { today: 1, exam: 1 },
  focus: { today: 1, focus: 1 },
  review: { review: 1 },
  notes: {},
  graph: { graph: 1 },
  planner: { exam: 1, today: 0.5 },
  settings: {},
}

/* ---------- 은하 속 장소 (team/design-v3-camera.md §1) ---------- */
export type Travel = 'fly' | 'short' | 'off'
export interface CameraTarget {
  scene: MoodName
  /** 하늘 좌표(집 화면 비율 0..1). 없으면 그 공간의 장소 */
  focus?: [number, number]
  zoom?: number
  /** 이 비행의 길이(ms). 글자는 durationMs − 320ms에 들어온다 (review #7) */
  durationMs?: number
}
const PLACES: Record<MoodName, Cam> = {
  today: { x: 0.5, y: 0.5, z: 1 },
  landing: { x: 0.5, y: 0.5, z: 1 },
  settings: { x: 0.5, y: 0.5, z: 1 },
  planner: { x: 0.55, y: 0.47, z: 0.88 },
  notes: { x: 0.28, y: 0.36, z: 1.4 }, // 띠 몸통이 아닌 바깥 헤이즈 (review #8)
  review: { x: 0.66, y: 0.5, z: 1.9 },
  graph: { x: 0.7, y: 0.36, z: 2.3 },
  focus: { x: 0.48, y: 0.33, z: 3.0 },
}
const PLACES_PHONE: Partial<Record<MoodName, Cam>> = {
  planner: { x: 0.5, y: 0.46, z: 0.88 },
  notes: { x: 0.3, y: 0.4, z: 1.4 },
  review: { x: 0.6, y: 0.32, z: 1.9 },
  graph: { x: 0.66, y: 0.2, z: 2.2 },
  focus: { x: 0.45, y: 0.26, z: 3.0 },
}
/** 비행 길이 D = 900 + 140·|log₂(zB/zA)| + 200·(거리 × max(zA, zB)), 900–1300ms */
export function flightMs(a: Cam, b: Cam): number {
  const d = 900 + 140 * Math.abs(Math.log2(b.z / a.z)) + 200 * Math.hypot(b.x - a.x, b.y - a.y) * Math.max(a.z, b.z)
  return Math.round(Math.min(1300, Math.max(900, d)))
}

function autoPhase(d = new Date()): Exclude<SkyPhase, 'auto'> {
  const h = d.getHours()
  if (h >= 6 && h < 18) return 'blue'
  if (h >= 18) return 'night'
  return 'dawn'
}

function cssColor(c: string | undefined): [number, number, number] | null {
  if (!c) return null
  const m = /^#([0-9a-f]{6})$/i.exec(c.trim())
  if (m) {
    const n = parseInt(m[1]!, 16)
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
  }
  if (typeof document !== 'undefined' && c.startsWith('var(')) {
    const name = c.slice(4, -1).split(',')[0]!.trim()
    return cssColor(getComputedStyle(document.documentElement).getPropertyValue(name).trim())
  }
  return null
}

function hashStr(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

interface StarRec {
  id: string
  layer: Layer
  x: number
  y: number
  L: number
  color: [number, number, number]
  /** 목표 밝기 0..1+ (데이터) */
  level: number
  /** 지금 진행 중인 밝기 보간 (sky.now() 초) */
  from: number
  to: number
  t0: number
  dur: number
  burst?: 'big' | 'small'
  burstT0: number
  subject?: string
}

interface LinkRec {
  key: string
  a: string
  b: string
  layer: 'today' | 'graph'
  el: SVGLineElement | null
  drawn: boolean
}

export class FieldEngine {
  private level: MotionLevel = 'rich'
  private theme: ThemeName = 'dark'
  private tierSetting: 'auto' | Tier = 'auto'
  private debug = false
  private osReduced = typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  private host: HTMLDivElement | null = null
  private canvas: HTMLCanvasElement | null = null
  private svg: SVGSVGElement | null = null
  private sky: Sky | null = null
  private hud: HTMLElement | null = null
  private cleanups: Array<() => void> = []
  private vw = 1
  private vh = 1

  private moods = new Map<number, MoodSpec>()
  private datas = new Map<number, FieldData>()
  private pauses = new Map<number, { reason: PauseReason; active: boolean }>()
  private nextId = 1
  private preset: MoodName = 'today'
  private phase: SkyPhase = 'auto'
  private phaseTimer = 0

  private stars = new Map<string, StarRec>()
  private links = new Map<string, LinkRec>()
  private deferred: Array<{ a: string; b: string; layer: 'today' | 'graph' }> = []
  private pushQueued = false
  private lens: string | null = null
  private selected: string | null = null
  private lastSignal = -1e9
  private lastGlint = new Map<string, number>()
  private sealLast = -1e9
  private paused = false
  private resumeTimer = 0
  private overlay = false
  /** 첫 진입: 하늘이 보이기 전에는 데이터 층(별·선)을 0으로 묶는다 (review #2) */
  private gate = true
  private lastFlightS = 0.45
  private travel: Travel = 'fly'
  private meteorsOn = true
  private camStack: CameraTarget[] = []
  private camCur: CameraTarget = { scene: 'today' }
  private lastCam = ''
  private linkG: SVGGElement | null = null

  /* 계측 */
  private perf = {
    longTasks: 0,
    longTasksInNav: 0,
    navs: [] as Array<{ at: number; bakes0: number; bakes: number; maxFrame: number; p95: number; longTasks: number; frames: number[]; commitMs?: number; flight: number[] }>,
    navUntil: 0,
    frames: [] as number[],
  }

  private prefs: MotionPrefs = { level: 'rich', reduced: false, tier: 'B', fps: 0 }
  private prefSubs = new Set<() => void>()
  private stamps: StampItem[] = []
  private stampSubs = new Set<() => void>()
  private captions: CaptionItem[] = []
  private captionSubs = new Set<() => void>()
  private entrance = { playing: false, done: false }
  private entranceSubs = new Set<() => void>()

  constructor() {
    this.prefs = { level: this.level, reduced: this.mode === 'off', tier: 'B', fps: 0 }
  }

  /* ---------- 상태 ---------- */

  get mode(): Mode {
    return this.osReduced || this.level === 'off' ? 'off' : this.level
  }

  subscribe = (f: () => void): (() => void) => {
    this.prefSubs.add(f)
    return () => this.prefSubs.delete(f)
  }
  getPrefs = (): MotionPrefs => this.prefs
  private emitPrefs() {
    const s = this.sky?.stats()
    const next: MotionPrefs = { level: this.level, reduced: this.mode === 'off', tier: s?.tier ?? 'B', fps: s?.fps ?? 0 }
    const p = this.prefs
    if (p.level === next.level && p.reduced === next.reduced && p.tier === next.tier && p.fps === next.fps) return
    this.prefs = next
    this.prefSubs.forEach((f) => f())
  }

  configure(o: { level: MotionLevel; theme: ThemeName; tier: 'auto' | Tier; debug: boolean; travel?: Travel; meteors?: boolean }): void {
    if (o.travel) this.travel = o.travel
    if (typeof o.meteors === 'boolean') this.meteorsOn = o.meteors
    const themeChanged = o.theme !== this.theme
    const tierChanged = o.tier !== this.tierSetting
    this.level = o.level
    this.theme = o.theme
    this.debug = o.debug
    this.tierSetting = o.tier
    const sky = this.sky
    if (sky) {
      sky.setReduced(this.mode === 'off')
      sky.setMeteors(this.mode === 'rich' && this.meteorsOn)
      if (tierChanged) sky.setTier(o.tier)
      if (themeChanged) sky.setPlate(o.theme === 'light', this.mode === 'off' ? 1 : 680)
    }
    this.emitPrefs()
  }

  /* ---------- DOM ---------- */

  attach(host: HTMLDivElement): void {
    if (this.host) this.detach()
    this.host = host
    host.classList.add('gx-sky-host')
    const canvas = document.createElement('canvas')
    canvas.setAttribute('aria-hidden', 'true')
    canvas.className = 'gx-sky-canvas'
    host.appendChild(canvas)
    this.canvas = canvas
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('class', 'gx-sky-links')
    svg.setAttribute('aria-hidden', 'true')
    host.appendChild(svg)
    this.svg = svg
    this.linkG = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    svg.appendChild(this.linkG)
    try {
      const sky = new Sky(canvas, { tier: this.tierSetting, reduced: this.mode === 'off', meteors: this.mode === 'rich' && this.meteorsOn })
      this.sky = sky
      sky.onStats = () => {
        this.emitPrefs()
        this.drawHud()
      }
      sky.onFrame = (dt) => this.onFrame(dt)
      sky.onFirstFrame = () => {
        host.classList.add('is-ready')
        // 하늘(노출 55%)이 먼저, 별과 선은 700ms부터 하나씩 (motion §4)
        if (this.mode === 'off') this.revealData(true)
        else window.setTimeout(() => this.revealData(false), 700)
      }
      if (this.theme === 'light') sky.setPlate(true, 1)
    } catch {
      this.sky = null
      host.classList.add('is-ready', 'is-css')
      this.gate = false
    }
    let lostTimer = 0
    const onLost = () => {
      window.clearTimeout(lostTimer)
      lostTimer = window.setTimeout(() => {
        // 복구되지 않으면 새 캔버스로 다시 붙인다 (데이터 별·장면은 그대로)
        const h = this.host
        if (!h) return
        this.detach()
        this.attach(h)
      }, 2000)
    }
    const onRestored = () => window.clearTimeout(lostTimer)
    canvas.addEventListener('webglcontextlost', onLost)
    canvas.addEventListener('webglcontextrestored', onRestored)
    this.cleanups.push(() => {
      window.clearTimeout(lostTimer)
      canvas.removeEventListener('webglcontextlost', onLost)
      canvas.removeEventListener('webglcontextrestored', onRestored)
    })
    this.resize()
    // 가까이 갈 장소(그래프·집중)는 유휴 시간에 고해상도 타일로 미리 굽는다
    const phone = deviceOf(this.vw, this.vh) === 'phone'
    this.sky?.setTiles(Object.keys(PLACES).map((k) => (phone ? PLACES_PHONE[k as MoodName] : undefined) ?? PLACES[k as MoodName]))
    this.applyMood(true)
    this.pushStars()
    for (const l of this.links.values()) if (!l.el) this.renderLink(l, false)

    const on = <K extends keyof WindowEventMap>(t: K, f: (e: WindowEventMap[K]) => void, opt?: AddEventListenerOptions) => {
      window.addEventListener(t, f, opt)
      this.cleanups.push(() => window.removeEventListener(t, f, opt))
    }
    let rz = 0
    on('resize', () => {
      cancelAnimationFrame(rz)
      rz = requestAnimationFrame(() => this.resize())
    })
    on(
      'pointermove',
      (e) => {
        if (this.mode !== 'rich' || this.paused) return
        if (e.pointerType === 'touch') return
        this.sky?.pointer(e.clientX, e.clientY, e.pointerType)
      },
      { passive: true },
    )
    on('pointerleave', () => this.sky?.pointerLeave())
    if (typeof PerformanceObserver !== 'undefined') {
      try {
        const po = new PerformanceObserver((list) => {
          const n = list.getEntries().length
          this.perf.longTasks += n
          if (performance.now() < this.perf.navUntil) {
            this.perf.longTasksInNav += n
            const last = this.perf.navs[this.perf.navs.length - 1]
            if (last) last.longTasks += n
          }
        })
        po.observe({ type: 'longtask', buffered: false })
        this.cleanups.push(() => po.disconnect())
      } catch {
        /* 지원 안 함 */
      }
    }
    this.phaseTimer = window.setInterval(() => {
      if (this.phase === 'auto' && this.preset === 'today') this.applyMood(false, 60000)
    }, 60000)
    this.cleanups.push(() => window.clearInterval(this.phaseTimer))
    const w = window as Window & { __gyeolPerf?: unknown }
    w.__gyeolPerf = this.perfApi
  }

  detach(): void {
    this.cleanups.forEach((f) => f())
    this.cleanups = []
    this.sky?.destroy()
    this.sky = null
    // 떼어 낸 캔버스의 WebGL 컨텍스트는 바로 돌려준다 — 핫 업데이트·재마운트가 쌓여 브라우저 컨텍스트 한도(16)에 걸리면
    // 가장 오래된(=지금 보이는) 하늘이 잃어져 검게 꺼진다
    try {
      ;(this.canvas?.getContext('webgl2')?.getExtension('WEBGL_lose_context') as { loseContext(): void } | null)?.loseContext()
    } catch {
      /* 무시 */
    }
    this.canvas?.remove()
    this.svg?.remove()
    this.canvas = null
    this.svg = null
    this.links.forEach((l) => (l.el = null))
    if (this.host) this.host.classList.remove('is-ready', 'is-css')
    this.host = null
  }

  setHud(el: HTMLElement | null): void {
    this.hud = el
    this.drawHud()
  }

  private drawHud() {
    if (!this.hud || !this.debug) return
    const s = this.sky?.stats()
    if (!s) {
      this.hud.textContent = 'CSS 하늘 (WebGL2 없음)'
      return
    }
    const last = this.perf.navs[this.perf.navs.length - 1]
    this.hud.textContent =
      `${s.fps} fps · ${s.tier} · ${s.megapixels.toFixed(1)}MP · ${s.hdr ? 'HDR' : 'RGBA8'} · 굽기 ${s.bakes}회 ${s.bakeMs.toFixed(0)}ms · js ${s.jsMs.toFixed(2)}ms` +
      (last ? ` · 전환 최장 ${last.maxFrame.toFixed(1)}ms 굽기 ${last.bakes}` : '')
  }

  private resize() {
    this.vw = window.innerWidth
    this.vh = window.innerHeight
    this.sky?.resize(this.vw, this.vh)
    this.svg?.setAttribute('viewBox', `0 0 ${this.vw} ${this.vh}`)
    this.layoutStars()
  }

  /* ---------- 분위기 (하늘 장면) ---------- */

  pushMood(spec: MoodSpec): number {
    const id = this.nextId++
    this.moods.set(id, spec)
    this.applyMood()
    return id
  }
  updateMood(id: number, spec: MoodSpec): void {
    if (!this.moods.has(id)) return
    this.moods.set(id, spec)
    this.applyMood()
  }
  removeMood(id: number): void {
    this.moods.delete(id)
    // 다음 화면의 FieldMood가 곧 들어온다 → 마지막 장면 유지
  }

  /** 전환을 누른 프레임에 목적지 장소로 미리 출발 (useFieldTransition) */
  previewScene(preset: MoodName): void {
    this.hint = preset
    this.hintUntil = performance.now() + 900
    this.navStart()
    this.applyMood(false, SKY_TIMING.navMs, preset)
  }

  holdFlight(on: boolean): void {
    this.sky?.holdFlight(on)
  }

  /** 계측: 라우트 커밋(앱 렌더) 시간 */
  noteCommit(ms: number): void {
    const n = this.perf.navs[this.perf.navs.length - 1]
    if (n) n.commitMs = Math.round(ms * 10) / 10
  }

  /** 계측: 전환 하나의 시작 */
  navStart(): void {
    this.navMark()
  }

  private pendingSubject: string | undefined
  private hint: MoodName | null = null
  private hintUntil = 0

  private applyMood(instant = false, durMs: number = SKY_TIMING.navMs, forced?: MoodName) {
    const spec = [...this.moods.values()].pop()
    if (!forced && this.hint && performance.now() < this.hintUntil && spec?.preset !== this.hint) return
    if (spec?.preset === this.hint) this.hint = null
    const preset = forced ?? spec?.preset ?? this.preset
    const changed = preset !== this.preset
    this.preset = preset
    const ph = this.phase === 'auto' ? autoPhase() : this.phase
    const { scene, look } = sceneFor(preset, ph)
    const dim = spec?.preset === preset ? spec?.override?.dim : undefined
    const l: LookOverride = { ...look }
    if (typeof dim === 'number' && l.bright !== undefined) l.bright = Math.max(0.5, Math.min(1, l.bright * dim))
    const ms = this.mode === 'off' ? 0 : this.mode === 'calm' ? Math.min(durMs, 600) : durMs
    this.sky?.setScene(scene, instant || ms === 0, l, ms)
    if (changed || instant) {
      this.camStack = []
      this.goCamera({ scene: preset }, instant)
      this.fadeLayers(instant)
      if (preset === 'graph') this.flushDeferred()
    }
  }

  /* ---------- 데이터 (legacy useFieldData → 데이터 별) ---------- */

  pushData(d: FieldData): number {
    const id = this.nextId++
    this.datas.set(id, d)
    this.applyData()
    return id
  }
  updateData(id: number, d: FieldData): void {
    if (!this.datas.has(id)) return
    this.datas.set(id, d)
    this.applyData()
  }
  removeData(id: number): void {
    this.datas.delete(id)
  }

  private applyData() {
    const d: FieldData = {}
    for (const v of this.datas.values()) Object.assign(d, v)
    // rings → 오늘의 별 (선으로 이어진 별자리, 사건 없이 최종 상태)
    if (typeof d.rings === 'number') {
      const n = Math.max(0, Math.min(16, Math.round(d.rings)))
      const today = [...this.stars.values()].filter((s) => s.layer === 'today' && s.id.startsWith('today:'))
      for (let i = 0; i < n; i++) if (!this.stars.has('today:' + i)) this.addStar('today:' + i, 'today', 'next', 'set', 1, false)
      for (const s of today) if (Number(s.id.slice(6)) >= n) this.removeStar(s.id)
      for (let i = 1; i < n; i++) this.ensureLink('today:' + (i - 1), 'today:' + i, 'today', false)
    }
    // pressure → 시험 별 (D-14 20% → D-0 100%)
    if (typeof d.pressure === 'number') {
      if (d.pressure > 0.001) this.setExam('exam:legacy', Math.round(14 * (1 - Math.min(1, d.pressure))), false)
      else this.removeStar('exam:legacy')
    }
    // load → 복습 별 밀도
    if (typeof d.load === 'number') {
      const n = Math.round(Math.min(1, Math.max(0, d.load)) * 13)
      for (let i = 0; i < 13; i++) {
        const id = 'review:legacy' + i
        if (i < n && !this.stars.has(id)) this.addStar(id, 'review', null, 'card', 0.3, false)
        else if (i >= n && this.stars.has(id)) this.removeStar(id)
      }
    }
    this.sky?.setTint(cssColor(d.tint))
    this.pushStars()
  }

  /* ---------- 데이터 별 등록부 ---------- */

  private layerVis(layer: Layer): number {
    return LAYERS[this.preset][layer] ?? 0
  }

  private nowS(): number {
    return this.sky?.now() ?? performance.now() / 1000
  }

  private curLevel(s: StarRec, t = this.nowS()): number {
    const k = Math.min(1, Math.max(0, (t - s.t0) / Math.max(s.dur, 0.001)))
    const e = k * k * (3 - 2 * k)
    return s.from + (s.to - s.from) * e
  }

  /** 밝기 보간 시작 (시작 시각 delay초 뒤) */
  private animTo(s: StarRec, to: number, dur: number, delay = 0) {
    const t = this.nowS()
    s.from = this.curLevel(s, t)
    s.to = to
    s.t0 = t + delay
    s.dur = this.mode === 'off' ? 0.001 : dur
    if (this.mode === 'off') s.from = to
  }

  /** 첫 진입 안무: 별 V3 400ms, 선 V2, 간격 min(160, 800 ÷ n) */
  private revealData(instant: boolean) {
    if (!this.gate) return
    this.gate = false
    const list = [...this.stars.values()].filter((s) => this.visTarget(s) > 0.001)
    const gap = Math.min(0.16, 0.8 / Math.max(1, list.length))
    list.forEach((s, i) => {
      s.from = 0
      s.to = this.visTarget(s)
      s.t0 = this.nowS() + (instant ? 0 : i * gap)
      s.dur = instant ? 0.001 : 0.4
    })
    this.pushStars()
    const order = new Map(list.map((s, i) => [s.id, i]))
    for (const l of this.links.values()) {
      const i = Math.max(order.get(l.a) ?? 0, order.get(l.b) ?? 0)
      if (instant) this.renderLink(l, false)
      else window.setTimeout(() => this.renderLink(l, true), (i * gap + 0.2) * 1000)
    }
  }

  private visTarget(s: StarRec): number {
    if (this.gate) return 0
    let v = s.level * this.layerVis(s.layer)
    if (this.lens && s.subject && s.subject !== this.lens && (s.layer === 'graph' || s.layer === 'review')) v *= 0.25
    if (this.selected === s.id) v *= 1.3
    return v
  }

  private fadeLayers(instant: boolean) {
    const out = SKY_TIMING.dataOutMs / 1000
    // 들어오는 데이터 층은 비행의 0.6D → D (review #6)
    const inDelay = Math.max(out, 0.6 * this.lastFlightS)
    const inDur = Math.max(0.2, 0.4 * this.lastFlightS)
    for (const s of this.stars.values()) {
      const target = this.visTarget(s)
      const cur = this.curLevel(s)
      if (Math.abs(target - cur) < 0.01 && Math.abs(target - s.to) < 0.01) continue
      if (instant) this.animTo(s, target, 0.001)
      else if (target < cur) this.animTo(s, target, out)
      else this.animTo(s, target, inDur, inDelay)
    }
    this.updateLinkVis(instant)
    this.pushStars()
  }

  private posFor(layer: Layer, at: At | null, id: string): [number, number] {
    if (at && at !== 'next') {
      if (typeof Element !== 'undefined' && at instanceof Element) {
        const r = at.getBoundingClientRect()
        return this.toSky(r.left + r.width / 2, r.top + r.height / 2)
      }
      const p = at as { x: number; y: number }
      // 화면 px → 하늘 좌표 (카메라를 따라 움직이는 별)
      if (Number.isFinite(p?.x) && Number.isFinite(p?.y)) return this.toSky(p.x, p.y)
    }
    const w = this.vw
    const h = this.vh
    if (layer === 'today' || layer === 'focus') {
      // 씨앗 별(밝기 < 0.5)은 세지 않는다 → 씨앗과 그 별이 태어날 자리, 집중 카메라의 좌석이 같은 자리
      const n = [...this.stars.values()].filter((s) => s.layer === 'today' && s.level >= 0.5).length
      const pts = todayStarPositions(n + 1, w, h)
      return pts[n] ?? [0.6, 0.2]
    }
    if (layer === 'exam') {
      const e = examStar(w, h, 6)
      return [e.x, e.y]
    }
    if (layer === 'review') {
      const phone = deviceOf(w, h) === 'phone'
      // 복습 장소에서 화면 (0.77, 0.12) → (0.56, 0.73) 사선 = 세계 (0.80, 0.30) → (0.69, 0.62) (camera §1)
      const a: [number, number] = phone ? [0.742, 0.12] : [0.802, 0.3]
      const b: [number, number] = phone ? [0.632, 0.441] : [0.692, 0.621]
      const n = [...this.stars.values()].filter((s) => s.layer === 'review').length
      const r = mulberry32(hashStr(id))
      const f = ((n % 20) + 0.5) / 20 + (r() - 0.5) * 0.02
      return [a[0] + (b[0] - a[0]) * f + ((r() - 0.5) * 10) / w, a[1] + (b[1] - a[1]) * f]
    }
    // 노트 별: 세계 (0.49–0.92, 0.15–0.57)의 과목 무리 둘레 (id로 고정). 그래프 글자 구역(x < 0.66 · y > 0.41)은 비운다
    const CL: Array<[number, number]> = [[0.57, 0.23], [0.72, 0.2], [0.86, 0.27], [0.8, 0.43], [0.68, 0.33], [0.87, 0.52]]
    const rec = this.stars.get(id)
    const c = CL[hashStr(rec?.subject ?? this.pendingSubject ?? id.slice(0, 2)) % CL.length]!
    const r = mulberry32(hashStr(id))
    const ang = r() * Math.PI * 2
    const rad = 0.012 + 0.045 * Math.sqrt(r())
    let x = Math.min(0.92, Math.max(0.49, c[0] + Math.cos(ang) * rad * 1.2))
    const y = Math.min(0.53, Math.max(0.18, c[1] + Math.sin(ang) * rad)) // 상단 바 64px·독 위로 (review #6)
    if (x < 0.66 && y > 0.41) x = 0.67 + r() * 0.02
    return [x, y]
  }

  private addStar(id: string, layer: Layer, at: At | null, kind: StarKind, level: number, animate: boolean, subject?: string, color?: [number, number, number]) {
    if (subject) this.pendingSubject = subject
    let [x, y] = this.posFor(layer, at, id)
    this.pendingSubject = undefined
    if (!Number.isFinite(x) || !Number.isFinite(y)) [x, y] = this.posFor(layer, null, id)
    if (!Number.isFinite(x) || !Number.isFinite(y)) [x, y] = [0.5, 0.4]
    if (!Number.isFinite(level)) level = 1
    const L = kind === 'set' ? 190 : kind === 'exam' ? 220 : kind === 'card' ? 110 : kind === 'note' ? 70 : 60
    const col = color ?? (kind === 'exam' ? SEAL : kind === 'card' || kind === 'note' ? subjectColor(subject) : GOLD)
    const rec: StarRec = { id, layer, x, y, L, color: col, level, from: 0, to: 0, t0: -100, dur: 0.001, burstT0: -100, subject }
    this.stars.set(id, rec)
    const target = this.visTarget(rec)
    if (animate && this.mode !== 'off') {
      rec.burst = kind === 'set' && this.mode === 'rich' ? 'big' : 'small'
      rec.from = 0
      rec.to = target
      rec.t0 = this.nowS()
      rec.dur = kind === 'set' ? 1.2 : 0.8
      rec.burstT0 = rec.t0
    } else {
      rec.from = rec.to = target
    }
    return rec
  }

  private removeStar(id: string) {
    if (!this.stars.delete(id)) return
    for (const [k, l] of this.links) if (l.a === id || l.b === id) {
      l.el?.remove()
      this.links.delete(k)
    }
  }

  private setExam(id: string, dday: number, animate: boolean) {
    if (!Number.isFinite(dday)) dday = 6
    const k = Math.max(0.2, Math.min(1, 1 - (dday / 14) * 0.8))
    let s = this.stars.get(id)
    if (!s) s = this.addStar(id, 'exam', null, 'exam', k, animate)
    if (Math.abs(s.level - k) > 0.001) {
      s.level = k
      this.animTo(s, this.visTarget(s), 2.0) // V9 다가옴
    }
  }

  private layoutStars() {
    // 화면 크기가 바뀌면 자동 배치 별은 다시 자리 잡는다(오늘의 별·시험 별)
    const today = [...this.stars.values()].filter((s) => s.layer === 'today' && s.id.startsWith('today:'))
    if (today.length) {
      const pts = todayStarPositions(today.length, this.vw, this.vh)
      today.forEach((s, i) => {
        const p = pts[i]
        if (p) [s.x, s.y] = p
      })
    }
    for (const s of this.stars.values()) if (s.layer === 'exam') [s.x, s.y] = this.posFor('exam', null, s.id)
    this.updateLinkPos()
    this.pushStars()
  }

  /** 데이터 별을 하늘에 올린다 (한 프레임에 한 번으로 모은다) */
  private pushStars() {
    if (this.pushQueued) return
    this.pushQueued = true
    queueMicrotask(() => {
      this.pushQueued = false
      if (!this.sky) return
      const list: SpecialStar[] = []
      for (const s of this.stars.values()) {
        if (s.to <= 0.001 && this.curLevel(s) <= 0.001) continue
        const sel = this.selected === s.id
        list.push({ x: s.x, y: s.y, L: sel ? Math.max(s.L * 1.6, 220) : s.L, color: sel ? GOLD : s.color, mode: 'anim', from: s.from, to: s.to, t0: s.t0, dur: s.dur, burst: s.burst })
        if (s.burst && this.nowS() - s.burstT0 > 1.6) s.burst = undefined
      }
      this.sky.setSpecial(list, false)
    })
  }

  /* ---------- 별자리 선 (V2 그어짐) ---------- */

  private ensureLink(a: string, b: string, layer: 'today' | 'graph', animate: boolean) {
    const key = a < b ? a + '|' + b : b + '|' + a
    if (this.links.has(key)) return
    const rec: LinkRec = { key, a, b, layer, el: null, drawn: !animate }
    this.links.set(key, rec)
    this.renderLink(rec, animate)
  }

  private renderLink(l: LinkRec, animate: boolean) {
    if (!this.svg) return
    const A = this.stars.get(l.a)
    const B = this.stars.get(l.b)
    if (!A || !B) return
    let el = l.el
    if (!el) {
      el = document.createElementNS('http://www.w3.org/2000/svg', 'line')
      el.setAttribute('class', 'gx-link')
      ;(this.linkG ?? this.svg).appendChild(el)
      l.el = el
    }
    const x1 = A.x * this.vw
    const y1 = A.y * this.vh
    const x2 = B.x * this.vw
    const y2 = B.y * this.vh
    if (![x1, y1, x2, y2].every(Number.isFinite)) return
    el.setAttribute('x1', String(x1))
    el.setAttribute('y1', String(y1))
    el.setAttribute('x2', String(x2))
    el.setAttribute('y2', String(y2))
    el.style.opacity = String(this.linkOpacity(l))
    if (animate && this.mode === 'rich') {
      const len = Math.hypot(x2 - x1, y2 - y1)
      el.style.strokeDasharray = `${len} ${len}`
      el.style.strokeDashoffset = String(len)
      el.style.transition = 'none'
      void el.getBoundingClientRect()
      const ms = Math.min(900, Math.max(600, len * 6))
      el.style.transition = `stroke-dashoffset ${ms}ms cubic-bezier(.4,0,.2,1), opacity 225ms cubic-bezier(.4,0,.2,1)`
      el.style.strokeDashoffset = '0'
    } else if (animate) {
      el.style.transition = 'opacity 300ms linear'
      el.style.strokeDasharray = ''
    }
    l.drawn = true
  }

  /** 선 불투명도: 오늘 0.4 · 그래프 0.28(고른 별의 선 0.6, 나머지 0.16) · 글자 구역 안 ×0.2 · 진입 전 0 */
  private linkOpacity(l: LinkRec): number {
    if (this.gate) return 0
    const vis = (l.layer === 'today' ? this.layerVis('today') : this.layerVis('graph')) > 0 ? 1 : 0
    if (!vis) return 0
    let o = l.layer === 'today' ? 0.4 : 0.28
    if (l.layer === 'graph' && this.selected) o = l.a === this.selected || l.b === this.selected ? 0.6 : 0.16
    const A = this.stars.get(l.a)
    const B = this.stars.get(l.b)
    if (A && B && this.inTextZone((A.x + B.x) / 2, (A.y + B.y) / 2)) o *= 0.2
    return o
  }

  /** 하늘 좌표가 지금 화면의 글자 구역(장면 안전 구역)·상단 64px·독 구역 안인가 */
  private inTextZone(wx: number, wy: number): boolean {
    if (!this.sky) return false
    const [sx, sy] = this.toScreenPx(wx, wy)
    if (sy < 64 || sy > this.vh - 76) return true
    const ph = this.phase === 'auto' ? autoPhase() : this.phase
    const c = pickComposition(sceneFor(this.preset, ph).scene, this.vw, this.vh)
    return c.safe.some((r) => sx > (r[0] / c.ref[0]) * this.vw && sx < (r[2] / c.ref[0]) * this.vw && sy > (r[1] / c.ref[1]) * this.vh && sy < (r[3] / c.ref[1]) * this.vh)
  }

  private updateLinkPos() {
    for (const l of this.links.values()) if (l.el) this.renderLink(l, false)
  }

  private updateLinkVis(instant: boolean) {
    for (const l of this.links.values()) {
      if (!l.el) continue
      const o = this.linkOpacity(l)
      const cur = Number(l.el.style.opacity || 0)
      const delay = o > cur ? Math.round(Math.max(SKY_TIMING.dataOutMs, 600 * this.lastFlightS)) : 0
      l.el.style.transition = instant ? 'none' : `opacity ${o > cur ? Math.round(Math.max(200, 400 * this.lastFlightS)) : SKY_TIMING.dataOutMs}ms cubic-bezier(.4,0,.2,1) ${delay}ms`
      l.el.style.opacity = String(o)
    }
  }

  private flushDeferred() {
    const q = this.deferred.splice(0)
    q.forEach((it, i) => {
      if (i < 3) window.setTimeout(() => this.ensureLink(it.a, it.b, it.layer, true), 150 * i)
      else this.ensureLink(it.a, it.b, it.layer, false)
    })
  }

  /* ---------- 사건 API (design-v3-motion §5-2) ---------- */

  birthStar(o: { id: string; at?: At; kind: StarKind; subject?: string; level?: number }): void {
    const layer: Layer = o.kind === 'card' ? 'review' : o.kind === 'note' ? 'graph' : o.kind === 'exam' ? 'exam' : 'today'
    const ex = this.stars.get(o.id)
    if (ex) {
      // 멱등: 최종 상태만 맞춘다 (집중 중 자란 씨앗 별이면 여기서 좌석에서 크게 피어남 — review #5)
      const wasSeed = ex.layer === 'focus' || ex.level < 0.5
      ex.level = o.level ?? 1
      if (wasSeed && o.kind === 'set') {
        ex.L = 190
        ex.color = GOLD
      }
      if (ex.layer === 'focus' || (wasSeed && o.kind === 'set')) {
        ex.layer = layer
        ex.burst = this.mode === 'rich' && o.kind === 'set' ? 'big' : 'small'
        ex.burstT0 = this.nowS()
        this.animTo(ex, this.visTarget(ex), o.kind === 'set' ? 1.2 : 0.8)
      } else this.animTo(ex, this.visTarget(ex), 0.6)
      this.pushStars()
      return
    }
    // 작은 별을 낮은 밝기로 부르면 '씨앗 별' (좌석에 1px 10–12%로 보인다)
    const seed = o.kind === 'small' && (o.level ?? 1) < 0.3
    const rec = this.addStar(o.id, layer, o.at ?? 'next', o.kind, seed ? Math.max(0.12, o.level ?? 0.12) : (o.level ?? 1), true, o.subject, seed ? GOLD : undefined)
    if (seed) rec.L = 190
    this.pushStars()
  }

  growStar(id: string, progress: number): void {
    let s = this.stars.get(id)
    if (!s) s = this.addStar(id, 'focus', 'next', 'set', 0.1, false)
    const lv = 0.12 + 0.48 * Math.min(1, Math.max(0, progress)) // 씨앗 12% → 진행률만큼
    if (Math.abs(lv - s.level) < 0.004) return
    s.level = lv
    this.animTo(s, this.visTarget(s), 1.0)
    this.pushStars()
  }

  fadeStar(id: string, o?: { to?: number; ms?: number }): void {
    const s = this.stars.get(id)
    if (!s) return
    s.level = o?.to ?? 0
    this.animTo(s, this.visTarget(s), (o?.ms ?? 600) / 1000)
    this.pushStars()
  }

  relight(ids: string | string[], level: number, o?: { glint?: boolean }): void {
    for (const id of Array.isArray(ids) ? ids : [ids]) {
      let s = this.stars.get(id)
      if (!s) s = this.addStar(id, 'review', null, 'card', 0.3, false)
      const up = level > s.level + 0.05
      s.level = level
      this.animTo(s, this.visTarget(s), 0.8)
      if (up && this.mode !== 'off') {
        s.burst = 'small' // 할로 6px로 다시 켜짐이 보이게 (review #4)
        s.burstT0 = this.nowS()
      }
      if (o?.glint) {
        const [sx, sy] = this.toScreenPx(s.x, s.y)
        this.glint({ x: sx, y: sy })
      }
    }
    this.pushStars()
  }

  drawLink(fromId: string, toId: string, o?: { layer?: 'today' | 'graph'; deferIfPaused?: boolean }): void {
    const layer = o?.layer ?? 'graph'
    if ((o?.deferIfPaused ?? true) && this.paused) {
      this.deferred.push({ a: fromId, b: toId, layer })
      return
    }
    // 세트 완료 직후라면 피어남 뒤(+900ms)에 긋는다
    const b = this.stars.get(toId)
    const delay = b && b.burst && this.nowS() - b.burstT0 < 0.9 ? (0.9 - (this.nowS() - b.burstT0)) * 1000 : 0
    if (delay > 0) window.setTimeout(() => this.ensureLink(fromId, toId, layer, true), delay)
    else this.ensureLink(fromId, toId, layer, true)
  }

  meteor(o?: { kind?: 'signal' | 'ambient'; size?: 'sm' | 'md' }): void {
    // 유성 끔: 띠가 잠깐 밝아지는 것(V13 +4%)으로 대체
    if (!this.meteorsOn && (o?.kind ?? 'signal') === 'signal') {
      this.swellBand({ amount: 0.04, ms: 1200 })
      return
    }
    if (this.mode !== 'rich') return
    const now = performance.now()
    if ((o?.kind ?? 'signal') === 'signal') {
      if (now - this.lastSignal < 20000) return
      this.lastSignal = now
    }
    this.sky?.meteorNow({ size: o?.size })
  }

  glint(near?: Element | { x: number; y: number }): void {
    if (this.mode === 'off' || !this.sky) return
    let p = { x: this.vw * 0.5, y: this.vh * 0.4 }
    if (near) {
      if (typeof Element !== 'undefined' && near instanceof Element) {
        const r = near.getBoundingClientRect()
        p = { x: r.left + r.width / 2, y: r.top + r.height / 2 }
      } else p = near as { x: number; y: number }
    }
    const key = Math.round(p.x / 40) + ':' + Math.round(p.y / 40)
    const now = performance.now()
    if (now - (this.lastGlint.get(key) ?? -1e9) < 5000) return
    this.lastGlint.set(key, now)
    this.sky.tap(p.x, p.y, 0.67)
  }

  swellBand(o?: { amount?: number; ms?: number }): void {
    if (this.mode === 'off') return
    this.sky?.swellBand(this.mode === 'calm' ? Math.min(0.04, o?.amount ?? 0.08) : (o?.amount ?? 0.08), o?.ms ?? 2000)
  }

  /** V7 별가루 모임: 반경 300px 안 별가루 30%가 4초에 걸쳐 그 자리 쪽으로 낙하 방향을 튼다(≤ 25°, 속도 그대로). null이면 4초에 걸쳐 풀린다 */
  gatherDust(target: Element | { x: number; y: number } | 'next' | null): void {
    if (!this.sky) return
    if (!target || this.mode !== 'rich') {
      this.sky.setGather(null)
      return
    }
    let p: { x: number; y: number }
    if (target === 'next') {
      const [wx, wy] = this.posFor('today', 'next', 'gather')
      const [sx, sy] = this.toScreenPx(wx, wy)
      p = { x: sx, y: sy }
    } else if (typeof Element !== 'undefined' && target instanceof Element) {
      const r = target.getBoundingClientRect()
      p = { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    } else p = target as { x: number; y: number }
    this.sky.setGather(p)
  }

  select(id: string | null): void {
    this.selected = id
    for (const s of this.stars.values()) if (s.layer === 'graph') this.animTo(s, this.visTarget(s), 0.3)
    const sel = id ? this.stars.get(id) : null
    if (sel && this.mode !== 'off') {
      sel.burst = 'small' // 금 3.2px + 할로 6px (review #14)
      sel.burstT0 = this.nowS()
    }
    this.updateLinkVis(false)
    this.pushStars()
  }

  setPhase(p: SkyPhase): void {
    if (p === this.phase) return
    this.phase = p
    this.applyMood(false, 60000)
  }

  setLens(subjectId: string | null, color?: string): void {
    this.lens = subjectId
    this.sky?.setTint(cssColor(color))
    for (const s of this.stars.values()) this.animTo(s, this.visTarget(s), 0.6)
    this.pushStars()
  }

  syncStars(spec: {
    today?: Array<{ id: string; at?: number; kind: StarKind }>
    exam?: { id: string; dday: number } | null
    review?: Array<{ id: string; subject: string; level: number }>
    graph?: { nodes: Array<{ id: string; subject: string; links: number }>; links: Array<[string, string]> }
  }): void {
    if (spec.today) {
      const keep = new Set(spec.today.map((t) => t.id))
      for (const s of [...this.stars.values()]) if (s.layer === 'today' && !s.id.startsWith('today:') && !keep.has(s.id)) this.removeStar(s.id)
      spec.today.forEach((t, i) => {
        if (!this.stars.has(t.id)) this.addStar(t.id, 'today', 'next', t.kind, 1, false)
        if (i > 0) this.ensureLink(spec.today![i - 1]!.id, t.id, 'today', false)
      })
    }
    if (spec.exam !== undefined) {
      for (const s of [...this.stars.values()]) if (s.layer === 'exam' && s.id !== spec.exam?.id) this.removeStar(s.id)
      if (spec.exam) this.setExam(spec.exam.id, spec.exam.dday, false)
    }
    if (spec.review) {
      const keep = new Set(spec.review.map((r) => r.id))
      for (const s of [...this.stars.values()]) if (s.layer === 'review' && !keep.has(s.id)) this.removeStar(s.id)
      for (const r of spec.review) {
        let s = this.stars.get(r.id)
        if (!s) s = this.addStar(r.id, 'review', null, 'card', r.level, false, r.subject)
        else if (Math.abs(s.level - r.level) > 0.001) {
          s.level = r.level
          s.from = s.to = this.visTarget(s)
        }
      }
    }
    if (spec.graph) {
      const keep = new Set(spec.graph.nodes.map((n) => n.id))
      for (const s of [...this.stars.values()]) if (s.layer === 'graph' && !keep.has(s.id)) this.removeStar(s.id)
      for (const n of spec.graph.nodes)
        if (!this.stars.has(n.id)) {
          const r = this.addStar(n.id, 'graph', null, 'note', 1, false, n.subject)
          r.L = 60 + Math.min(140, n.links * 24) // 노드 1.2–3.2px가 주인공
        }
      for (const [a, b] of spec.graph.links) this.ensureLink(a, b, 'graph', false)
    }
    this.pushStars()
  }

  /* ---------- 손길 ---------- */

  ripple(x: number, y: number, o?: RippleOptions): void {
    if (this.mode === 'off') return
    this.sky?.tap(x, y, Math.min(1, (o?.strength ?? 1) * (this.mode === 'calm' ? 0.5 : 1)))
  }

  /** 결 와이프는 폐지 (v3) */
  wipe(_dir: 1 | -1): void {
    void _dir
  }

  /** useSeal → 그 자리 별 탄생 (도장 없음) */
  seal(x: number, y: number): boolean {
    const now = performance.now()
    if (now - this.sealLast < 1200) return false
    this.sealLast = now
    this.birthStar({ id: 'seal:' + Math.round(now), at: { x, y }, kind: 'set' })
    return true
  }
  resetSealCooldown(): void {
    this.sealLast = -1e9
  }
  sealCooldownLeft(): number {
    return Math.max(0, 1200 - (performance.now() - this.sealLast))
  }

  /* ---------- 정지 · 감광 ---------- */

  pauseId(): number {
    return this.nextId++
  }
  setPause(id: number, reason: PauseReason, active: boolean): void {
    this.pauses.set(id, { reason, active })
    this.applyPause()
  }
  removePause(id: number): void {
    this.pauses.delete(id)
    this.applyPause()
  }

  private applyPause() {
    const vals = [...this.pauses.values()].filter((p) => p.active)
    const ink = vals.some((p) => p.reason === 'ink' || p.reason === 'typing')
    const ov = vals.some((p) => p.reason === 'overlay')
    if (ov !== this.overlay) {
      this.overlay = ov
      this.sky?.setGain(ov ? 0.6 : 1, ov ? SKY_TIMING.overlayMs : 260)
    }
    window.clearTimeout(this.resumeTimer)
    if (ink && !this.paused) {
      this.paused = true
      if (!ov) this.sky?.setGain(0.85, 300)
      this.sky?.setPaused?.(true)
    } else if (!ink && this.paused) {
      this.resumeTimer = window.setTimeout(() => {
        this.paused = false
        if (!this.overlay) this.sky?.setGain(1, 300)
        this.sky?.setPaused?.(false)
        if (this.deferred.length) this.flushDeferred()
      }, 1500)
    }
  }

  /* ---------- 화면 전환 (useFieldTransition) ---------- */

  holdTransition(on: boolean): void {
    this.sky?.holdTransition(on)
    if (!on) this.navMark()
  }

  private navMark() {
    const now = performance.now()
    this.perf.navUntil = now + SKY_TIMING.navMs + 150
    const bakes0 = this.sky?.stats().bakes ?? 0
    this.perf.navs.push({ at: now, bakes0, bakes: 0, maxFrame: 0, p95: 0, longTasks: 0, frames: [], flight: [] })
    if (this.perf.navs.length > 30) this.perf.navs.shift()
  }

  private syncLinkCam() {
    if (!this.sky || !this.linkG) return
    const c = this.sky.camera()
    const key = c.x.toFixed(5) + c.y.toFixed(5) + c.z.toFixed(5)
    if (key === this.lastCam) return
    this.lastCam = key
    if (!c.flying) queueMicrotask(() => this.updateLinkVis(false))
    const tx = this.vw * (0.5 - c.x * c.z)
    const ty = this.vh * (0.5 - c.y * c.z)
    this.linkG.setAttribute('transform', `translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${c.z.toFixed(5)})`)
  }

  private onFrame(dt: number) {
    this.syncLinkCam()
    if (performance.now() < this.perf.navUntil && dt > 0) {
      const n = this.perf.navs[this.perf.navs.length - 1]
      if (n) {
        n.frames.push(dt)
        if (this.sky?.camera().flying) n.flight.push(dt)
        n.maxFrame = Math.max(n.maxFrame, dt)
        const s = [...n.frames].sort((a, b) => a - b)
        n.p95 = s[Math.floor(0.95 * (s.length - 1))] ?? 0
        n.bakes = (this.sky?.stats().bakes ?? 0) - n.bakes0
      }
    }
  }

  /* ---------- 진입 안무 (SkyEntrance) ---------- */

  playEntrance(): void {
    if (this.entrance.done || !this.sky) return
    this.entrance = { playing: this.mode !== 'off', done: true }
    if (this.mode === 'off') return
    const ms = this.mode === 'calm' ? 600 : 900
    // 노출 55 → 100% (out). 굽기가 늦으면 별·노출만으로 진행하고, 층은 준비되는 프레임부터 300ms 크로스페이드
    this.sky.setGain(0.55, 1)
    // 첫 진입 내려앉기: 그 장소의 zoom × 0.84에서 1300ms (design-v3-camera §4)
    const place = this.placeOf({ scene: this.preset })
    if (this.travelMode() === 'fly') {
      this.sky.flyTo({ ...place, z: place.z * 0.84, x: place.x + 0.03, y: place.y - 0.03 }, 0)
      requestAnimationFrame(() => this.sky?.flyTo(place, 1300))
    }
    requestAnimationFrame(() => this.sky?.setGain(1, ms))
    this.emitEntrance()
    window.setTimeout(() => {
      this.entrance.playing = false
      this.emitEntrance()
    }, ms + 200)
  }
  skipEntrance(): void {
    this.sky?.setGain(1, 1)
    this.entrance.playing = false
    this.emitEntrance()
  }
  subscribeEntrance = (f: () => void): (() => void) => {
    this.entranceSubs.add(f)
    return () => this.entranceSubs.delete(f)
  }
  getEntrance = () => this.entrance
  private emitEntrance() {
    this.entrance = { ...this.entrance }
    this.entranceSubs.forEach((f) => f())
  }

  /* ---------- 캡션 · 도장 ---------- */

  showCaption(text: string, x: number, y: number, ms = 3000): void {
    const id = this.nextId++
    this.captions = [...this.captions.filter((c) => c.until > performance.now()), { id, x, y, text, until: performance.now() + ms }]
    this.captionSubs.forEach((f) => f())
    window.setTimeout(() => {
      this.captions = this.captions.filter((c) => c.id !== id)
      this.captionSubs.forEach((f) => f())
    }, ms + 260)
  }
  subscribeCaptions = (f: () => void): (() => void) => {
    this.captionSubs.add(f)
    return () => this.captionSubs.delete(f)
  }
  getCaptions = (): CaptionItem[] => this.captions

  /** v3: 도장 폐지 — 호출은 받되 띄우지 않는다 */
  showStamp(_s: Omit<StampItem, 'id'>): void {
    void _s
  }
  subscribeStamps = (f: () => void): (() => void) => {
    this.stampSubs.add(f)
    return () => this.stampSubs.delete(f)
  }
  getStamps = (): StampItem[] => this.stamps
  removeStamp(id: number): void {
    this.stamps = this.stamps.filter((s) => s.id !== id)
    this.stampSubs.forEach((f) => f())
  }

  /* ---------- 옹이 (폐지, 시그니처 유지) ---------- */

  pushPin(_p: PinSpec): number {
    void _p
    return this.nextId++
  }
  updatePin(_id: number, _p: PinSpec): void {
    void _id
    void _p
  }
  removePin(_id: number): void {
    void _id
  }

  /* ---------- 카메라 (useSkyCamera) ---------- */

  private placeOf(t: CameraTarget): Cam {
    const phone = deviceOf(this.vw, this.vh) === 'phone'
    const base = (phone ? PLACES_PHONE[t.scene] : undefined) ?? PLACES[t.scene]
    const z = t.zoom ?? base.z
    // 집중: 다음 별 자리가 별 좌석에 오도록 (review #1·#5)
    if (!t.focus && t.scene === 'focus') t = { ...t, focus: this.posFor('today', 'next', 'focus-seat') }
    if (!t.focus) return { ...base, z }
    // 대상이 '별 좌석'(화면 0.64, 0.42 · 폰 0.62, 0.30)에 앉도록 가운데를 옮긴다
    const seat = phone ? [0.62, 0.3] : [0.64, 0.42]
    return { x: t.focus[0] - (seat[0]! - 0.5) / z, y: t.focus[1] - (seat[1]! - 0.5) / z, z }
  }

  /** 이동 방식: 비행 / 짧게(30%만 + 크로스페이드) / 끔. 동작 줄이기·끔이면 끔 */
  private travelMode(): Travel {
    if (this.mode === 'off') return 'off'
    return this.travel
  }

  /** 비행이 정해질 때마다 (비행 길이 ms, 글자 들어오는 시각 ms) — useFieldTransition이 앱에 넘긴다 */
  onFlight: ((flightMs: number, contentInMs: number) => void) | null = null

  private goCamera(t: CameraTarget, instant = false, dur?: number): number {
    this.camCur = t
    if (!this.sky) return 0
    const mode = this.travelMode()
    const now = this.sky.camera()
    let to = this.placeOf(t)
    if (mode === 'off') to = { x: 0.5, y: 0.5, z: 1 }
    else if (mode === 'short') {
      const h = { x: 0.5, y: 0.5, z: 1 }
      to = { x: h.x + (to.x - h.x) * 0.3, y: h.y + (to.y - h.y) * 0.3, z: Math.exp(Math.log(to.z) * 0.3) }
    }
    const ms = instant || mode === 'off' ? 0 : mode === 'short' ? SKY_TIMING.navMs : (dur ?? flightMs(now, to))
    this.sky.flyTo(to, ms)
    // 앱이 글자 박자를 비행에 맞추도록: 글자는 D − 320ms에 들어온다 (짧게·끔이면 170ms) — review #7
    this.lastFlightS = Math.max(SKY_TIMING.navMs, ms) / 1000
    this.camCur = { ...t, durationMs: ms }
    const inMs = mode === 'fly' && ms > 0 ? Math.max(170, ms - 320) : 170
    const root = document.documentElement.style
    root.setProperty('--sky-flight-ms', (mode === 'fly' && ms > 0 ? ms : 170) + 'ms')
    root.setProperty('--sky-content-in-ms', inMs + 'ms')
    this.onFlight?.(ms, inMs)
    if (ms > 0) this.perf.navUntil = Math.max(this.perf.navUntil, performance.now() + ms + 150)
    return ms
  }

  flyTo(t: CameraTarget, o?: { duration?: number }): Promise<void> {
    this.camStack.push(this.camCur)
    if (this.camStack.length > 8) this.camStack.shift()
    const ms = this.goCamera(t, false, o?.duration)
    return new Promise((res) => window.setTimeout(res, ms))
  }

  back(o?: { duration?: number }): Promise<void> {
    const prev = this.camStack.pop() ?? { scene: this.preset }
    const ms = this.goCamera(prev, false, o?.duration)
    return new Promise((res) => window.setTimeout(res, ms))
  }

  currentCamera(): CameraTarget {
    return this.camCur
  }

  /** 화면 px ↔ 하늘 좌표(집 화면 비율) */
  toSky(x: number, y: number): [number, number] {
    if (!this.sky) return [x / this.vw, y / this.vh]
    return this.sky.toWorld(x / this.vw, y / this.vh)
  }
  toScreenPx(wx: number, wy: number): [number, number] {
    if (!this.sky) return [wx * this.vw, wy * this.vh]
    const [sx, sy] = this.sky.toScreen(wx, wy)
    return [sx * this.vw, sy * this.vh]
  }

  /** 누른 자리(화면 px)에서 가장 가까운 보이는 데이터 별 (반경 px) */
  pick(x: number, y: number, radius = 28): { id: string; layer: string; sky: [number, number]; screen: [number, number]; dist: number } | null {
    let best: { id: string; layer: string; sky: [number, number]; screen: [number, number]; dist: number } | null = null
    radius = Math.max(18, radius) // 마우스 히트 반경 최소 18px (review #14)
    for (const s of this.stars.values()) {
      if (this.visTarget(s) < 0.05) continue
      const [sx, sy] = this.toScreenPx(s.x, s.y)
      const d = Math.hypot(sx - x, sy - y)
      if (d <= radius && (!best || d < best.dist)) best = { id: s.id, layer: s.layer, sky: [s.x, s.y], screen: [sx, sy], dist: d }
    }
    return best
  }

  /* ---------- 계측 · 검증 ---------- */

  skyStats(): SkyStatsOut {
    const s = this.sky?.stats()
    const navs = this.perf.navs
    const all = navs.flatMap((n) => n.frames).sort((a, b) => a - b)
    return {
      bakes: s?.bakes ?? 0,
      lastBakeMs: s?.bakeMs ?? 0,
      longTasksInNav: this.perf.longTasksInNav,
      navP95Ms: all.length ? all[Math.floor(0.95 * (all.length - 1))]! : 0,
      tier: s?.tier ?? 'C',
      fps: s?.fps ?? 0,
      flights: (() => {
        const fl = navs.filter((n) => n.flight.length)
        const f = fl.flatMap((n) => n.flight).sort((a, b) => a - b)
        return { count: fl.length, p95FrameMs: f.length ? f[Math.floor(0.95 * (f.length - 1))]! : 0, maxFrameMs: f.length ? f[f.length - 1]! : 0 }
      })(),
    }
  }

  private perfApi = {
    stats: () => this.skyStats(),
    navs: () =>
      this.perf.navs.map((n) => {
        const fs = [...n.flight].sort((a, b) => a - b)
        return {
          bakes: n.bakes,
          /** 비행 중(카메라가 움직이는 동안) 최장 프레임·p95 */
          flightMaxMs: fs.length ? +fs[fs.length - 1]!.toFixed(1) : 0,
          flightP95Ms: fs.length ? +fs[Math.floor(0.95 * (fs.length - 1))]!.toFixed(1) : 0,
          /** 누른 순간부터 전환 전체(커밋 프레임 포함) */
          maxFrameMs: +n.maxFrame.toFixed(1),
          p95Ms: +n.p95.toFixed(1),
          longTasks: n.longTasks,
          frames: n.frames.length,
          commitMs: n.commitMs ?? null,
        }
      }),
    longTasks: () => this.perf.longTasks,
    reset: () => {
      this.perf.navs = []
      this.perf.longTasks = 0
      this.perf.longTasksInNav = 0
    },
    sky: () => this.sky?.stats(),
    debug: () => ({ sky: this.sky?.debugState(), preset: this.preset, hint: this.hint, gate: this.gate, paused: this.paused, overlay: this.overlay, moods: [...this.moods.values()].map((m) => m.preset), pauses: [...this.pauses.values()] }),
    /** 검증용: 다음 자리에 별 탄생(V1) · 별가루 모임 켜기/끄기 */
    birth: (at?: { x: number; y: number }) => this.birthStar({ id: 'test:' + Math.round(performance.now()), at: at ?? 'next', kind: 'set' }),
    gather: (on = true) => this.gatherDust(on ? 'next' : null),
    /** 카메라 직접 (검증용): flyTo('focus') */
    fly: (scene: MoodName) => this.flyTo({ scene }),
    /** 프레임 비용 측정 (gl.finish 포함). scenes를 주면 20프레임마다 장면 전환 */
    bench: (n = 120, presets: MoodName[] = ['notes', 'graph', 'review', 'planner', 'focus', 'today', 'settings']) => {
      const ph = this.phase === 'auto' ? autoPhase() : this.phase
      return this.sky?.bench(n, presets.map((p) => sceneFor(p, ph).scene))
    },
  }

  stats(): FieldStats {
    const s = this.sky?.stats()
    return {
      fps: s?.fps ?? 0,
      tier: s?.tier ?? 'C',
      tierAuto: this.tierSetting === 'auto',
      res: s?.res ?? 0,
      megapixels: s?.megapixels ?? 0,
      jsMs: s?.jsMs ?? 0,
      p95: s?.p95 ?? 0,
      renderer: s?.renderer ?? '',
      render: this.sky ? 'webgl2' : 'canvas2d',
      mode: this.mode,
      running: s?.running ?? false,
      paused: this.paused,
      view: [this.vw, this.vh],
    }
  }

  simulateContextLoss(): boolean {
    const gl = this.canvas?.getContext('webgl2')
    const ext = gl?.getExtension('WEBGL_lose_context')
    if (!ext) return false
    ext.loseContext()
    window.setTimeout(() => ext.restoreContext(), 1000)
    return true
  }

  /** 2D 대체는 v3에서 CSS 하늘로 바뀌었다 (시그니처만 유지) */
  force2d(_on: boolean): void {
    void _on
  }
}

const SUBJECT_COLORS: Record<string, string> = {
  phys: '#5CB8FF',
  math: '#8F9BFF',
  chem: '#3ED6C0',
  econ: '#F5C451',
  writing: '#FF8DB5',
  eng: '#C29BFF',
}
function subjectColor(subject?: string): [number, number, number] {
  const c = cssColor(subject ? (SUBJECT_COLORS[subject] ?? (subject.startsWith('#') ? subject : undefined)) : undefined)
  if (!c) return [0.92, 0.93, 0.96]
  // 과목색 10%만 (흰 별빛 위주)
  return [0.9 + 0.1 * c[0], 0.9 + 0.1 * c[1], 0.9 + 0.1 * c[2]]
}
