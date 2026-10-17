/**
 * 결 하늘 엔진 — M1: 3D 은하(src/galaxy3d/engine.ts)를 FieldProvider 뒤에서 돌린다.
 * WebGL2가 없거나 C 등급이면 v3 2.5D 은하수(src/galaxy/sky/sky.ts)를 동적 import로 늦게 불러 대체한다.
 * (아래는 v3 설명 — 2.5D 대체 경로에 그대로 해당)
 * 결 하늘 엔진 — v3 은하수를 FieldProvider 뒤에서 돌린다 (team/v3-integration-brief.md, team/design-v3-motion.md).
 *
 * 캔버스 1개·rAF 1개(src/galaxy/sky/sky.ts). React는 이 객체의 메서드만 부른다(프레임마다 리렌더 없음).
 * 정적 하늘은 시작·화면 크기 변경 때만 굽는다. 화면 전환·사건은 모두 유니폼과 데이터 별(점 수십 개)만 바꾼다 → 굽기 0회.
 *
 * 레이어 규칙(그대로): html에 배경, body는 transparent, 하늘은 position:fixed; inset:0; z-index:0,
 * 앱 루트는 position:relative; z-index:1.
 */
import type { Sky, Cam, LookOverride, SpecialStar } from '../../galaxy/sky/sky'
import { Galaxy3D, type Anchor, type AnchorName, type DataStar, type LinkSpec, type PlaceId } from '../../galaxy3d/engine'
import { LANDMARKS } from '../../galaxy3d/galaxy'
import type { SceneName } from '../../galaxy/sky/compositions'
import { deviceOf, pickComposition } from '../../galaxy/sky/compositions'
import { mulberry32 } from '../../galaxy/sky/rng'
import { examStar, todayStarPositions } from '../../galaxy/scenes'
import type { FieldStats } from '../engine/engine'
import type { FieldData, Mood, MoodName, MotionLevel, MotionPrefs, PauseReason, RippleOptions, ThemeName, Tier } from '../types'
import { SPACE_RULES } from '@/perf/scheduler'
import { installSkyGesture } from './gesture'

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
/** 별가루 ↔ 오늘의 별자리 최소 거리(u): 오늘 장소에서 화면 18px 이상 */
const DUST_GAP = 0.55
const SEAL: [number, number, number] = [1.0, 0.561, 0.471]

/** 공간 → 하늘 장면 + 노출 (50–100%, 한 번에 45%p 이하) */
function sceneFor(preset: MoodName, phase: Exclude<SkyPhase, 'auto'>): { scene: SceneName; look: LookOverride } {
  switch (preset) {
    case 'landing':
    case 'onboarding':
      return { scene: 'hero', look: { bright: 1 } }
    case 'today':
      if (phase === 'blue') return { scene: 'today-class', look: { bright: 0.8 } }
      if (phase === 'dawn') return { scene: 'today-night', look: { bright: 0.9, airglow: 1, blue: 0.4 } }
      return { scene: 'today-night', look: { bright: 1 } }
    case 'notes':
      return { scene: 'notes', look: { bright: 0.55 } }
    case 'graph':
    case 'map':
      return { scene: 'graph', look: { bright: 0.45 } } // 띠 45% — 노트 별자리가 주인공 (review #6)
    case 'review':
      return { scene: 'review', look: { bright: 0.7 } }
    case 'focus':
      return { scene: 'focus', look: { bright: 0.65 } }
    case 'planner':
    case 'plan':
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
  map: { graph: 1 },
  onboarding: {},
  planner: { exam: 1, today: 0.5 },
  plan: { exam: 1, today: 0.5 },
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
  map: { x: 0.7, y: 0.36, z: 2.3 },
  onboarding: { x: 0.7, y: 0.36, z: 2.3 },
  plan: { x: 0.55, y: 0.47, z: 0.88 },
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
  /** 3D 그어짐 시작(초, nowS) — 0이면 이미 그어진 선 */
  t0?: number
}

/** 무드 → 3D 장소 (design-v4 §8). 설정은 장소가 아니라 시트 → null(비행 없음), 장소가 아닌 무드는 오늘 시점 */
function place3d(m: MoodName): PlaceId | null {
  switch (m) {
    case 'notes':
      return 'notes'
    case 'graph':
    case 'map':
      return 'graph'
    case 'review':
      return 'review'
    case 'planner':
    case 'plan':
      return 'planner'
    case 'focus':
      return 'focus'
    case 'settings':
      return null
    case 'onboarding':
      return 'onboarding'
    default:
      return 'today'
  }
}
/** 데이터 별 층 → 은하 속 자리(패턴 좌표) · 넓이(u). 하늘 좌표(집 화면 비율 0..1)를 그 둘레에 펼친다 — 사건 51개 표(design-m1) 전 임시 배치 */
const LAYER3D: Record<Layer, { c: [number, number, number]; span: number; group: string }> = {
  // design-m1 0-1: seat 나의 자리(반지름 0.8u) · cluster 복습 성단(0.6u) · nebula 지도 성운(1.5u) · exam 시험 별
  today: { c: LANDMARKS.focus, span: 1.6, group: 'seat' }, // 오늘의 별자리는 pos3에서 따로 (반지름 1.4u, review-m2)
  focus: { c: LANDMARKS.focus, span: 1.6, group: 'seat' },
  review: { c: LANDMARKS.review, span: 1.2, group: 'cluster' },
  graph: { c: LANDMARKS.graph, span: 3, group: 'nebula' },
  exam: { c: [2.0, 0.3, -1.5], span: 0.4, group: 'exam' },
}
/** 나의 가지 k번째 날 자리: 나의 자리에서 바깥으로 로그 나선(피치 18°), 날마다 0.25u */
function branchPos(k: number): [number, number, number] {
  const c = LANDMARKS.focus
  const r0 = Math.hypot(c[0], c[2])
  const rr = r0 + 0.25 * k * Math.sin((18 * Math.PI) / 180)
  const th = Math.atan2(c[2], c[0]) - (0.25 * k * Math.cos((18 * Math.PI) / 180)) / r0
  return [rr * Math.cos(th), c[1] + 0.1, rr * Math.sin(th)]
}
/** M3-6 오늘의 별자리: 별마다 밀어 둔 거리(u, x · z) — 가까운 쌍만 떨어뜨린다 */
const todayAdj = new Map<string, [number, number]>()
let todayInfo = { dmin: 0, k: 0, fore: 0 }
const pos3 = (s: { layer: Layer; x: number; y: number; id?: string }): [number, number, number] => {
  const z = LAYER3D[s.layer]
  if (s.layer === 'today') {
    // 오늘의 별자리 (review-m2): 별자리 상자(scenes todayStarPositions) 가운데를 나의 자리에 두고 반지름 1.4u로 편다.
    // 상자 안 걸음 28–64px → 0.3u 이상 → 오늘 3/4 시점(약 35–40px/u)에서 별 사이 10px 이상
    const phone = typeof window !== 'undefined' && Math.min(window.innerWidth, window.innerHeight) < 600
    const [cx, cy, S0] = phone ? [0.25, 0.29, 8.2] : [0.48, 0.25, 9.3]
    // M3-6: 지금 구도에서 별 사이가 14px 이상이 되게 FieldEngine이 가까운 쌍만 밀어 둔 만큼(u) 더한다(모양은 그대로)
    const adj = s.id ? todayAdj.get(s.id) : undefined
    return [z.c[0] + (s.x - cx) * S0 + (adj?.[0] ?? 0), z.c[1] + 0.12, z.c[2] + (s.y - cy) * S0 + (adj?.[1] ?? 0)]
  }
  return [z.c[0] + (s.x - 0.5) * z.span, z.c[1] + 0.12, z.c[2] + (s.y - 0.5) * z.span]
}
/** 빈 하늘 드래그 기본값 (m1-brief 계약): 오늘·지도·집중은 켬, 노트·복습·계획은 끔 */
const DRAG_DEFAULT: Partial<Record<MoodName, boolean>> = { landing: true, today: true, graph: true, map: true, focus: true }

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
  /** M1: 3D 은하 (있으면 이쪽이 하늘) */
  private g3d: Galaxy3D | null = null
  private rotation: 'on' | 'slow' | 'off' = 'on'
  private sheets = new Set<number>()
  private drags = new Map<number, boolean>()
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

  configure(o: { level: MotionLevel; theme: ThemeName; tier: 'auto' | Tier; debug: boolean; travel?: Travel; meteors?: boolean; rotation?: 'on' | 'slow' | 'off' }): void {
    if (o.travel) this.travel = o.travel
    if (o.rotation) this.rotation = o.rotation
    if (typeof o.meteors === 'boolean') this.meteorsOn = o.meteors
    const themeChanged = o.theme !== this.theme
    const tierChanged = o.tier !== this.tierSetting
    this.level = o.level
    this.theme = o.theme
    this.debug = o.debug
    this.tierSetting = o.tier
    this.config3d()
    const sky = this.sky
    if (sky) {
      sky.setReduced(this.mode === 'off')
      sky.setMeteors(this.mode === 'rich' && this.meteorsOn)
      if (tierChanged) sky.setTier(o.tier)
      if (themeChanged) sky.setPlate(o.theme === 'light', this.mode === 'off' ? 1 : 680)
    }
    this.emitPrefs()
  }

  private config3d() {
    const g = this.g3d
    if (!g) return
    g.setMotion(this.mode)
    g.setRotation(this.rotation)
    g.setTheme(this.theme)
    g.setTravel(this.travelMode())
  }

  /* ---------- DOM ---------- */

  /** 하늘 모드와 그 이유 (진단 ?diag=1 · console.warn) */
  skyMode: { mode: '3d' | '2.5d'; reason: string } = { mode: '2.5d', reason: '아직 붙지 않음' }
  private relost = false
  private setSkyMode(mode: '3d' | '2.5d', reason: string): void {
    this.skyMode = { mode, reason }
    if (mode === '2.5d') console.warn('[결] 3D 하늘 →2.5D:', reason)
  }
  /** 진단 칸(?diag=1)에 보일 하늘 정보 */
  diag(): { mode: '3d' | '2.5d'; reason: string; tier: string | null; fps: number | null; power: string | null } {
    const st = this.g3d?.stats() as { tier?: string; fps?: number; power?: string } | null | undefined
    return { ...this.skyMode, tier: st?.tier ?? null, fps: st?.fps ?? null, power: st?.power ?? null }
  }
  attach(host: HTMLDivElement): void {
    if (this.host) this.detach()
    this.host = host
    host.classList.add('gx-sky-host')
    const canvas = document.createElement('canvas')
    canvas.setAttribute('aria-hidden', 'true')
    canvas.className = 'gx-sky-canvas'
    host.appendChild(canvas)
    this.canvas = canvas
    // 누르기 ↔ 끌기 구분 (M3): 하늘 끌기·핀치·관성·휠 뒤의 click 표시 → isSkyDragClick
    this.cleanups.push(installSkyGesture(this.dragFilter, () => this.g3d?.spin() ?? 0, () => !!this.g3d && this.dragEnabled()))
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('class', 'gx-sky-links')
    svg.setAttribute('aria-hidden', 'true')
    host.appendChild(svg)
    this.svg = svg
    this.linkG = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    svg.appendChild(this.linkG)
    // M1: 3D 은하가 기본. WebGL2가 없거나 C 등급이면 2.5D 하늘을 늦게 불러 쓴다
    // 3D가 되는 기기는 등급이 낮아도(C) 3D — 2.5D는 WebGL2가 없거나 3D 시작이 실패했을 때만 (안드로이드 진단, ?diag=1)
    const relost = this.relost
    this.relost = false
    if (!Galaxy3D.supported()) this.setSkyMode('2.5d', 'supported: WebGL2를 쓸 수 없음')
    else {
      try {
        this.g3d = new Galaxy3D({
          tier: this.tierSetting,
          rotation: this.rotation,
          input: window,
          dragFilter: this.dragFilter,
          onFirstFrame: () => {
            host.classList.add('is-ready')
            if (this.mode === 'off') this.revealData(true)
            else window.setTimeout(() => this.revealData(false), 700)
          },
        }).mount(canvas)
        svg.style.display = 'none' // 별자리 선은 3D 사건 층이 그린다
        for (const n of ['core', 'focus-disk'] as AnchorName[])
          this.g3d.anchors(n, (a) => {
            this.anchorLast.set(n, a)
            this.anchorCbs.get(n)?.forEach((f) => f(a))
          })
        this.config3d()
        this.g3d.setPaper(this.paperN > 0)
        this.uploadNotes()
        this.uploadNoteLinks()
        this.setSkyMode('3d', this.g3d.hdr ? 'HDR' : 'LDR(RGBA8) — EXT_color_buffer_float 없음 또는 RGBA16F 프레임버퍼 미완성')
      } catch (e) {
        this.g3d = null
        const msg = String((e as Error)?.message ?? e)
        const stage = /^(context|compile|link|worker|fbo):/.test(msg) ? '' : 'init: '
        this.setSkyMode('2.5d', (relost ? 'lost → ' : '') + stage + msg.slice(0, 400))
      }
    }
    if (!this.g3d) this.start2D(host, canvas)
    this.attachCommon(host, canvas)
  }

  /** 2.5D 하늘(대체): 동적 import — 3D가 되는 기기에서는 내려받지도 않는다 */
  private start2D(host: HTMLDivElement, canvas: HTMLCanvasElement) {
    void import('../../galaxy/sky/sky')
      .then(({ Sky: SkyCtor }) => {
        if (this.host !== host || this.canvas !== canvas) return
        this.make2D(host, canvas, SkyCtor)
        this.resize()
        const phone = deviceOf(this.vw, this.vh) === 'phone'
        this.sky?.setTiles(Object.keys(PLACES).map((k) => (phone ? PLACES_PHONE[k as MoodName] : undefined) ?? PLACES[k as MoodName]))
        this.applyMood(true)
        this.pushStars()
      })
      .catch(() => {
        host.classList.add('is-ready', 'is-css')
        this.gate = false
      })
  }

  private make2D(host: HTMLDivElement, canvas: HTMLCanvasElement, SkyCtor: typeof Sky) {
    try {
      const sky = new SkyCtor(canvas, { tier: this.tierSetting, reduced: this.mode === 'off', meteors: this.mode === 'rich' && this.meteorsOn })
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
  }

  private attachCommon(_host: HTMLDivElement, canvas: HTMLCanvasElement) {
    let lostTimer = 0
    const onLost = () => {
      window.clearTimeout(lostTimer)
      lostTimer = window.setTimeout(() => {
        // 복구되지 않으면 새 캔버스로 다시 붙인다 (데이터 별·장면은 그대로)
        const h = this.host
        if (!h) return
        this.detach()
        this.relost = true
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
    // 가까이 갈 장소(그래프·집중)는 유휴 시간에 고해상도 타일로 미리 굽는다 (2.5D만)
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
      rz = requestAnimationFrame(() => {
        this.resize()
        if (this.g3d) this.pushStars() // M3-6: 크기가 바뀌면 오늘의 별자리 넓힘 배수를 다시
      })
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
    // 나의 가지: 숨김에서 돌아오면 날 경계를 다시 본다(보이지 않을 때만 옮긴다)
    const onVis = () => {
      if (document.hidden) return
      this.branchN = -1
      this.pushStars()
    }
    document.addEventListener('visibilitychange', onVis)
    this.cleanups.push(() => document.removeEventListener('visibilitychange', onVis))
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
    this.g3d?.destroy()
    this.g3d = null
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
    const g3 = this.g3d?.stats()
    if (g3) {
      this.hud.textContent = `3D · ${g3.power} · ${g3.fps} fps · ${g3.tier} · ${g3.megapixels.toFixed(1)}MP · gpu ${g3.gpuMs?.toFixed(2) ?? '–'}ms · js ${g3.jsMs.toFixed(2)}ms · ${g3.place}`
      return
    }
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
    this.g3d?.holdFlight(on)
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
    this.applyStage()
    if (this.g3d) {
      const dim3 = spec?.preset === preset ? spec?.override?.dim : undefined
      this.g3d.setExposure(typeof dim3 === 'number' ? Math.max(0.5, Math.min(1, dim3)) : 1)
      this.g3d.setSheet(preset === 'settings' || this.sheets.size > 0)
      this.g3d.setDrag(this.dragEnabled())
      this.g3d.setPhase(this.phase === 'auto' ? autoPhase() : this.phase)
      this.applyNoteView()
      if (changed || instant) {
        this.camStack = []
        const ms = this.goCamera({ scene: preset }, instant)
        this.fadeLayers(instant)
        if (preset === 'graph' || preset === 'map') this.flushDeferred()
        // 나의 가지(#43): 날이 바뀐 뒤 처음 오늘·계획에 오면 가지 끝 별 하나 V11
        if (this.branchGlint && ['today', 'landing', 'plan', 'planner'].includes(preset)) {
          this.branchGlint = false
          const tip = branchPos(Math.max(1, this.branchDays()))
          window.setTimeout(() => this.g3d?.sparkle(tip), ms + 200)
        }
      }
      return
    }
    const ph = this.phase === 'auto' ? autoPhase() : this.phase
    const { scene, look } = sceneFor(preset, ph)
    const dim = spec?.preset === preset ? spec?.override?.dim : undefined
    const l: LookOverride = { ...look }
    if (typeof dim === 'number' && l.bright !== undefined) l.bright = Math.max(0.5, Math.min(1, l.bright * dim))
    const ms = this.mode === 'off' ? 0 : this.mode === 'calm' ? Math.min(durMs, 600) : durMs
    this.sky?.setScene(scene, instant || ms === 0, l, ms)
    // 전력 규칙: 집중 20초 → 쉼, 노트·복습·설정 30초 → 깊은 대기 (power-budget §2)
    this.sky?.setPowerRule?.(SPACE_RULES[preset] ?? null)
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
    return this.sky?.now() ?? this.g3d?.now() ?? performance.now() / 1000
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
  /** M3-6: 오늘 장소 기본 자세 · 지금 화면 크기에서 오늘의 별자리 별 사이가 최소 14px(+15% 여유)이 되게 가까운 쌍만 밀어 낸다.
   *  은하가 돌아 별자리를 보는 방향이 바뀌어도 되게 원반 면 최대 단축(sin 고도)으로 세계 거리를 정한다. 크기·밝기·선은 그대로 */
  private updateTodayScale(): void {
    todayAdj.clear()
    const ts = [...this.stars.values()].filter((s) => s.layer === 'today')
    const m = this.g3d?.pxPerUnitAt('today', [LANDMARKS.focus[0], LANDMARKS.focus[1] + 0.12, LANDMARKS.focus[2]])
    if (!m || ts.length < 2) return
    const dmin = Math.min(1.2, (14 * 1.15) / (m.k * Math.max(0.15, m.fore)))
    todayInfo = { dmin, k: m.k, fore: m.fore }
    const P = ts.map((s) => pos3({ layer: 'today', x: s.x, y: s.y }))
    const B = P.map((p) => [p[0], p[2]] as [number, number])
    for (let it = 0; it < 40; it++) {
      let moved = false
      for (let i = 0; i < P.length; i++)
        for (let j = i + 1; j < P.length; j++) {
          let dx = P[j]![0] - P[i]![0]
          let dz = P[j]![2] - P[i]![2]
          let d = Math.hypot(dx, dz)
          if (d >= dmin) continue
          if (d < 1e-4) {
            const a = ((hashStr(ts[j]!.id) % 628) / 100)
            dx = Math.cos(a)
            dz = Math.sin(a)
            d = 1
          }
          const push = (dmin - Math.min(d, dmin)) / 2 + 1e-4
          P[i]![0] -= (dx / d) * push
          P[i]![2] -= (dz / d) * push
          P[j]![0] += (dx / d) * push
          P[j]![2] += (dz / d) * push
          moved = true
        }
      if (!moved) break
    }
    ts.forEach((s, i) => todayAdj.set(s.id, [P[i]![0] - B[i]![0], P[i]![2] - B[i]![1]]))
  }
  private pushStars() {
    if (this.pushQueued) return
    this.pushQueued = true
    queueMicrotask(() => {
      this.pushQueued = false
      if (this.g3d) {
        this.updateTodayScale()
        const list: DataStar[] = []
        for (const s of this.stars.values()) {
          if (s.to <= 0.001 && this.curLevel(s) <= 0.001) continue
          const sel = this.selected === s.id
          list.push({
            id: s.id,
            group: LAYER3D[s.layer].group,
            pos: pos3(s),
            size: sel ? 3.2 : Math.min(2.6, 1.2 + s.L / 100),
            L: 1,
            color: sel ? GOLD : s.color,
            from: s.from,
            to: s.to,
            t0: s.t0,
            dur: s.dur,
          })
        }
        // 나의 가지 (#43): 지난 날의 별자리 — 나의 자리에서 바깥으로 로그 나선(피치 18°), 날마다 0.25u
        const nb = Math.min(60, this.branchDays())
        for (let k = 1; k <= nb; k++) list.push({ id: 'branch:' + k, group: 'branch', pos: branchPos(k), size: 1.4, L: 1, color: GOLD, from: 0.45, to: 0.45, t0: 0, dur: 0 })
        list.push(...this.m2Stars())
        this.g3d.setDataStars(list)
        // 노트 책등 위 점 (#28): 노트에서는 지도 별이 책등의 높이(해시)에 점으로
        this.g3d.setSpine(
          this.preset === 'notes'
            ? [...[...this.stars.values()].filter((s) => s.layer === 'graph' && s.to > 0.01).map((s) => ({ id: s.id, s: ((hashStr(s.id) % 1000) / 1000) * 1.8 - 0.9, level: Math.max(0.35, s.to), color: s.color })), ...this.inkSpine()]
            : [],
        )
        this.pushLinks3d()
        return
      }
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
    const rec: LinkRec = { key, a, b, layer, el: null, drawn: !animate, t0: animate ? this.nowS() : 0 }
    this.links.set(key, rec)
    this.renderLink(rec, animate)
  }

  /** 3D 별자리 선: 두 데이터 별 사이 그어짐(V2 600–900ms), 보이는 층만 */
  private pushLinks3d() {
    if (!this.g3d) return
    const vis = LAYERS[this.preset] ?? {}
    const out: LinkSpec[] = []
    for (const l of this.links.values()) {
      const A = this.stars.get(l.a)
      const B = this.stars.get(l.b)
      const v = vis[l.layer] ?? 0
      if (!A || !B || v <= 0) continue
      const sel = this.selected && (l.a === this.selected || l.b === this.selected)
      out.push({ a: pos3(A), b: pos3(B), t0: l.t0 ?? 0, dur: l.t0 ? 0.8 : 0, alpha: (sel ? 0.6 : this.selected ? 0.16 : 0.32) * v })
    }
    this.g3d.setLinks(out)
  }

  private renderLink(l: LinkRec, animate: boolean) {
    if (this.g3d) {
      void animate
      this.pushStars()
      return
    }
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
    if (this.g3d && o.kind === 'note') {
      // M2: 노트의 탄생은 노트 층(useSkyStars notes)의 같은 id에서 — 따로 별을 만들지 않는다.
      // 아직 그 id가 노트 층에 없으면(동기화 전) 들어오는 순간에 V1s
      const r = this.notes.get(o.id)
      if (r) {
        if (this.mode !== 'off') this.g3d.sparkle(r.pos)
      } else this.pendingBirths.set(o.id, performance.now())
      return
    }
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
    if (this.g3d && this.notes.has(fromId) && this.notes.has(toId)) {
      // D7: 노트 별 사이 빛줄기 — 정적 버퍼에 더하고, 지도에서는 V2 머리(사건 층 선 0.8초)
      const key = fromId < toId ? fromId + '|' + toId : toId + '|' + fromId
      if (!this.noteLinkSet.has(key)) {
        this.noteLinkSet.add(key)
        this.noteLinkPairs.push([fromId, toId])
        this.uploadNoteLinks(!this.selected)
        const A = this.notes.get(fromId)!
        const B = this.notes.get(toId)!
        if ((this.preset === 'map' || this.preset === 'graph') && this.mode !== 'off') this.g3d.raw?.setLinks([{ a: A.pos, b: B.pos, t0: this.nowS(), dur: 0.8, alpha: 1 }])
        else if (this.preset === 'notes' && this.mode !== 'off') {
          this.g3d.sparkle(A.pos)
          this.g3d.sparkle(B.pos)
        }
      }
      return
    }
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
    if (this.g3d) return // design-m1: 3D에 유성 없음(V5 삭제) — 큰 완료는 swellBand
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

  glint(near?: Element | { x: number; y: number } | 'seat' | { band: number }): void {
    if (this.g3d) {
      // design-m1: V11은 월드 자리에만 — 'seat'(가장 밝은 오늘 별) · { band: 남은 날 }(계획의 시간 띠). 화면 점(레일 아이콘 등)은 뺀다
      if (this.mode === 'off' || this.theme === 'light' || !near) return
      if (near === 'seat') {
        const best = [...this.stars.values()].filter((s) => s.layer === 'today').sort((a, b) => b.level - a.level)[0]
        this.g3d.sparkle(best ? pos3(best) : [LANDMARKS.focus[0], LANDMARKS.focus[1] + 0.12, LANDMARKS.focus[2]])
      } else if (typeof near === 'object' && 'band' in near) {
        const p = this.preset === 'plan' || this.preset === 'planner' ? this.g3d.bandPoint(near.band) : null
        this.g3d.sparkle(p ?? [LANDMARKS.focus[0], LANDMARKS.focus[1] + 0.12, LANDMARKS.focus[2]])
      }
      return
    }
    if (near === 'seat' || (near && typeof near === 'object' && 'band' in near)) near = undefined
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

  swellBand(o?: { amount?: number; ms?: number; at?: 'seat' | 'cluster' }): void {
    if (this.mode === 'off') return
    if (this.g3d) {
      // V13 원반 부풂 +8% · at: V13s 자리 부풂(+25%). 인자 없이 복습에서 부르면 성단도 같이 (design-m1 #25)
      this.g3d.swell(o?.at ?? (this.preset === 'review' ? 'cluster' : 'core'))
      return
    }
    this.sky?.swellBand(this.mode === 'calm' ? Math.min(0.04, o?.amount ?? 0.08) : (o?.amount ?? 0.08), o?.ms ?? 2000)
  }

  /** V7 별가루 모임: 반경 300px 안 별가루 30%가 4초에 걸쳐 그 자리 쪽으로 낙하 방향을 튼다(≤ 25°, 속도 그대로). null이면 4초에 걸쳐 풀린다 */
  gatherDust(target: Element | { x: number; y: number } | 'next' | null): void {
    if (this.g3d) return // design-m1: 별가루 모임(V7) 삭제
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
    if (this.g3d && ((id && this.notes.has(id)) || (this.selected && this.notes.has(this.selected)))) {
      this.selected = id
      this.uploadNotes()
      this.uploadNoteLinks()
      this.pushStars()
    }
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
    this.g3d?.setTint(subjectId ? cssColor(color) : null)
    if (this.notes.size) this.uploadNotes()
    for (const s of this.stars.values()) this.animTo(s, this.visTarget(s), 0.6)
    this.pushStars()
  }

  syncStars(spec: {
    today?: Array<{ id: string; at?: number; kind: StarKind }>
    exam?: { id: string; dday: number } | null
    review?: Array<{ id: string; subject: string; level: number }>
    graph?: { nodes: Array<{ id: string; subject: string; links: number }>; links: Array<[string, string]> }
    notes?: Array<{ id: string; subjectId: string; links: number }>
    noteLinks?: Array<[string, string]>
    subjects?: Array<{ id: string; color: string }>
  }): void {
    if (spec.notes) this.syncNotes(spec.notes, spec.noteLinks, spec.subjects)
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
      this.g3d?.setCalm(true)
      if (!ov) this.sky?.setGain(0.85, 300)
      this.sky?.setPaused?.(true)
    } else if (!ink && this.paused) {
      this.resumeTimer = window.setTimeout(() => {
        this.paused = false
        this.g3d?.setCalm(false)
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
    if (this.g3d) {
      const id = place3d(t.scene)
      const mode = this.travelMode()
      this.g3d.setTravel(mode)
      // 3D 비행 길이는 회전각으로 정해진다(1.2–3.0s, 동작 줄이기·끔·짧게는 0.5초 어둡게 바꾸기) — dur는 무시
      void dur
      const ms = id ? Math.round(this.g3d.setPlace(id, { instant })) : 0
      this.lastFlightS = Math.max(SKY_TIMING.navMs, ms) / 1000
      this.camCur = { ...t, durationMs: ms }
      const fly = mode === 'fly' && ms > 0
      const inMs = fly ? Math.max(170, ms - 320) : 170
      const root = document.documentElement.style
      root.setProperty('--sky-flight-ms', (fly ? ms : 170) + 'ms')
      root.setProperty('--sky-content-in-ms', inMs + 'ms')
      this.onFlight?.(ms, inMs)
      if (ms > 0) this.perf.navUntil = Math.max(this.perf.navUntil, performance.now() + ms + 150)
      return ms
    }
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
    if (this.g3d && t.focus && t.scene === this.preset && this.lastPickNote && this.notes.has(this.lastPickNote)) {
      // 방금 고른 노트 별 쪽으로 짧게 다가감(1.4u) — 노트 별은 하늘 좌표가 없다(sky [0, 0])
      this.camStack.push(this.camCur)
      if (this.camStack.length > 8) this.camStack.shift()
      this.camCur = t
      const ms = this.g3d.approach(this.notes.get(this.lastPickNote)!.pos, 1.4)
      return new Promise((res) => window.setTimeout(res, ms))
    }
    if (this.g3d && t.focus && t.scene === this.preset) {
      // design-m1 #31: 데이터 별 쪽으로 짧게 다가감만 (자세·롤 그대로) — 노트 별 1.4u · 오늘·나의 별 1.6u
      let best: StarRec | null = null
      let bd = Infinity
      for (const s of this.stars.values()) {
        const d = Math.hypot(s.x - t.focus[0], s.y - t.focus[1])
        if (d < bd) {
          bd = d
          best = s
        }
      }
      if (best) {
        this.camStack.push(this.camCur)
        if (this.camStack.length > 8) this.camStack.shift()
        this.camCur = t
        const ms = this.g3d.approach(pos3(best), best.layer === 'graph' ? 1.4 : 1.6)
        return new Promise((res) => window.setTimeout(res, ms))
      }
    }
    this.camStack.push(this.camCur)
    if (this.camStack.length > 8) this.camStack.shift()
    const ms = this.goCamera(t, false, o?.duration)
    return new Promise((res) => window.setTimeout(res, ms))
  }

  back(o?: { duration?: number }): Promise<void> {
    if (this.g3d) {
      const prev = this.camStack.pop()
      this.camCur = prev ?? { scene: this.preset }
      const ms = this.g3d.approach(null)
      return new Promise((res) => window.setTimeout(res, ms))
    }
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
  pick(x: number, y: number, radius = 28): { id: string; layer: string; kind?: 'note'; sky: [number, number]; screen: [number, number]; dist: number; world: [number, number, number] } | null {
    if (this.g3d) {
      const r = this.g3d.pick(x, y, radius)
      let best: { id: string; layer: string; kind?: 'note'; sky: [number, number]; screen: [number, number]; dist: number; world: [number, number, number] } | null = null
      if (r) {
        const s = this.stars.get(r.id)
        best = { id: r.id, layer: s?.layer ?? 'today', sky: [s?.x ?? 0, s?.y ?? 0], screen: r.screen, dist: r.dist, world: r.world }
      }
      // M2: 지도에서는 노트 층 별도 고른다 (id · kind 'note' · world)
      const raw = this.g3d.raw
      if (raw && (this.preset === 'map' || this.preset === 'graph') && this.notes.size) {
        const R = Math.max(18, radius)
        for (const [id, n] of this.notes) {
          const sp = raw.project(n.pos)
          if (!sp) continue
          const d = Math.hypot(sp[0] - x, sp[1] - y)
          if (d <= R && (!best || d < best.dist)) best = { id, layer: 'notes', kind: 'note', sky: [0, 0], screen: sp, dist: d, world: raw.toWorld(n.pos) }
        }
      }
      this.lastPickNote = best?.kind === 'note' ? best.id : null
      return best
    }
    let best: { id: string; layer: string; sky: [number, number]; screen: [number, number]; dist: number; world: [number, number, number] } | null = null
    radius = Math.max(18, radius) // 마우스 히트 반경 최소 18px (review #14)
    for (const s of this.stars.values()) {
      if (this.visTarget(s) < 0.05) continue
      const [sx, sy] = this.toScreenPx(s.x, s.y)
      const d = Math.hypot(sx - x, sy - y)
      if (d <= radius && (!best || d < best.dist)) best = { id: s.id, layer: s.layer, sky: [s.x, s.y], screen: [sx, sy], dist: d, world: [s.x, s.y, 0] }
    }
    return best
  }

  /* ---------- 계측 · 검증 ---------- */

  skyStats(): SkyStatsOut {
    const g = this.g3d?.stats()
    if (g) {
      const f = g.flights.map((x) => x.maxFrame).sort((a, b) => a - b)
      return {
        bakes: 0,
        lastBakeMs: 0,
        longTasksInNav: this.perf.longTasksInNav,
        navP95Ms: g.p95,
        tier: g.tier,
        fps: g.fps,
        flights: { count: g.flights.length, p95FrameMs: f.length ? f[Math.floor(0.95 * (f.length - 1))]! : 0, maxFrameMs: f.length ? f[f.length - 1]! : 0 },
      }
    }
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
    /** M1: 3D 엔진 측정 API (measure · uncap · force · flights …) */
    g3d: () => this.g3d?.debug ?? null,
    g3dStats: () => this.g3d?.stats() ?? null,
    /** M2: 노트 별·빛줄기 데이터 갱신 JS ms (마지막) */
    notesMs: () => this.perfNotesMs,
    /** M2 검증: 하늘 사건을 콘솔에서 바로 (dust · fileDust · glintNotes · bloomNebula · revealGalaxy · importNotes · select) */
    events: () => this,
    /** M2 검증: 합성 노트 n개 · 링크 m개 (과목 6) */
    /** M3-6 검증: 오늘의 별자리 별의 지금 화면 자리(CSS px)와 최소 간격 */
    todayPx: () => {
      const raw = this.g3d?.raw
      const pts = [...this.stars.values()].filter((s) => s.layer === 'today').map((s) => raw?.project(pos3(s)) ?? null).filter((p): p is [number, number] => !!p)
      let min = Infinity
      for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) min = Math.min(min, Math.hypot(pts[i]![0] - pts[j]![0], pts[i]![1] - pts[j]![1]))
      return { n: pts.length, minPx: Math.round(min * 10) / 10, ...todayInfo, pts: pts.map((p) => [Math.round(p[0]), Math.round(p[1])]) }
    },
    synthNotes: (n = 1000, m = 2000) => {
      const subj = ['s0', 's1', 's2', 's3', 's4', 's5']
      const cols = ['#7FB0FF', '#F2A65A', '#9BE38B', '#E58FB0', '#C9A2FF', '#5ED6C8']
      const notes = Array.from({ length: n }, (_, i) => ({ id: 'n' + i, subjectId: subj[i % 6]!, links: (i * 7) % 11 }))
      const links: Array<[string, string]> = Array.from({ length: m }, (_, i) => ['n' + (i % n), 'n' + ((i % n) + 1 + 37 * (1 + Math.floor(i / n))) % n])
      this.syncStars({ notes, noteLinks: links, subjects: subj.map((id, k) => ({ id, color: cols[k]! })) })
      return this.perfNotesMs
    },
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
    const g = this.g3d?.stats()
    if (g)
      return {
        fps: g.fps,
        tier: g.tier,
        tierAuto: this.tierSetting === 'auto',
        res: 1,
        megapixels: g.megapixels,
        jsMs: g.jsMs,
        p95: g.p95,
        renderer: 'galaxy3d',
        render: 'webgl2',
        mode: this.mode,
        running: g.power !== 'rest',
        paused: this.paused,
        view: [this.vw, this.vh],
      }
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

  /* ---------- M1 계약: 설정 시트 · 빈 하늘 드래그 · 앵커 ---------- */

  /** useSkySheet: 열려 있는 동안 노출 ×0.65 + 느리게, 비행 없음 */
  setSheet(id: number, open: boolean): void {
    if (open) this.sheets.add(id)
    else this.sheets.delete(id)
    this.g3d?.setSheet(this.preset === 'settings' || this.sheets.size > 0)
  }
  /** useSkyDrag: 마지막으로 선언한 화면의 값이 이긴다. 선언이 없으면 장소 기본값 */
  setDrag(id: number, enabled: boolean | null): void {
    this.drags.delete(id)
    if (enabled !== null) this.drags.set(id, enabled)
    this.g3d?.setDrag(this.dragEnabled())
  }
  private dragEnabled(): boolean {
    const v = [...this.drags.values()].pop()
    return v ?? DRAG_DEFAULT[this.preset] ?? false
  }
  /** 빈 하늘에서만 받는다 — 글·버튼·입력 위의 드래그·휠은 앱 것 */
  private dragFilter = (e: Event): boolean => {
    if (this.paused || this.overlay) return false
    const t = e.target
    if (!(t instanceof Element)) return true
    if (t.closest('[data-no-sky-drag]')) return false
    const sky = t.closest('[data-sky-drag]')
    if (e.type === 'wheel') return !!sky || t === document.body || t === document.documentElement
    if (sky) return true
    if (t.closest('a,button,input,textarea,select,label,summary,video,audio,iframe,[contenteditable=""],[contenteditable="true"],[role="button"],[role="slider"],[role="dialog"],[role="menu"],[role="listbox"],[draggable="true"]')) return false
    for (const n of Array.from(t.childNodes)) if (n.nodeType === 3 && (n.textContent ?? '').trim()) return false
    return true
  }
  /** useSkyAnchor: 은하의 화면 위치(CSS px). 3D만 정확하고, 2.5D 대체에서는 화면 비율 근사 */
  onAnchor(name: AnchorName, cb: (a: Anchor) => void): () => void {
    // 화면이 FieldProvider보다 먼저 구독할 수 있다(자식 effect가 먼저) → 여기서 받아 두고 3D가 붙으면 그 값으로 알린다
    let set = this.anchorCbs.get(name)
    if (!set) this.anchorCbs.set(name, (set = new Set()))
    set.add(cb)
    const last = this.anchorLast.get(name)
    if (last) cb(last)
    else if (this.host && !this.g3d) {
      const w = this.vw
      const h = this.vh
      cb(name === 'core' ? { x: w * 0.64, y: h * 0.42, r: h * 0.35, visible: true } : { x: w * 0.5, y: h * 0.46, r: Math.min(w, h) * 0.33, visible: this.preset === 'focus' })
    }
    return () => set!.delete(cb)
  }
  private anchorCbs = new Map<AnchorName, Set<(a: Anchor) => void>>()
  private anchorLast = new Map<AnchorName, Anchor>()
  /** useSkyClock: 집중 시계 (null이면 0.24°/s 공전) */
  setClock(c: { startedAt: number; durationMs: number; elapsedMs: number; paused: boolean } | null): void {
    this.g3d?.raw?.setClock(c)
  }
  /** 나의 가지 (#43): 별자리가 있던 지난 날 수. 새벽 4시가 날의 경계. 앱이 안 보일 때(시작·돌아옴)만 늘린다 — 보이는 이동 0 */
  private branchN = -1
  private branchDays(): number {
    if (this.branchN >= 0) return this.branchN
    const key = 'gyeol.sky.branch'
    const day = (d = new Date(Date.now() - 4 * 3600_000)) => d.toISOString().slice(0, 10)
    let st = { n: 0, last: '', had: false }
    try {
      st = { ...st, ...JSON.parse(localStorage.getItem(key) ?? '{}') }
    } catch {
      /* 저장소 없음 */
    }
    const today = day()
    if (st.last && st.last !== today && st.had) {
      st.n += 1
      st.had = false
      this.branchGlint = true
    }
    st.last = today
    const hasToday = [...this.stars.values()].some((s) => s.layer === 'today' && s.to > 0.01)
    st.had = st.had || hasToday
    try {
      localStorage.setItem(key, JSON.stringify(st))
    } catch {
      /* 무시 */
    }
    this.branchN = st.n
    return st.n
  }
  private branchGlint = false
/* ================= M2 하늘 사건 (design-m2 4-3 · 9 · 10) ================= */
  private notes = new Map<string, { subjectId: string; links: number; pos: [number, number, number]; s: number; level: number; size: number; color: [number, number, number] }>()
  private noteOrder: string[] = []
  private noteLinkSet = new Set<string>()
  private noteLinkPairs: Array<[string, string]> = []
  private segBuf = new Float32Array(0)
  private subjects = new Map<string, { color: [number, number, number]; k: number; bloomed: boolean }>()
  private noteArr = new Float32Array(0)
  private spineArr = new Float32Array(0)
  private stageArr: Float32Array | null = null
  /** 지도(노트 성운이 주인공)에서만 둘레 은하 별 ×0.6 */
  private applyStage(): void {
    this.g3d?.setStage((this.preset === 'map' || this.preset === 'graph') && this.mode !== 'off' ? this.stageArr : null)
  }
  private search: Set<string> | null = null
  private dusts: Array<{ id: string; subjectId?: string; t0: number; gone?: boolean; path?: { to: [number, number, number]; t0: number; dur: number }; fadeT0?: number }> = []
  private dustN = 0
  private nebulae = new Map<string, { t0: number; dur: number }>()
  private bloomQueue: Array<[string, string]> = []
  private bloomCalls: number[] = []
  private bloomTimer = 0
  private bloomBurst = false
  private drainBloom() {
    this.bloomTimer = 0
    const next = this.bloomQueue.shift()
    if (next) this.bloomNebula(next[0], next[1])
  }
  private nebTimer = 0

  /** 과목 없음(null · '' · '_none'): 지도 성운 한가운데 '과목 없음' 가지, 중립 흰빛 */
  private satOf(c: [number, number, number]): number {
    const mx = Math.max(c[0], c[1], c[2])
    const mn = Math.min(c[0], c[1], c[2])
    return mx > 0 ? (mx - mn) / mx : 0
  }
  private static NONE = { color: [0.86, 0.89, 1] as [number, number, number], k: -1, bloomed: false }
  private subjectOf(id: string | undefined | null): { color: [number, number, number]; k: number; bloomed: boolean } {
    if (!id || id === '_none') return FieldEngine.NONE
    let sj = this.subjects.get(id)
    if (!sj) {
      sj = { color: [0.86, 0.89, 1], k: this.subjects.size % 6, bloomed: false }
      this.subjects.set(id, sj)
    }
    return sj
  }
  /** 과목 가지 중심: 지도 성운 + 1.5u × 방향 k (6방향) */
  /** 과목 가지 중심: 지도 성운 + (1.5u + 가지 퍼짐) × 방향 k (6방향). 과목 없음(k −1)은 한가운데 */
  private branchCenter(k: number, spread = 0.5): [number, number, number] {
    const g = LANDMARKS.graph
    if (k < 0) return [g[0], g[1], g[2]]
    const a = (k / 6) * Math.PI * 2
    const d = 1.5 + Math.max(0, spread - 0.5)
    return [g[0] + d * Math.cos(a), g[1], g[2] + d * Math.sin(a)]
  }
  /** useSkyStars({ notes, noteLinks?, subjects? }) — 노트 별 자리는 id 해시로 고정, 정적 버퍼 1회 올리기 */
  private syncNotes(list: Array<{ id: string; subjectId: string; links: number }>, pairs?: Array<[string, string]>, subjects?: Array<{ id: string; color: string }>) {
    const t0 = performance.now()
    if (subjects) for (const sj of subjects) {
      const c = cssColor(sj.color)
      const rec = this.subjectOf(sj.id)
      if (c) rec.color = c
    }
    const perSubject = new Map<string, number>()
    for (const n of list) perSubject.set(n.subjectId, (perSubject.get(n.subjectId) ?? 0) + 1)
    // 노트 무대 조명(지도): 과목 성운마다 중심 · 반지름(둘레 2u + 퍼짐 σ) — 최대 8
    const stage: number[] = []
    for (const [sid, cnt] of perSubject) {
      if (stage.length >= 32) break
      const sg = Math.min(3, 0.5 + 0.06 * Math.sqrt(cnt))
      const c = this.branchCenter(this.subjectOf(sid).k, sg)
      stage.push(c[0], c[1], c[2], 2 + sg)
    }
    this.stageArr = stage.length ? new Float32Array(stage) : null
    this.applyStage()
    this.notes.clear()
    this.noteOrder = []
    for (const n of list) {
      const sj = this.subjectOf(n.subjectId)
      const cnt = perSubject.get(n.subjectId) ?? 1
      // 퍼짐: 노트 수에 따라 가지를 넓히고 팔 방향(바깥)으로 길게 — 1,000개여도 별 사이가 화면에서 몇 px 떨어지게
      const sig = Math.min(3, 0.5 + 0.06 * Math.sqrt(cnt))
      // 자리는 (id, 과목 가지, σ)에만 달려 있다 → 바뀌지 않았으면 다시 계산하지 않는다
      const ck = n.subjectId + '|' + sj.k + '|' + sig.toFixed(3)
      let pc = this.posCache.get(n.id)
      if (!pc || pc.key !== ck) {
        const h = hashStr(n.id)
        const h2 = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0
        const u1 = ((h & 0xffff) + 0.5) / 65536
        const u2 = (((h >>> 16) & 0xffff) + 0.5) / 65536
        const u3 = (h2 & 0xffff) / 65536
        const g1 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
        const g2 = Math.sqrt(-2 * Math.log(u1)) * Math.sin(2 * Math.PI * u2)
        const across = Math.min(1.2, 0.4 + 0.025 * Math.sqrt(cnt))
        const c = this.branchCenter(sj.k, sig)
        const a = sj.k < 0 ? 0 : (sj.k / 6) * Math.PI * 2
        const ux = Math.cos(a)
        const uz = Math.sin(a)
        const al = sj.k < 0 ? g1 * across : g1 * sig // 가지 방향(바깥)으로 σ, 옆으로 across
        const ac = g2 * across
        pc = { key: ck, pos: [c[0] + ux * al - uz * ac, c[1] + (u3 - 0.5) * 0.3, c[2] + uz * al + ux * ac], s: ((h2 >>> 16) / 65536) * 1.8 - 0.9 }
        this.posCache.set(n.id, pc)
      }
      const tL = Math.min(1, Math.log(1 + Math.max(0, n.links)) * 0.45512 /* 1 / ln 9 */)
      // 노트 별 = '내가 쓴 별': 과목색(채도 약 45%)을 띤다. 은하 별(흰·청백·금)과 색으로 구별. 과목 없음은 중립 흰빛
      const col = sj.color
      const lum = 0.3 * col[0] + 0.59 * col[1] + 0.11 * col[2]
      const color: [number, number, number] = sj.k < 0 ? [0.86, 0.89, 1] : [0.12 + 0.88 * (lum + (col[0] - lum) * 0.45 / Math.max(0.35, this.satOf(col))), 0.12 + 0.88 * (lum + (col[1] - lum) * 0.45 / Math.max(0.35, this.satOf(col))), 0.12 + 0.88 * (lum + (col[2] - lum) * 0.45 / Math.max(0.35, this.satOf(col)))]
      this.notes.set(n.id, { subjectId: n.subjectId, links: n.links, pos: pc.pos, s: pc.s, level: 0.35 + 0.45 * tL, size: 2.0 + 0.4 * tL, color }) // 하한 2.0px (review-m2)
      this.noteOrder.push(n.id)
    }
    if (pairs) {
      this.noteLinkSet.clear()
      this.noteLinkPairs = []
      for (const [a, b] of pairs) {
        const key = a < b ? a + '|' + b : b + '|' + a
        if (this.noteLinkSet.has(key)) continue
        this.noteLinkSet.add(key)
        this.noteLinkPairs.push([a, b])
      }
    }
    this.scheduleUpload(list.length)
    // 탄생을 기다리던 노트(birthStar가 먼저 온 것): 지금 V1s
    if (this.pendingBirths.size) {
      const now = performance.now()
      for (const [id, at] of this.pendingBirths) {
        const r = this.notes.get(id)
        if (r && now - at < 5000 && this.mode !== 'off') window.setTimeout(() => this.g3d?.sparkle(r.pos), 60)
        if (r || now - at >= 5000) this.pendingBirths.delete(id)
      }
    }
    this.perfNotesMs = performance.now() - t0
  }
  private perfNotesMs = 0
  private pendingBirths = new Map<string, number>()
  private lastPickNote: string | null = null
  private uploadIdle = 0
  /** 노트가 많으면(> 300) GPU 버퍼 다시 쌓기를 다음 유휴 시간으로 미룬다(최대 200ms) — 비행·입력 프레임을 지키려고 */
  private scheduleUpload(n: number) {
    const run = () => {
      this.uploadIdle = 0
      this.uploadNotes()
      this.uploadNoteLinks()
    }
    if (n <= 300 || typeof requestIdleCallback === 'undefined') return run()
    if (this.uploadIdle) return
    this.uploadIdle = requestIdleCallback(run, { timeout: 200 })
  }
  private posCache = new Map<string, { key: string; pos: [number, number, number]; s: number }>()
  private uploadNotes() {
    const g = this.g3d?.raw
    if (!g) return
    const n = this.noteOrder.length
    if (this.noteArr.length < n * 8) {
      this.noteArr = new Float32Array(n * 8)
      this.spineArr = new Float32Array(n * 8)
    }
    let i = 0
    const sel = this.selected
    // 밀도 상한: 별 하나의 세기 × min(1, 7/√N) — 30개 안팎이면 그대로, 1,000개면 ≈ 0.22. 고른 별·검색 결과는 예외
    const dens = Math.min(1, 7 / Math.sqrt(Math.max(1, n)))
    const lens = this.lens
    for (const id of this.noteOrder) {
      const r = this.notes.get(id)!
      // 하한: 노트 100개 이하면 별 하나가 최소 45% (처음 쓰는 학생에게 '내 별'이 분명히)
      let lv = n <= 100 ? Math.max(0.45, r.level * dens) : r.level * dens
      // 렌즈(과목 칩): 그 과목 노트 별 +30%, 나머지 ×0.4
      if (lens) lv *= r.subjectId === lens ? 1.3 : 0.4
      if (this.search) lv = this.search.has(id) ? Math.max(lv, r.level) * 1.25 : lv * 0.5
      if (sel && this.notes.has(sel)) lv = id === sel ? 1 : lv * 0.5
      const o = i * 8
      this.noteArr[o] = r.pos[0]
      this.noteArr[o + 1] = r.pos[1]
      this.noteArr[o + 2] = r.pos[2]
      this.noteArr[o + 3] = Math.min(1, lv)
      const gold = id === sel
      this.noteArr[o + 4] = gold ? GOLD[0] : r.color[0]
      this.noteArr[o + 5] = gold ? GOLD[1] : r.color[1]
      this.noteArr[o + 6] = gold ? GOLD[2] : r.color[2]
      this.noteArr[o + 7] = gold ? 3.2 : r.size
      this.spineArr[o + 2] = r.s
      this.spineArr[o + 3] = this.noteArr[o + 3]!
      this.spineArr[o + 4] = this.noteArr[o + 4]!
      this.spineArr[o + 5] = this.noteArr[o + 5]!
      this.spineArr[o + 6] = this.noteArr[o + 6]!
      this.spineArr[o + 7] = this.noteArr[o + 7]!
      i++
    }
    g.setNotes(this.noteArr, n, this.spineArr)
  }
  private segCount = 0
  /** onlyLast: 링크 하나를 더할 때 — 그 링크 토막만 뒤에 붙인다(전체 다시 계산 없음) */
  private uploadNoteLinks(onlyLast = false) {
    const g = this.g3d?.raw
    if (!g) return
    const all = this.noteLinkPairs
    const M = all.length
    const base = M <= 100 ? 0.18 : Math.min(0.14, 2.2 / Math.sqrt(Math.max(1, M))) // 링크 100개 이하: 1px · 18% (review-m2)
    if (onlyLast && M === 101) onlyLast = false // 18% → 14% 경계: 전부 다시
    if (onlyLast && (this.segCount + 8) * 12 > this.segBuf.length) onlyLast = false
    if (!onlyLast && this.segBuf.length < Math.max(1, M * 8) * 12) this.segBuf = new Float32Array(Math.ceil(Math.max(1, M * 8) * 12 * 1.25))
    const pairs = onlyLast ? all.slice(-1) : all
    const segs = this.segBuf
    let m = onlyLast ? this.segCount : 0
    const sel = this.selected && this.notes.has(this.selected) ? this.selected : null
    // 스칼라로만 계산(토막마다 배열을 만들지 않는다) — 1,000노트 · 2,000링크 전체 다시 쌓기도 짧게
    const put = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, al: number, r: number, gg: number, b: number) => {
      const o = m * 12
      segs[o] = ax
      segs[o + 1] = ay
      segs[o + 2] = az
      segs[o + 3] = al
      segs[o + 4] = bx
      segs[o + 5] = by
      segs[o + 6] = bz
      segs[o + 8] = r
      segs[o + 9] = gg
      segs[o + 10] = b
      m++
    }
    for (const [ia, ib] of pairs) {
      const A = this.notes.get(ia)
      const B = this.notes.get(ib)
      if (!A || !B) continue
      const dx = B.pos[0] - A.pos[0]
      const dz = B.pos[2] - A.pos[2]
      const len = Math.sqrt(dx * dx + dz * dz)
      let al = base * (len > 4 ? 0.5 : 1)
      if (sel) al = ia === sel || ib === sel ? 0.6 : 0.16 * (base / 0.14)
      const ca = this.subjectOf(A.subjectId).color
      const cb = this.subjectOf(B.subjectId).color
      // 두 끝 과목색을 흰빛과 30%씩 섞은 평균
      const r = 0.35 * (ca[0]! + cb[0]!) + 0.3
      const gg = 0.35 * (ca[1]! + cb[1]!) + 0.3
      const b = 0.35 * (ca[2]! + cb[2]!) + 0.3
      if (A.subjectId === B.subjectId) put(A.pos[0], A.pos[1], A.pos[2], B.pos[0], B.pos[1], B.pos[2], al, r, gg, b)
      else {
        // 다른 과목: 원반 위로 휜 호 (가운데 y + 0.15 × 길이, 최대 0.6u). 토막 6개(화면에서 8개와 구별되지 않고 정점은 25% 적다)
        const lift = Math.min(0.6, 0.15 * len)
        const dy = B.pos[1] - A.pos[1]
        let px = A.pos[0]
        let py = A.pos[1]
        let pz = A.pos[2]
        for (let k = 1; k <= 6; k++) {
          const t = k / 6
          const qx = A.pos[0] + dx * t
          const qy = A.pos[1] + dy * t + lift * 4 * t * (1 - t)
          const qz = A.pos[2] + dz * t
          put(px, py, pz, qx, qy, qz, al, r, gg, b)
          px = qx
          py = qy
          pz = qz
        }
      }
    }
    this.segCount = m
    g.setNoteLinks(segs, m)
  }
  private applyNoteView() {
    const g = this.g3d?.raw
    if (!g) return
    const p = this.preset
    const map = p === 'map' || p === 'graph'
    g.setNoteView(map || p === 'notes' ? 1 : 0, map ? (this.search ? 0.5 : 1) : 0)
  }
  /** D1 메모 저장: 나의 자리 둘레 별가루 한 점 */
  dust(o: { id: string; subjectId?: string }): void {
    if (!this.dusts.some((d) => d.id === o.id)) this.dusts.push({ id: o.id, subjectId: o.subjectId, t0: this.nowS() })
    this.dustN = Math.max(this.dustN, this.dusts.filter((d) => !d.gone).length)
    this.pushStars()
  }
  /** D2 별가루 수 (보이는 점은 min(n, 24)) */
  setDust(n: number): void {
    this.dustN = Math.max(0, Math.round(n))
    this.pushStars()
  }
  /** D3–D5 나누기: 노트로(그 과목 성운 쪽으로 흘러감) · 할 일로(반짝 → 사라짐) · 보관(사라짐) */
  fileDust(id: string, subjectId: string | null, to: 'note' | 'task' | 'archive' = 'note'): void {
    const d = this.dusts.find((x) => x.id === id) ?? { id, t0: this.nowS() - 10 }
    if (!this.dusts.includes(d)) this.dusts.push(d)
    const t = this.nowS()
    const off = this.mode === 'off'
    if (to === 'note') {
      d.path = { to: this.branchCenter(this.subjectOf(subjectId).k), t0: t, dur: off ? 0.001 : 1.2 }
      d.fadeT0 = t + (off ? 0 : 1.2)
    } else if (to === 'task') {
      if (!off) this.g3d?.sparkle(this.dustPos(d))
      d.fadeT0 = t + (off ? 0 : 0.3)
    } else d.fadeT0 = t
    d.gone = true
    this.dustN = Math.max(0, this.dustN - 1)
    this.pushStars()
    window.setTimeout(() => {
      this.dusts = this.dusts.filter((x) => x !== d)
      this.pushStars()
    }, 2000)
  }
  private dustPos(d: { id: string }, pinned = !!this.pins.get(d.id)?.on): [number, number, number] {
    // FNV 해시는 끝 글자만 다른 id('dust:0'…'dust:9')에서 위 16비트가 거의 같아 점이 한 방향으로 뭉쳤다 → 섞어서 쓴다
    let h = hashStr(d.id)
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0
    h = (h ^ (h >>> 16)) >>> 0
    const c = LANDMARKS.focus
    const r = pinned ? 1.5 : 1.5 + 0.8 * ((h & 0xffff) / 65536) // 별자리(1.4u) 바깥 고리 · 고정한 점은 고리 안쪽 자리
    const a = (((h >>> 16) & 0xffff) / 65536) * Math.PI * 2
    const q: [number, number, number] = [c[0] + r * Math.cos(a), c[1] + 0.2, c[2] + r * Math.sin(a)]
    // 오늘의 별자리 별에서 화면 18px 이상: 세계 거리 DUST_GAP(오늘 장소 기준)보다 가까우면 바깥으로 민다
    for (let it = 0; it < 2; it++)
      for (const st of this.stars.values()) {
        if (st.layer !== 'today') continue
        const P = pos3(st)
        const dx = q[0] - P[0]
        const dz = q[2] - P[2]
        const dd = Math.hypot(dx, dz)
        if (dd >= DUST_GAP) continue
        const ux = dd > 1e-4 ? dx / dd : Math.cos(a)
        const uz = dd > 1e-4 ? dz / dd : Math.sin(a)
        q[0] = P[0] + ux * DUST_GAP
        q[2] = P[2] + uz * DUST_GAP
      }
    return q
  }
  /** D8 검색: 앞 12개 반짝(40ms 간격) 뒤 결과 +25% · 나머지 별·선 ×0.5로 고정. []이면 원래대로 */
  /** M3 K1 '잉크가 별이 된다' (design-ink 10장): 노트를 닫을 때 그 노트 별이 V11로 반짝인다.
   *  쪽(pages, 새로 다 쓴 쪽) 0–2: +40% 300ms · 3 이상: +60% 450ms (동작 줄이기: 밝기만 300ms).
   *  지도: 그 노트 별 · 노트 장소: 책등 위 그 노트 점. 다른 장소에서는 사건 없이 최종 상태만(노트 데이터가 정한다) */
  inkSettled(noteId: string, o?: { pages?: number }): void {
    const p = this.preset
    if (!this.notes.has(noteId) || !(p === 'map' || p === 'graph' || p === 'notes')) return
    const big = (o?.pages ?? 0) >= 3
    const dur = this.mode === 'off' ? 0.3 : big ? 0.45 : 0.3
    this.inks.set(noteId, { t0: this.nowS(), k: big ? 0.6 : 0.4, dur })
    this.pushStars()
    window.setTimeout(() => this.pushStars(), dur * 300 + 10)
    window.setTimeout(() => this.pushStars(), dur * 1000 + 20)
  }
  /** 반짝 한 번의 모양: 앞 30% 오르고 뒤 70% 내려온다 */
  private inkShape(id: string, t: number): { from: number; to: number; t0: number; dur: number } | null {
    const e = this.inks.get(id)
    const r = this.notes.get(id)
    if (!e || !r || t - e.t0 >= e.dur) {
      this.inks.delete(id)
      return null
    }
    const n = this.notes.size
    const dens = Math.min(1, 7 / Math.sqrt(Math.max(1, n)))
    const amp = e.k * (n <= 100 ? Math.max(0.45, r.level * dens) : r.level * dens)
    const up = e.dur * 0.3
    return t - e.t0 < up ? { from: 0, to: amp, t0: e.t0, dur: up } : { from: amp, to: 0, t0: e.t0 + up, dur: e.dur - up }
  }
  /** 노트 장소: 책등 위 그 노트 점의 반짝 (엔진 spineDots가 같은 공식으로 자리를 잡는다) */
  private inkSpine(): Array<{ id: string; s: number; level: number; color: [number, number, number]; from: number; to: number; t0: number; dur: number; size: number }> {
    const out: Array<{ id: string; s: number; level: number; color: [number, number, number]; from: number; to: number; t0: number; dur: number; size: number }> = []
    const t = this.nowS()
    for (const id of [...this.inks.keys()]) {
      const sh = this.inkShape(id, t)
      const r = this.notes.get(id)
      if (sh && r) out.push({ id: 'ink:' + id, s: r.s, level: sh.to, color: r.color, ...sh, size: r.size })
    }
    return out
  }
  /** K6 메모 고정 (design-ink 8-5): 고정한 별가루 점은 고리 안쪽 자리에 멈추고(표류 0) 55 → 60%, 고정하는 순간 V11(+40%, 300ms).
   *  풀면 원래 고리 자리로 돌아가고 표류가 1초 램프로 돌아온다 */
  pinDust(id: string, on: boolean): void {
    if (!!this.pins.get(id)?.on === on) return
    if (on && !this.dusts.some((d) => d.id === id && !d.gone)) this.dusts.push({ id, t0: -1e9 }) // 점 기록이 없으면(앱을 다시 연 뒤) 이미 있던 점으로
    this.pins.set(id, { on, t: this.mode === 'off' ? -1e9 : this.nowS() })
    this.pushStars()
    if (this.mode !== 'off') window.setTimeout(() => this.pushStars(), 1100)
  }
  private pins = new Map<string, { on: boolean; t: number }>()
  /** K0 종이 펼침 (useSkyPaper): 붙잡은 수가 0보다 크면 펼침 */
  paperHold(): () => void {
    this.paperN++
    this.g3d?.setPaper(true)
    let done = false
    return () => {
      if (done) return
      done = true
      this.paperN = Math.max(0, this.paperN - 1)
      this.g3d?.setPaper(this.paperN > 0)
    }
  }
  private paperN = 0
  private inks = new Map<string, { t0: number; k: number; dur: number }>()
  glintNotes(ids: string[]): void {
    this.search = ids.length ? new Set(ids) : null
    if (ids.length && this.mode !== 'off' && this.theme !== 'light')
      ids.slice(0, 12).forEach((id, i) => {
        const r = this.notes.get(id)
        if (r) window.setTimeout(() => this.g3d?.sparkle(r.pos), i * 40)
      })
    this.uploadNotes()
    this.applyNoteView()
  }
  /** D9 성운 피기 (순간 ①): 과목 가지 중심에 반지름 0.9u, 22% → 12%로 쉼. 젊은 별 3–5개 V1s. 카메라는 그대로 */
  bloomNebula(subjectId: string, color: string): void {
    // 큰 사건 대기열 (design-m2 D9): 동시 1개. 짧게 몰려 오면(샘플) 4개까지 겹치고 절제판 800ms
    const now = performance.now()
    this.bloomCalls = this.bloomCalls.filter((t) => now - t < 1500)
    this.bloomCalls.push(now)
    const burst = this.bloomCalls.length >= 3
    const busy = [...this.nebulae.values()].filter((n) => this.nowS() - n.t0 < n.dur).length
    if (this.mode !== 'off' && busy >= (burst ? 4 : 1)) {
      this.bloomQueue.push([subjectId, color])
      if (!this.bloomTimer)
        this.bloomTimer = window.setTimeout(() => {
          this.bloomTimer = 0
          const next = this.bloomQueue.shift()
          if (next) this.bloomNebula(next[0], next[1])
          if (this.bloomQueue.length && !this.bloomTimer) this.bloomTimer = window.setTimeout(() => this.drainBloom(), 250)
        }, burst ? 250 : 1600)
      return
    }
    this.bloomBurst = burst
    const sj = this.subjectOf(subjectId)
    const c = cssColor(color)
    if (c) {
      const l = 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]
      sj.color = [l + (c[0] - l) * 0.8, l + (c[1] - l) * 0.8, l + (c[2] - l) * 0.8] // 채도 −20%
    }
    sj.bloomed = true
    this.nebulae.set(subjectId, { t0: this.mode === 'off' ? -1e9 : this.nowS(), dur: this.bloomBurst ? 0.8 : 1.6 })
    if (this.mode !== 'off') {
      const cen = this.branchCenter(sj.k)
      const n = 3 + (hashStr(subjectId) % 3)
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + 0.7
        window.setTimeout(() => this.g3d?.sparkle([cen[0] + 0.35 * Math.cos(a), cen[1] + 0.05, cen[2] + 0.35 * Math.sin(a)]), 150 * i + 200)
      }
    }
    this.uploadNotes()
    this.pushStars()
  }
  /** D10 은하 보이기: 회전 0, 물러나기만 2.6초 (동작 줄이기·회전 끔이면 즉시) */
  revealGalaxy(): Promise<void> {
    const ms = this.g3d?.raw?.revealGalaxy() ?? 0
    this.preset = 'today'
    this.applyNoteView()
    return new Promise((res) => window.setTimeout(res, ms))
  }
  /** D11 가져오기 끝: 새 노트 별 앞 12개만 V1s(80ms 간격), 나머지는 최종 상태 */
  importNotes(ids: string[]): void {
    if (this.mode === 'off') return
    ids.slice(0, 12).forEach((id, i) => {
      const r = this.notes.get(id)
      if (r) window.setTimeout(() => this.g3d?.sparkle(r.pos), i * 80)
    })
  }
  /** M2 하늘 사건이 더한 데이터 별(별가루 · 성운) — pushStars가 합친다 */
  private m2Stars(): DataStar[] {
    const out: DataStar[] = []
    const p = this.preset
    const t = this.nowS()
    // 별가루: T · F · R(×0.5) · S, 최대 24점 45%
    const dustVis = p === 'today' || p === 'landing' || p === 'focus' || p === 'settings' ? 1 : p === 'review' ? 0.5 : 0
    if (dustVis > 0 || this.dusts.some((d) => d.path)) {
      // 고정한 점은 늘 보인다(24점 안에서 먼저)
      const alive = this.dusts.filter((d) => !d.gone)
      const pinnedLive = alive.filter((d) => this.pins.get(d.id)?.on)
      const live = [...pinnedLive, ...alive.filter((d) => !this.pins.get(d.id)?.on).slice(-Math.max(0, 24 - pinnedLive.length))].slice(0, 24)
      const extra = Math.max(0, Math.min(24, this.dustN) - live.length)
      const all: Array<{ id: string; subjectId?: string; t0: number; path?: { to: [number, number, number]; t0: number; dur: number }; fadeT0?: number }> = [...live, ...this.dusts.filter((d) => d.gone)]
      for (let k = 0; k < extra; k++) all.push({ id: 'dust:' + k, t0: -1e9 })
      for (const d of all) {
        const sj = this.subjects.get(d.subjectId ?? '')
        const W: [number, number, number] = [0.929, 0.906, 0.855]
        const col: [number, number, number] = sj ? [W[0] * 0.8 + sj.color[0] * 0.2, W[1] * 0.8 + sj.color[1] * 0.2, W[2] * 0.8 + sj.color[2] * 0.2] : W
        const vis = d.path ? 1 : dustVis
        const h = hashStr(d.id)
        const fading = d.fadeT0 !== undefined
        const fresh = !fading && !d.path && t - d.t0 < 3 && t - d.t0 >= 0
        const pin = this.pins.get(d.id)
        const pk = pin ? t - pin.t : 1e9 // 고정·풀기 뒤 지난 초
        const pinned = !!pin?.on && !fading && !d.path
        if (pinned) {
          // K6: 고리 안쪽 자리 · 표류 0 · 60%, 고정하는 순간 +40% 300ms
          out.push({
            id: 'dust:' + d.id,
            group: 'dust',
            pos: this.dustPos(d, true),
            L: 1,
            color: col,
            size: 1.6,
            from: pk < 0.3 ? 0.84 * vis : 0.6 * vis,
            to: 0.6 * vis,
            t0: pk < 0.3 ? pin!.t : 0,
            dur: pk < 0.3 ? 0.3 : 0,
            move: pk < 0.6 ? { from: this.dustPos(d, false), t0: pin!.t, dur: 0.6 } : undefined,
          })
          continue
        }
        const unpinned = !!pin && !pin.on && pk < 1.2
        out.push({
          id: 'dust:' + d.id,
          group: 'dust',
          pos: this.dustPos(d),
          ...(unpinned ? { driftAt: pin!.t, move: pk < 0.6 ? { from: this.dustPos(d, true), t0: pin!.t, dur: 0.6 } : undefined } : {}),
          L: 1,
          color: col,
          size: d.path ? 2 : 1.6,
          // 1.6px · 55% (review-m2). 새 점은 처음 3초 85% → 55%로 내려앉아 저장 전후가 구별된다
          from: fading ? 0.55 * vis : fresh ? 0.85 * vis : 0,
          to: fading ? 0 : 0.55 * vis,
          t0: fading ? d.fadeT0! : d.t0,
          dur: fading ? 0.6 : this.mode === 'off' ? 0 : fresh ? 3 : 0.6,
          drift: ((h >>> 3) % 628) / 100,
          path: d.path,
        })
      }
    }
    // 고른 노트 별: 노트 층(35%에서 잘림) 밖에서 금빛 3.2px로 따로 — 예외로 밝게
    if ((p === 'map' || p === 'graph') && this.selected && this.notes.has(this.selected))
      out.push({ id: 'selnote:' + this.selected, group: 'nebula', pos: this.notes.get(this.selected)!.pos, L: 1, color: GOLD, size: 3.2, from: 1, to: 1, t0: 0, dur: 0 })
    // M3 K1 잉크가 별이 된다(지도): 노트 별 위에 사건 층으로 더한다(노트 층 상한 밖)
    if (p === 'map' || p === 'graph')
      for (const id of [...this.inks.keys()]) {
        const sh = this.inkShape(id, t)
        const r = this.notes.get(id)
        if (sh && r) out.push({ id: 'ink:' + id, group: 'nebula', pos: r.pos, L: 1, color: r.color, size: r.size, ...sh })
      }
    // 과목 성운: 첫 실행 · 지도 · 오늘
    const nebVis = p === 'onboarding' || p === 'map' || p === 'graph' || p === 'today' || p === 'landing'
    if (nebVis)
      for (const [id, nb] of this.nebulae) {
        const sj = this.subjects.get(id)
        if (!sj) continue
        const k = (t - nb.t0) * (1.6 / nb.dur) // 절제판(800ms)은 같은 곡선을 두 배 빠르게
        // 쉬는 밝기 16% · 핀 반지름 1.1u · 채도 −10% (review-m2: 12%에서는 분홍 HII와 구별되지 않았다)
        const lv = k < 0.6 ? 0.22 * (1 - Math.pow(1 - k / 0.6, 3)) : k < 1.6 ? 0.22 - 0.06 * (0.5 - 0.5 * Math.cos(Math.PI * (k - 0.6))) : 0.16
        const nl = 0.3 * sj.color[0] + 0.59 * sj.color[1] + 0.11 * sj.color[2]
        const ncol: [number, number, number] = [nl + (sj.color[0] - nl) * 0.9, nl + (sj.color[1] - nl) * 0.9, nl + (sj.color[2] - nl) * 0.9]
        out.push({ id: 'neb:' + id, group: 'nebula', pos: this.branchCenter(sj.k), L: 1, color: ncol, wr: 1.1 * Math.min(1, k / 0.6 + 0.001), from: lv, to: k < 1.6 ? 0.16 : lv, t0: t, dur: k < 1.6 ? (1.6 - k) * (nb.dur / 1.6) : 0 })
        if (k < 1.6 && !this.nebTimer)
          this.nebTimer = window.setTimeout(() => {
            this.nebTimer = 0
            this.pushStars()
          }, 120)
      }
    return out
  }
  /** 3D 엔진 (검증·측정용) */
  galaxy3d(): Galaxy3D | null {
    return this.g3d
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
