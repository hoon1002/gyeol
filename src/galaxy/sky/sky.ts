/**
 * 은하수 렌더러 — 캔버스 1개, rAF 루프 1개. (design-v3 §2·§5, design-v3-motion §0·§3)
 *
 * 정적 하늘(바탕 빛·헤이즈·몸통·코어·암흑대·성운·3·4등급 별 수만 개)은 앱 시작·화면 크기 변경 때만
 * 선형 HDR 층(L0 띠 빛 + 먼지, L1 별빛)으로 굽는다. 굽기는 여러 프레임에 나눠(띠 조각) 긴 프레임을 만들지 않는다.
 * 장면(노출·보이는 별·색조·안전 구역)은 매 프레임 PRESENT 유니폼이다 → 화면 전환에 굽기 0회.
 * 매 프레임은 층 2장 + 0~2등급 별(반짝임은 8%만, 밝기만) + 별가루(≤ 10px/s) + 드문 유성만 그린다.
 * 멀미 안전: 화면 전체 회전·확대·패럴랙스·왜곡 없음. 움직이는 것은 서로 떨어진 작은 점뿐.
 */
import { bandFrame, pickComposition, type Composition, type SceneName } from './compositions'
import { DYN_L, dustCount, makeDust, makeStars, STRIDE, type StarSets } from './starfield'
import * as SH from './shaders'

export type Tier = 'A' | 'B' | 'C'

export interface SpecialStar {
  /** 화면 비율 */
  x: number
  y: number
  L: number
  color: [number, number, number]
  /** 'birth': t0부터 2.4초 동안 태어남 / 'relight': t0부터 30→100% / 'focus': 밝기 = 집중 진행률 / 'still': 그대로 / 'anim': from→to */
  mode: 'birth' | 'relight' | 'focus' | 'still' | 'anim'
  /** sky.now() 기준 초 */
  t0?: number
  /** 'anim': 밝기 배수 from → to, dur초 */
  from?: number
  to?: number
  dur?: number
  /** 피어남 연출: 'big' = V1(할로 + 회절 1.2초), 'small' = V1s(작은 할로) */
  burst?: 'big' | 'small'
}

export interface SkyStats {
  fps: number
  tier: Tier
  res: number
  megapixels: number
  stars: number
  bright: number
  dust: number
  bakeMs: number
  bakes: number
  /** 다 구운 장소 타일 수 (유휴 시간) */
  tiles: number
  memMB: number
  hdr: boolean
  jsMs: number
  p95: number
  renderer: string
  running: boolean
}

/** 장면 바깥에서 덧씌우는 값 (앱 공간별 노출 등) */
export type LookOverride = Partial<Pick<Composition, 'bright' | 'starExpo' | 'faint' | 'dynCut' | 'blue' | 'airglow' | 'fall' | 'meteors'>>

const TIER: Record<Tier, { scale: number; maxPx: number; density: number; faint: number; cap: number }> = {
  A: { scale: 1.0, maxPx: 5.2e6, density: 0.12, faint: 1, cap: 0 },
  B: { scale: 0.75, maxPx: 2.8e6, density: 0.09, faint: 0.6, cap: 1000 / 60 },
  // C: 정지 이미지 (v3 §2-3) — 바뀔 때만 한 장 그린다
  C: { scale: 0.6, maxPx: 1.5e6, density: 0.07, faint: 0.6, cap: 1000 / 30 },
}
const BUDGET: Record<Tier, number> = { A: 1000 / 120, B: 1000 / 60, C: 1000 / 30 }
const LOWER: Record<Tier, Tier | null> = { A: 'B', B: 'C', C: null }
const DATA_FADE = 0.6
const STRIPS = 8 // 합성 굽기를 몇 프레임에 나눌지
const LAYER_FADE = 300
const SPECIAL_STRIDE = 12
/* 카메라 (team/camera-brief.md): 굽기 틀은 화면보다 사방 12% 넓다(줌 0.85까지). 텍셀 = 장치 px의 0.85배 → 메모리 절약 */
const MARGIN = 0.12
const BAKE_SCALE = 0.85
const BAKE_K = 1 / (1 + 2 * MARGIN)
export const ZOOM_MIN = 0.85
export const ZOOM_MAX = 3.2
export interface Cam {
  x: number
  y: number
  z: number
}
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

interface Prog {
  p: WebGLProgram
  u: Record<string, WebGLUniformLocation | null>
}
interface Target {
  fb: WebGLFramebuffer
  tex: WebGLTexture[]
  w: number
  h: number
}
interface Layer {
  t: Target
  comp: Composition
}
interface BakeJob {
  w: number
  h: number
  res: number
  comp: Composition
  S: Target
  B1: Target
  B2: Target
  out: Target
  step: number
  ms: number
}
interface SpecialSet {
  vao: WebGLVertexArrayObject
  buf: WebGLBuffer
  count: number
  t0: number
}

function guessTier(renderer: string): Tier {
  const r = renderer.toLowerCase()
  if (/swiftshader|llvmpipe|software/.test(r)) return 'C'
  if (/apple m\d|apple gpu|nvidia|geforce|rtx|radeon|amd/.test(r)) return 'A'
  if (/intel|mali|adreno|powervr|uhd|iris/.test(r)) return 'B'
  return (navigator.hardwareConcurrency || 4) >= 8 ? 'A' : 'B'
}

/** cubic-bezier(.4, 0, .2, 1) 근사 — SKY_TIMING.ease와 같은 곡선 (Hermite로 속도 이어 받기) */
function stdEase(t: number): number {
  // 뉴턴법으로 x(t) = t를 푼다
  const cx = 3 * 0.4
  const bx = 3 * (0.2 - 0.4) - cx
  const ax = 1 - cx - bx
  const cy = 0
  const by = 3 * 1 - cy
  const ay = 1 - cy - by
  let u = t
  for (let i = 0; i < 6; i++) {
    const x = ((ax * u + bx) * u + cx) * u - t
    const d = (3 * ax * u + 2 * bx) * u + cx
    if (Math.abs(d) < 1e-6) break
    u -= x / d
  }
  u = Math.min(1, Math.max(0, u))
  return ((ay * u + by) * u + cy) * u
}

const LOOK_KEYS = ['bright', 'starExpo', 'faint', 'blue', 'airglow', 'fall'] as const

export class Sky {
  private gl: WebGL2RenderingContext
  private hdr = false
  private progs: Record<string, Prog> = {}
  private progsReady = false
  private pendingProgs: Array<{ name: string; p: WebGLProgram; uniforms: string[] }> = []
  private parallel: { COMPLETION_STATUS_KHR: number } | null = null
  private vaoEmpty: WebGLVertexArrayObject
  private vaoDim: WebGLVertexArrayObject | null = null
  private vaoBright: WebGLVertexArrayObject | null = null
  private vaoDust: WebGLVertexArrayObject | null = null
  private bufs: WebGLBuffer[] = []
  private lastBuf: WebGLBuffer | null = null
  private stars: StarSets | null = null
  private dustN = 0
  private specials: SpecialSet[] = []
  private specialList: SpecialStar[] = []
  private P: Target | null = null
  private layer: Layer | null = null
  private prevLayer: Layer | null = null
  private layerT0 = -1e9
  private job: BakeJob | null = null
  private jobQueued = false
  /* 장면 노출: from → to (450ms, 이어 받기) */
  private compTo: Composition | null = null
  private compFrom: Composition | null = null
  private xT0 = -1e9
  private xDur = 450
  private xHold = false
  private xVel = 0
  private scene: SceneName = 'hero'
  private look: LookOverride = {}
  readonly renderer: string

  private cssW = 1
  private cssH = 1
  private res = 1
  private resOverride = 0
  private tier: Tier = 'A'
  private tierAuto = true
  private raf = 0
  private running = false
  private lastFrame = 0
  private epoch = performance.now()
  /* 움직임 시계: 프레임마다 최대 20ms만 나아간다 → 앱이 메인 스레드를 잠깐 막아도 비행·노출이 건너뛰지 않는다 */
  private clk = performance.now()
  private clkReal = performance.now()
  private reduced = false
  private freezeAt: number | null = null
  private pauseReal = 0
  private meteorsOn = true
  private ptr = { x: -1, y: -1, t: -1e9, r: 120, k: 0, lastT: 0 }
  private taps: Array<{ x: number; y: number; t0: number; a: number }> = []
  private met = { t0: -1e9, dur: 0.75, x: 0, y: 0, dx: 0, dy: 1, len: 100, next: 0, forced: false, peak: 0.7 }
  private focus = 0
  private seed: number
  private bakeMs = 0
  private bakes = 0
  private jsMs = 0
  private fps = 0
  private fpsN = 0
  private fpsT = 0
  private samples: number[] = []
  private measured = false
  private winStart = 0
  private p95 = 0
  private destroyed = false
  private lost = false
  /* 겹친 창 감광(V12)·띠 부풂(V13)·플레이트(낮) */
  private gain = { from: 1, to: 1, t0: -1e9, dur: 200 }
  private swell = { t0: -1e9, amt: 0, dur: 2000 }
  private plate = { from: 0, to: 0, t0: -1e9, dur: 680 }
  private tint: [number, number, number] = [1, 1, 1]
  private fl = { from: { x: 0.5, y: 0.5, z: 1 } as Cam, to: { x: 0.5, y: 0.5, z: 1 } as Cam, t0: -1e9, dur: 1000, v0: 0 }
  private camU = new Float32Array([0.5, 0.5, 1, 0])
  private bakeU = new Float32Array([0.5, 0.5, BAKE_K, 0])
  private dustHold = false
  onStats?: (s: SkyStats) => void
  /** 프레임마다 (간격 ms, 이 프레임 JS ms) — 계측용 */
  onFrame?: (interval: number, js: number) => void
  /** 처음 그림이 화면에 나간 뒤 1번 */
  onFirstFrame?: () => void
  private firstDone = false

  constructor(
    private canvas: HTMLCanvasElement,
    opts: { seed?: number; tier?: Tier | 'auto'; reduced?: boolean; meteors?: boolean; freeze?: number | null } = {},
  ) {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false })
    if (!gl) throw new Error('webgl2-unavailable')
    this.gl = gl
    this.hdr = !!gl.getExtension('EXT_color_buffer_float')
    this.parallel = gl.getExtension('KHR_parallel_shader_compile') as { COMPLETION_STATUS_KHR: number } | null
    this.seed = opts.seed ?? 1016
    this.reduced = !!opts.reduced
    this.meteorsOn = opts.meteors ?? true
    this.freezeAt = opts.freeze ?? null
    let ren = ''
    try {
      const ext = gl.getExtension('WEBGL_debug_renderer_info')
      ren = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER))
    } catch {
      /* 무시 */
    }
    this.renderer = ren
    if (opts.tier && opts.tier !== 'auto') {
      this.tier = opts.tier
      this.tierAuto = false
    } else this.tier = guessTier(ren)
    this.vaoEmpty = gl.createVertexArray()!
    this.buildPrograms()
    canvas.addEventListener('webglcontextlost', this.onLost)
    canvas.addEventListener('webglcontextrestored', this.onRestored)
    document.addEventListener('visibilitychange', this.onVis)
    this.scheduleMeteor(performance.now(), true)
  }

  /* ---------- 공개 ---------- */

  now(): number {
    return this.freezeAt ?? (performance.now() - this.epoch) / 1000
  }

  /** 움직임 시계(ms) */
  private ct(): number {
    return this.clk + Math.min(20, performance.now() - this.clkReal)
  }

  /**
   * 장면 바꾸기 — 굽지 않는다. 노출·별 한계·색조·안전 구역을 durMs 동안 보간(이어 받기).
   * hold 중이면 releaseTransition() 때 시작한다(UI와 같은 프레임).
   */
  setScene(scene: SceneName, instant = false, look?: LookOverride, durMs = 450): void {
    const lookKey = JSON.stringify(look ?? {})
    if (scene === this.scene && this.compTo && lookKey === JSON.stringify(this.look)) return
    this.scene = scene
    this.look = look ?? {}
    const comp = this.pick()
    if (!this.compTo || instant || this.isStill()) {
      this.compTo = comp
      this.compFrom = null
      this.xT0 = -1e9
      this.xVel = 0
    } else {
      const now = this.ct()
      // 지금 보이는 값을 출발점으로 (속도 이어 받기)
      const { k, v } = this.mixState(now)
      this.compFrom = this.compFrom && k < 1 ? this.lerpComp(this.compFrom, this.compTo, k) : this.compTo
      this.xVel = k < 1 ? v * (1 - k) : 0
      this.compTo = comp
      this.xDur = durMs
      this.xT0 = this.xHold ? 1e12 : now
    }
    this.plateTarget()
    this.kick(true)
  }

  /** UI 전환과 하늘 전환을 같은 프레임에 시작하려고 잠깐 붙잡는다 */
  holdTransition(on: boolean): void {
    this.xHold = on
    if (!on) {
      const now = this.ct()
      if (this.xT0 > 1e11) this.xT0 = now
      if (this.fl.t0 > 1e11) this.fl.t0 = now
      this.kick()
    }
  }

  /** resOverride: 장면 이미지용 — css px당 내부 px를 고정(예: 2 = @2x, 3 = @3x) */
  resize(cssW: number, cssH: number, resOverride = 0): void {
    const same = this.layer && Math.round(cssW) === Math.round(this.cssW) && Math.round(cssH) === Math.round(this.cssH) && resOverride === this.resOverride
    this.cssW = Math.max(1, cssW)
    this.cssH = Math.max(1, cssH)
    this.resOverride = resOverride
    const t = TIER[this.tier]
    let res: number
    if (resOverride > 0) res = resOverride
    else {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      res = dpr * t.scale
      if (this.cssW * this.cssH * res * res > t.maxPx) res = Math.sqrt(t.maxPx / (this.cssW * this.cssH))
      res = Math.max(0.5, res)
    }
    if (same && Math.abs(res - this.res) < 1e-3) return
    this.res = res
    const W = Math.round(this.cssW * res)
    const H = Math.round(this.cssH * res)
    this.canvas.width = W
    this.canvas.height = H
    if (this.P) this.dropTarget(this.P)
    this.P = null
    this.buildStars()
    const comp = this.pick()
    if (this.compFrom) this.compFrom = { ...comp, ...this.lookOf(this.compFrom), safe: this.compFrom.safe }
    this.compTo = comp
    this.startBake(W, H, res)
    for (const t of this.tiles) {
      this.dropTarget(t.t)
      t.t = null
      t.step = 0
    }
    this.kick(true)
  }

  setReduced(on: boolean): void {
    if (on === this.reduced) return
    this.reduced = on
    if (on) {
      this.compFrom = null
      this.xT0 = -1e9
    }
    this.kick(true)
  }

  setMeteors(on: boolean): void {
    this.meteorsOn = on
  }

  setTier(t: Tier | 'auto'): void {
    this.tierAuto = t === 'auto'
    const next = t === 'auto' ? guessTier(this.renderer) : t
    this.measured = false
    this.samples = []
    this.pendingTier = null
    this.autoDowngraded = false
    if (next !== this.tier) {
      this.tier = next
      this.resize(this.cssW, this.cssH, this.resOverride)
    }
  }

  pointer(x: number, y: number, type = 'mouse'): void {
    this.ptr.x = x
    this.ptr.y = y
    this.ptr.t = performance.now()
    this.ptr.r = type === 'pen' ? 80 : 120
    this.kick()
  }

  pointerLeave(): void {
    this.ptr.t = -1e9
  }

  /** 누른 자리 별빛이 잠깐 밝아졌다 사라진다 (고리·물결·빛 번짐 없음, 별의 밝기만) */
  tap(x: number, y: number, strength = 1): void {
    if (this.isStill()) return
    const t0 = this.now()
    this.taps = this.taps.filter((p) => t0 - p.t0 < 1.8)
    this.taps.push({ x, y, t0, a: strength })
    while (this.taps.length > 4) this.taps.shift()
    this.kick()
  }

  setFocus(progress: number): void {
    this.focus = Math.max(0, Math.min(1, progress))
    if (!this.running) this.kick(true)
  }

  /** 데이터 별 — 바뀌면 600ms 크로스페이드 (같은 별은 밝기 그대로) */
  setSpecial(list: SpecialStar[], fade = true): void {
    this.specialList = list
    if (!this.progsReady) return
    const set = this.uploadSpecial(list)
    const live = fade && !this.isStill()
    set.t0 = live ? this.now() : -100
    const keep = this.specials.slice(-1)
    for (const old of this.specials.slice(0, -1)) this.dropSet(old)
    if (live) this.specials = [...keep, set]
    else {
      keep.forEach((k) => this.dropSet(k))
      this.specials = [set]
    }
    this.kick(true)
  }

  /** V12: 겹친 창이 열리면 ×0.6 (200ms), 닫히면 1 (260ms) */
  setGain(g: number, ms: number): void {
    const now = performance.now()
    this.gain = { from: this.gainAt(now), to: g, t0: now, dur: Math.max(1, ms) }
    this.kick(true)
  }

  /** V13: 띠 전체 +amount (오름 30% · 유지 30% · 내림 40%) */
  swellBand(amount = 0.08, ms = 2000): void {
    if (this.isStill()) return
    this.swell = { t0: performance.now(), amt: amount, dur: ms }
    this.kick()
  }

  /** 낮(건판) 섞기 */
  setPlate(on: boolean, ms = 680): void {
    const now = performance.now()
    const to = on ? 1 : 0
    if (to === this.plate.to) return
    this.plate = { from: this.plateAt(now), to, t0: this.isStill() ? -1e9 : now, dur: ms }
    this.kick(true)
  }

  /** 반사 성운 색조 (곱하기, 섞음 ≤ 10%) */
  setTint(rgb: [number, number, number] | null): void {
    this.tint = rgb ? [1 + 0.1 * (rgb[0] - 1), 1 + 0.1 * (rgb[1] - 1), 1 + 0.1 * (rgb[2] - 1)] : [1, 1, 1]
    this.kick(true)
  }

  /** 필기·입력 중: 하늘 시간을 멈춘다(마지막 모습 유지). 풀면 멈춘 자리에서 이어 간다 */
  setPaused(on: boolean): void {
    if (on && this.freezeAt === null) {
      this.freezeAt = this.now()
      this.pauseReal = performance.now()
    } else if (!on && this.pauseReal) {
      this.epoch += performance.now() - this.pauseReal
      this.pauseReal = 0
      this.freezeAt = null
    }
    this.kick(true)
  }

  /** 카메라 비행 (줌·평행 이동만, 회전 없음). 비행 중 다시 부르면 지금 위치·속도에서 이어 간다 */
  flyTo(target: Cam, durMs = 1100): void {
    const now = this.ct()
    const st = this.camAt(now)
    const to = this.clampCam(target)
    if (Math.abs(to.x - st.x) < 1e-4 && Math.abs(to.y - st.y) < 1e-4 && Math.abs(to.z - st.z) < 1e-4 && !st.flying) return
    this.fl = {
      from: { x: st.x, y: st.y, z: st.z },
      to,
      t0: durMs <= 0 || this.isStill() ? -1e9 : this.xHold || this.flightHold ? 1e12 : now,
      dur: Math.max(1, durMs),
      v0: st.flying ? Math.min(1.5, st.v) : 0,
    }
    if (this.fl.t0 < 0) this.fl.from = to
    this.kick(true)
  }

  /** 비행 출발을 붙잡는다 — 앱이 새 화면을 커밋·첫 페인트한 다음 프레임에 출발 (커밋 프레임이 비행을 끊지 않게) */
  holdFlight(on: boolean): void {
    this.flightHold = on
    if (!on && this.fl.t0 > 1e11) {
      this.fl.t0 = this.ct()
      this.kick()
    }
  }
  private flightHold = false

  /* ---------- V7 별가루 모임 ---------- */
  private gather = { x: 0, y: 0, from: 0, to: 0, t0: -1e9 }
  /** 화면 px 자리로 별가루 30%가 아주 천천히 모인다(4초에 걸쳐 방향 전환). null이면 풀린다(4초) */
  setGather(p: { x: number; y: number } | null): void {
    const now = performance.now()
    const cur = this.gatherAt(now)
    if (p) {
      this.gather = { x: p.x, y: p.y, from: cur, to: 1, t0: now }
    } else this.gather = { ...this.gather, from: cur, to: 0, t0: now }
    this.kick()
  }
  private gatherAt(now: number): number {
    const g = this.gather
    const p = Math.min(1, Math.max(0, (now - g.t0) / 4000))
    return g.from + (g.to - g.from) * stdEase(p)
  }

  /* ---------- 장소 고해상도 타일 (유휴 시간에 굽는다, 비행·전환 중에는 쉬었다가) ---------- */
  private tiles: Array<{ cam: Cam; rect: [number, number, number, number]; t: Target | null; step: number; n: number; ms: number }> = []
  private black: WebGLTexture | null = null
  private tileBakes = 0
  /** 가까이 갈 장소들 (줌 ≥ 2.2만 — 메모리 예산) */
  setTiles(places: Cam[]): void {
    for (const t of this.tiles) this.dropTarget(t.t)
    this.tiles = places
      .filter((c) => c.z >= 2.2)
      .map((c) => {
        const z = this.clampCam(c).z * 0.9
        const cc = this.clampCam(c)
        const h = 0.5 / z
        return { cam: cc, rect: [cc.x - h, cc.y - h, cc.x + h, cc.y + h] as [number, number, number, number], t: null, step: 0, n: 4, ms: 0 }
      })
  }

  /** 지금 카메라 (월드 uv 가운데 · 줌) */
  camera(): Cam & { flying: boolean } {
    const c = this.camAt(this.ct())
    return { x: c.x, y: c.y, z: c.z, flying: c.flying }
  }

  /** 월드 uv(집 화면 비율) → 지금 화면 uv */
  toScreen(wx: number, wy: number): [number, number] {
    const c = this.camAt(this.ct())
    return [(wx - c.x) * c.z + 0.5, (wy - c.y) * c.z + 0.5]
  }

  /** 지금 화면 uv → 월드 uv */
  toWorld(sx: number, sy: number): [number, number] {
    const c = this.camAt(this.ct())
    return [(sx - 0.5) / c.z + c.x, (sy - 0.5) / c.z + c.y]
  }

  private clampCam(t: Cam): Cam {
    const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, t.z))
    const h = 0.5 / z
    const cl = (v: number) => {
      const lo = h - MARGIN
      const hi = 1 + MARGIN - h
      return lo > hi ? 0.5 : Math.min(hi, Math.max(lo, v))
    }
    return { x: cl(t.x), y: cl(t.y), z }
  }

  /** 비행 상태: 위치, 시차 세기(비행 중에만), 진행 속도 */
  private camAt(now: number): { x: number; y: number; z: number; par: number; flying: boolean; v: number } {
    const f = this.fl
    if (f.t0 < 0) return { ...f.to, par: 0, flying: false, v: 0 }
    if (f.t0 > 1e11) return { ...f.from, par: 0, flying: true, v: 0 }
    const p = (now - f.t0) / f.dur
    if (p >= 1) {
      this.fl.t0 = -1e9
      return { ...f.to, par: 0, flying: false, v: 0 }
    }
    const q = Math.max(0, p)
    let e: number
    let v: number
    if (f.v0 > 0) {
      // 이어 받기: 시작 속도 v0, 끝 속도 0 (Hermite)
      e = -2 * q * q * q + 3 * q * q + f.v0 * (q * q * q - 2 * q * q + q)
      v = -6 * q * q + 6 * q + f.v0 * (3 * q * q - 4 * q + 1)
    } else {
      e = easeInOutCubic(q)
      v = (easeInOutCubic(Math.min(1, q + 0.01)) - e) / 0.01
    }
    e = Math.min(1, Math.max(0, e))
    const lz = Math.log(f.from.z) + (Math.log(f.to.z) - Math.log(f.from.z)) * e
    return {
      x: f.from.x + (f.to.x - f.from.x) * e,
      y: f.from.y + (f.to.y - f.from.y) * e,
      z: Math.exp(lz),
      par: Math.sin(Math.PI * q),
      flying: true,
      v,
    }
  }

  /** 새 별가루 멈춤 (겹친 창) */
  holdDust(on: boolean): void {
    this.dustHold = on
  }

  redraw(): void {
    this.kick(true)
  }

  meteorNow(o?: { size?: 'sm' | 'md' }): void {
    if (this.isStill()) return
    this.met.next = performance.now()
    this.met.t0 = -1e9
    this.met.forced = true
    this.met.len = o?.size === 'sm' ? 80 : 120
    this.kick()
  }

  stats(): SkyStats {
    return {
      fps: this.fps,
      tier: this.tier,
      res: this.res,
      megapixels: (this.canvas.width * this.canvas.height) / 1e6,
      stars: (this.stars?.dimCount ?? 0) + (this.stars?.brightCount ?? 0),
      bright: this.stars?.brightCount ?? 0,
      dust: this.dustN,
      bakeMs: this.bakeMs,
      bakes: this.bakes,
      tiles: this.tileBakes,
      memMB: Math.round(this.memoryMB()),
      hdr: this.hdr,
      jsMs: this.jsMs,
      p95: this.p95,
      renderer: this.renderer,
      running: this.running,
    }
  }

  /**
   * 검증용: 프레임 n장을 동기로 그려 GPU까지 끝난 시간을 잰다(gl.finish). 장면 전환 중 프레임도 섞는다.
   * 탭이 가려져 rAF가 돌지 않는 환경에서도 프레임 비용을 볼 수 있다.
   */
  bench(n = 60, scenes: SceneName[] = []): { avgMs: number; maxMs: number; p95Ms: number; bakes: number } {
    const gl = this.gl
    const out: number[] = []
    const px = new Uint8Array(4)
    const bakes0 = this.bakes
    for (let i = 0; i < n; i++) {
      if (scenes.length && i % 20 === 0) this.setScene(scenes[(i / 20) % scenes.length]!, false, this.look)
      const t0 = performance.now()
      if (this.job) {
        const more = this.runJobStep(this.job)
        if (!more) {
          const j = this.job
          this.job = null
          this.finishJob(j, true)
        }
      }
      this.draw(t0, this.isStill())
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px) // GPU가 끝날 때까지 기다린다
      out.push(performance.now() - t0)
    }
    const s = [...out].sort((a, b) => a - b)
    return {
      avgMs: out.reduce((a, b) => a + b, 0) / Math.max(1, out.length),
      maxMs: s[s.length - 1] ?? 0,
      p95Ms: s[Math.floor(0.95 * (s.length - 1))] ?? 0,
      bakes: this.bakes - bakes0,
    }
  }

  /** 검증용 내부 상태 */
  debugState() {
    const now = performance.now()
    return {
      running: this.running, raf: this.raf, still: this.isStill(), animating: this.animating(now), jobQueued: this.jobQueued, job: !!this.job,
      xHold: this.xHold, flightHold: this.flightHold, flT0: this.fl.t0 > 1e11 ? 'held' : Math.round(this.fl.t0 - this.ct()), xT0: this.xT0 > 1e11 ? 'held' : Math.round(this.xT0 - this.ct()),
      scene: this.scene, bright: this.compTo?.bright, gain: this.gainAt(now), plate: this.plateAt(now), cam: this.camAt(this.ct()), freeze: this.freezeAt, reduced: this.reduced, tier: this.tier,
      lost: this.lost, destroyed: this.destroyed, hidden: document.hidden, layer: !!this.layer,
    }
  }

  get ready(): boolean {
    return !!this.layer
  }

  get isTransitioning(): boolean {
    return this.xT0 > 0
  }

  destroy(): void {
    this.destroyed = true
    this.stop()
    this.canvas.removeEventListener('webglcontextlost', this.onLost)
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored)
    document.removeEventListener('visibilitychange', this.onVis)
  }

  /* ---------- 상태 ---------- */

  private pick(): Composition {
    const c = pickComposition(this.scene, this.cssW, this.cssH)
    return { ...c, ...this.look }
  }

  private lookOf(c: Composition): LookOverride {
    return { bright: c.bright, starExpo: c.starExpo, faint: c.faint, dynCut: c.dynCut, blue: c.blue, airglow: c.airglow, fall: c.fall, meteors: c.meteors }
  }

  private lerpComp(a: Composition, b: Composition, k: number): Composition {
    const o: Composition = { ...b }
    for (const key of LOOK_KEYS) o[key] = a[key] + (b[key] - a[key]) * k
    o.dynCut = k < 0.5 ? a.dynCut : b.dynCut
    o.safe = k < 0.5 ? a.safe : b.safe
    return o
  }

  /** 보간 진행 k(0..1)와 그 순간 속도 v(1/진행) — Hermite: 시작 속도 = 이어 받은 속도 */
  private mixState(now: number): { k: number; v: number } {
    if (this.xT0 < 0 || !this.compFrom) return { k: 1, v: 0 }
    if (this.xT0 > 1e11) return { k: 0, v: 0 }
    const p = (now - this.xT0) / this.xDur
    if (p <= 0) return { k: 0, v: this.xVel }
    if (p >= 1) return { k: 1, v: 0 }
    const e = stdEase(p)
    if (this.xVel <= 0) {
      const de = (stdEase(Math.min(1, p + 0.01)) - e) / 0.01
      return { k: e, v: de }
    }
    // 이어 받기: 처음 속도 v0, 끝 속도 0인 Hermite
    const v0 = Math.min(this.xVel, 3)
    const h = (-2 * p * p * p + 3 * p * p) + v0 * (p * p * p - 2 * p * p + p)
    const dh = -6 * p * p + 6 * p + v0 * (3 * p * p - 4 * p + 1)
    return { k: Math.min(1, Math.max(0, h)), v: dh }
  }

  private gainAt(now: number): number {
    const g = this.gain
    const p = Math.min(1, Math.max(0, (now - g.t0) / g.dur))
    const e = 1 - Math.pow(1 - p, 3)
    return g.from + (g.to - g.from) * e
  }

  private plateAt(now: number): number {
    const pl = this.plate
    if (pl.t0 < 0) return pl.to
    const p = Math.min(1, Math.max(0, (now - pl.t0) / pl.dur))
    return pl.from + (pl.to - pl.from) * stdEase(p)
  }

  private swellAt(now: number): number {
    const s = this.swell
    const p = (now - s.t0) / s.dur
    if (p < 0 || p > 1) return 0
    if (p < 0.3) return s.amt * stdEase(p / 0.3)
    if (p < 0.6) return s.amt
    return s.amt * (1 - stdEase((p - 0.6) / 0.4))
  }

  private plateTarget() {
    if (this.scene === 'today-class-day' && this.plate.to !== 1) this.plate = { from: 1, to: 1, t0: -1e9, dur: 1 }
  }

  /** 움직이지 않는 한 장면: 동작 줄이기 · 성능 C · 장면 이미지(freeze) · 낮(건판) */
  private isStill(): boolean {
    return this.reduced || this.tier === 'C' || this.freezeAt !== null || this.scene === 'today-class-day' || (this.plate.to === 1 && this.plate.t0 < 0)
  }

  /** 정지 장면이라도 보간·층 이어 받기·감광이 진행 중이면 프레임을 돈다 */
  private animating(now: number): boolean {
    return (
      (this.xT0 > 0 && this.xT0 < 1e11 && this.ct() - this.xT0 < this.xDur + 20) ||
      now - this.layerT0 < LAYER_FADE + 20 ||
      now - this.gain.t0 < this.gain.dur + 20 ||
      (this.fl.t0 > 0 && this.fl.t0 < 1e11) ||
      (this.plate.t0 > 0 && now - this.plate.t0 < this.plate.dur + 20) ||
      !!this.job
    )
  }

  /* ---------- GL 준비 ---------- */

  private shaderSrc(src: string): string {
    return src.replace('#version 300 es', `#version 300 es\n#define HDR ${this.hdr ? 1 : 0}`)
  }

  private compile(name: string, vs: string, fs: string, uniforms: string[]) {
    const gl = this.gl
    const mk = (type: number, src: string) => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, this.shaderSrc(src))
      gl.compileShader(s)
      return s
    }
    const p = gl.createProgram()!
    const a = mk(gl.VERTEX_SHADER, vs)
    const b = mk(gl.FRAGMENT_SHADER, fs)
    gl.attachShader(p, a)
    gl.attachShader(p, b)
    ;['aKind', 'aPos', 'aL', 'aCol', 'aPhase', 'aA', 'aB', 'aAnim'].forEach((n, i) => gl.bindAttribLocation(p, i, n))
    gl.linkProgram(p)
    this.pendingProgs.push({ name, p, uniforms })
    ;(p as WebGLProgram & { _sh?: WebGLShader[] })._sh = [a, b]
  }

  /** 프로그램 링크 확인 (병렬 컴파일이면 끝난 뒤에만 — 메인 스레드를 막지 않는다) */
  private finishPrograms(): boolean {
    if (this.progsReady) return true
    const gl = this.gl
    if (this.parallel) {
      for (const it of this.pendingProgs) if (!gl.getProgramParameter(it.p, this.parallel.COMPLETION_STATUS_KHR)) return false
    }
    for (const it of this.pendingProgs) {
      const sh = (it.p as WebGLProgram & { _sh?: WebGLShader[] })._sh ?? []
      if (!gl.getProgramParameter(it.p, gl.LINK_STATUS)) {
        const log = sh.map((s) => gl.getShaderInfoLog(s)).join('\n') + (gl.getProgramInfoLog(it.p) ?? '')
        throw new Error('sky shader ' + it.name + ': ' + log)
      }
      sh.forEach((s) => gl.deleteShader(s))
      const u: Record<string, WebGLUniformLocation | null> = {}
      for (const n of it.uniforms) u[n] = gl.getUniformLocation(it.p, n)
      this.progs[it.name] = { p: it.p, u }
    }
    this.pendingProgs = []
    this.progsReady = true
    this.warmUp()
    if (this.specialList.length) this.setSpecial(this.specialList, false)
    return true
  }

  private buildPrograms() {
    const band = ['uAspect', 'uBandA', 'uBandB', 'uBend', 'uCore', 'uCoreLen', 'uSafe', 'uView', 'uCam', 'uBakeK']
    this.progsReady = false
    this.pendingProgs = []
    this.compile('starS', SH.STAR_STATIC_VS, SH.STAR_STATIC_FS, [...band, 'uRes', 'uFaint', 'uStarExpo', 'uStill'])
    this.compile('down', SH.FULL_VS, SH.DOWN_FS, ['uTex', 'uTex2', 'uTexel'])
    this.compile('blur', SH.FULL_VS, SH.BLUR_FS, ['uTex', 'uTex2', 'uDir'])
    this.compile('compose', SH.FULL_VS, SH.COMPOSE_FS, [...band, 'uStars', 'uStars3', 'uBlur', 'uBlur3', 'uNebula', 'uDust', 'uStill', 'uSeed'])
    this.compile('present', SH.FULL_VS, SH.PRESENT_FS, [...band, 'uL0', 'uL1', 'uP0', 'uP1', 'uLayerMix', 'uSafeB', 'uMix', 'uBright', 'uStarExpo', 'uFaint', 'uBlue', 'uAirglow', 'uGain', 'uTint', 'uTile', 'uTileRect', 'uTileW'])
    this.compile('plate', SH.FULL_VS, SH.PLATE_FS, ['uA', 'uPlate'])
    this.compile('starD', SH.STAR_DYN_VS, SH.STAR_DYN_FS, [...band, 'uRes', 'uTime', 'uMotion', 'uPointer', 'uTaps', 'uStatic', 'uAlpha', 'uFocus', 'uStarExpo', 'uDynCut', 'uSpikes'])
    this.compile('dust', SH.DUST_VS, SH.DUST_FS, [...band, 'uRes', 'uTime', 'uAlpha', 'uFall', 'uGather'])
    this.compile('meteor', SH.METEOR_VS, SH.METEOR_FS, ['uView', 'uMet', 'uMetP', 'uMetA'])
    if (!this.parallel) this.finishPrograms()
  }

  /** 첫 사용 때 끊기지 않게 프로그램마다 4×4 타깃에 한 번씩 그려 둔다 */
  private warmUp() {
    const gl = this.gl
    const t = this.target(4, 4, 2)
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb)
    gl.viewport(0, 0, 4, 4)
    gl.bindVertexArray(this.vaoEmpty)
    for (const name of ['down', 'blur', 'compose', 'present', 'plate']) {
      const pr = this.progs[name]
      if (!pr) continue
      gl.useProgram(pr.p)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }
    for (const name of ['starS', 'starD', 'dust']) {
      const pr = this.progs[name]
      if (!pr) continue
      gl.useProgram(pr.p)
      gl.drawArrays(gl.POINTS, 0, 1)
    }
    gl.bindVertexArray(null)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    this.dropTarget(t)
  }

  /** count = 색 첨부 수. 부동소수가 되면 선형 HDR(RGBA16F) */
  private target(w: number, h: number, count = 1, float: boolean | boolean[] = false): Target {
    const gl = this.gl
    const fb = gl.createFramebuffer()!
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
    const tex: WebGLTexture[] = []
    for (let i = 0; i < count; i++) {
      const useF = (Array.isArray(float) ? !!float[i] : float) && this.hdr
      const t = gl.createTexture()!
      gl.bindTexture(gl.TEXTURE_2D, t)
      if (useF) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null)
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0)
      tex.push(t)
    }
    gl.drawBuffers(tex.map((_, i) => gl.COLOR_ATTACHMENT0 + i))
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return { fb, tex, w, h }
  }

  private tileStep(): boolean {
    const tile = this.tiles.find((t) => t.step < t.n)
    if (!tile || !this.compTo || !this.progsReady) return false
    const gl = this.gl
    const t0 = performance.now()
    const TILE_SCALE = 0.6
    const w = Math.max(1, Math.round((this.canvas.width / 0.9) * TILE_SCALE))
    const h = Math.max(1, Math.round((this.canvas.height / 0.9) * TILE_SCALE))
    if (!tile.t) tile.t = this.target(w, h, 1, true)
    if (!this.black) {
      this.black = gl.createTexture()!
      gl.bindTexture(gl.TEXTURE_2D, this.black)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4))
    }
    const pc = this.progs.compose!
    gl.useProgram(pc.p)
    gl.bindFramebuffer(gl.FRAMEBUFFER, tile.t.fb)
    gl.viewport(0, 0, tile.t.w, tile.t.h)
    gl.enable(gl.SCISSOR_TEST)
    const y0 = Math.floor((tile.t.h * tile.step) / tile.n)
    const y1 = Math.floor((tile.t.h * (tile.step + 1)) / tile.n)
    gl.scissor(0, y0, tile.t.w, y1 - y0)
    const rw = tile.rect[2] - tile.rect[0]
    const keep = this.bakeU
    this.bakeU = new Float32Array([tile.cam.x, tile.cam.y, 1 / rw, 0])
    this.setBand(pc, this.compTo, true)
    this.bakeU = keep
    for (let i = 0; i < 4; i++) {
      gl.activeTexture(gl.TEXTURE0 + i)
      gl.bindTexture(gl.TEXTURE_2D, this.black)
    }
    gl.uniform1i(pc.u.uStars!, 0)
    gl.uniform1i(pc.u.uStars3!, 1)
    gl.uniform1i(pc.u.uBlur!, 2)
    gl.uniform1i(pc.u.uBlur3!, 3)
    gl.uniform1f(pc.u.uNebula!, this.compTo.nebula)
    gl.uniform1f(pc.u.uDust!, this.compTo.dust)
    gl.uniform1f(pc.u.uStill!, 0)
    gl.uniform1f(pc.u.uSeed!, (this.seed % 97) / 97)
    gl.bindVertexArray(this.vaoEmpty)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.disable(gl.SCISSOR_TEST)
    gl.bindVertexArray(null)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.activeTexture(gl.TEXTURE0)
    tile.step++
    tile.ms += performance.now() - t0
    if (tile.step >= tile.n) this.tileBakes++
    return true
  }

  /** 지금 카메라에 맞는 타일과 섞는 비율 */
  private tileFor(cam: { x: number; y: number; z: number }) {
    let best: (typeof this.tiles)[number] | null = null
    let w = 0
    for (const t of this.tiles) {
      if (!t.t || t.step < t.n) continue
      const inside = cam.x > t.rect[0] && cam.x < t.rect[2] && cam.y > t.rect[1] && cam.y < t.rect[3]
      if (!inside) continue
      const k = Math.min(1, Math.max(0, (cam.z - t.cam.z * 0.5) / (t.cam.z * 0.3)))
      const kk = k * k * (3 - 2 * k)
      if (kk > w) {
        w = kk
        best = t
      }
    }
    return { tile: best, w }
  }

  /** GPU 메모리 추정 (MB): 층 + 타일 + 건판 */
  memoryMB(): number {
    let b = 0
    const L = this.layer?.t
    if (L) b += L.w * L.h * (this.hdr ? 12 : 8)
    for (const t of this.tiles) if (t.t) b += t.t.w * t.t.h * (this.hdr ? 8 : 4)
    if (this.P) b += this.P.w * this.P.h * 4
    return b / 1048576
  }

  private dropTarget(t: Target | null) {
    if (!t) return
    this.gl.deleteFramebuffer(t.fb)
    t.tex.forEach((x) => this.gl.deleteTexture(x))
  }

  private starVao(data: Float32Array, dynamic = false, stride = STRIDE): WebGLVertexArrayObject {
    const gl = this.gl
    const vao = gl.createVertexArray()!
    gl.bindVertexArray(vao)
    const buf = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, data, dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW)
    const st = stride * 4
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 1, gl.FLOAT, false, st, 0)
    gl.enableVertexAttribArray(1)
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, st, 4)
    gl.enableVertexAttribArray(2)
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, st, 12)
    gl.enableVertexAttribArray(3)
    gl.vertexAttribPointer(3, 3, gl.FLOAT, false, st, 16)
    gl.enableVertexAttribArray(4)
    gl.vertexAttribPointer(4, 1, gl.FLOAT, false, st, 28)
    if (stride >= SPECIAL_STRIDE) {
      gl.enableVertexAttribArray(7)
      gl.vertexAttribPointer(7, 4, gl.FLOAT, false, st, 32)
    }
    gl.bindVertexArray(null)
    this.lastBuf = buf
    return vao
  }

  private uploadSpecial(list: SpecialStar[]): SpecialSet {
    const data = new Float32Array(Math.max(1, list.length) * SPECIAL_STRIDE)
    const still = this.isStill()
    list.forEach((s, i) => {
      const o = i * SPECIAL_STRIDE
      // kind 2 = 밝기 보간(aAnim: from, to, t0, dur), 4 = 집중 진행률, +0.25 = V1 피어남, +0.5 = V1s
      let from = 1
      let to = 1
      let dur = 0.001
      let t0 = s.t0 ?? -100
      let kind = 2
      if (s.mode === 'birth') {
        from = 0
        dur = 2.4
      } else if (s.mode === 'relight') {
        from = 0.3
        dur = 0.8
      } else if (s.mode === 'focus') kind = 4
      else if (s.mode === 'anim') {
        from = s.from ?? 0
        to = s.to ?? 1
        dur = s.dur ?? 0.6
      }
      if (s.burst === 'big') kind += 0.25
      else if (s.burst === 'small') kind += 0.5
      if (s.mode === 'still' || still) t0 = -100
      data[o] = kind
      data[o + 1] = s.x
      data[o + 2] = s.y
      data[o + 3] = s.L
      data[o + 4] = s.color[0]
      data[o + 5] = s.color[1]
      data[o + 6] = s.color[2]
      data[o + 7] = t0
      data[o + 8] = from
      data[o + 9] = to
      data[o + 10] = t0
      data[o + 11] = dur
    })
    const vao = this.starVao(data, true, SPECIAL_STRIDE)
    return { vao, buf: this.lastBuf!, count: list.length, t0: -100 }
  }

  private dropSet(s: SpecialSet) {
    this.gl.deleteVertexArray(s.vao)
    this.gl.deleteBuffer(s.buf)
  }

  private buildStars() {
    if (!this.progsReady) return
    const gl = this.gl
    for (const b of this.bufs) gl.deleteBuffer(b)
    this.bufs = []
    for (const v of [this.vaoDim, this.vaoBright, this.vaoDust]) if (v) gl.deleteVertexArray(v)
    const t = TIER[this.tier]
    this.stars = makeStars(this.seed, this.cssW, this.cssH, t.density)
    this.vaoDim = this.starVao(this.stars.dim)
    this.bufs.push(this.lastBuf!)
    this.vaoBright = this.starVao(this.stars.bright)
    this.bufs.push(this.lastBuf!)
    const dust = makeDust(this.seed, dustCount(this.cssW, this.cssH))
    this.dustN = dust.length / STRIDE
    const vao = gl.createVertexArray()!
    gl.bindVertexArray(vao)
    const buf = gl.createBuffer()!
    this.bufs.push(buf)
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, dust, gl.STATIC_DRAW)
    gl.enableVertexAttribArray(5)
    gl.vertexAttribPointer(5, 4, gl.FLOAT, false, 32, 0)
    gl.enableVertexAttribArray(6)
    gl.vertexAttribPointer(6, 4, gl.FLOAT, false, 32, 16)
    gl.bindVertexArray(null)
    this.vaoDust = vao
    for (const s of this.specials) this.dropSet(s)
    this.specials = this.specialList.length ? [this.uploadSpecial(this.specialList)] : []
  }

  private safeArr(c: Composition): Float32Array {
    const safe = new Float32Array(12)
    c.safe.slice(0, 3).forEach((r, i) => {
      safe[i * 4] = r[0] / c.ref[0]
      safe[i * 4 + 1] = r[1] / c.ref[1]
      safe[i * 4 + 2] = r[2] / c.ref[0]
      safe[i * 4 + 3] = r[3] / c.ref[1]
    })
    return safe
  }

  private setBand(pr: Prog, c: Composition, bake = false) {
    const gl = this.gl
    gl.uniform4fv(pr.u.uCam!, bake ? this.bakeU : this.camU)
    gl.uniform1f(pr.u.uBakeK!, BAKE_K)
    const asp = this.cssW / this.cssH
    const f = bandFrame(c, asp)
    gl.uniform1f(pr.u.uAspect!, asp)
    gl.uniform4f(pr.u.uBandA!, f.ax, f.ay, f.dx, f.dy)
    gl.uniform4f(pr.u.uBandB!, f.nx, f.ny, f.len, f.w0)
    gl.uniform1f(pr.u.uBend!, f.bend)
    gl.uniform1f(pr.u.uCore!, c.core)
    gl.uniform1f(pr.u.uCoreLen!, c.coreLen)
    gl.uniform2f(pr.u.uView!, this.cssW, this.cssH)
    // 안전 구역: 기준 화면 크기의 px → 화면 비율 (화면이 기준보다 크거나 작아도 같은 비율 자리)
    gl.uniform4fv(pr.u.uSafe!, this.safeArr(c))
  }

  /* ---------- 정적 하늘 굽기 (장면과 무관, 여러 프레임에 나눔) ---------- */

  private startBake(W: number, H: number, res: number) {
    if (!this.progsReady || !this.compTo) return
    const gl = this.gl
    if (this.job) this.dropJob(this.job)
    const comp = this.compTo
    const first = !this.layer
    // 굽기 틀: 화면보다 사방 MARGIN 넓게, 텍셀 밀도 BAKE_SCALE
    const kx = (1 + 2 * MARGIN) * BAKE_SCALE
    W = Math.max(1, Math.round(W * kx))
    H = Math.max(1, Math.round(H * kx))
    res = res * BAKE_SCALE
    // 처음: 저해상도로 즉시 한 장 → 고해상도는 이어 받기 (점프 없이 300ms 크로스페이드)
    if (first) {
      const k = Math.min(1, Math.sqrt(0.3e6 / (W * H)))
      if (k < 0.9) {
        const lw = Math.max(1, Math.round(W * k))
        const lh = Math.max(1, Math.round(H * k))
        const lj = this.makeJob(lw, lh, res * k, comp)
        while (this.runJobStep(lj)) {
          /* 한 번에 다 굽는다 (작아서 2–3ms) */
        }
        this.finishJob(lj, false)
      }
    }
    this.job = this.makeJob(W, H, res, comp)
    void gl
    this.queueJob()
  }

  private makeJob(w: number, h: number, res: number, comp: Composition): BakeJob {
    const bw = Math.max(1, Math.round(w / 4))
    const bh = Math.max(1, Math.round(h / 4))
    return {
      w,
      h,
      res,
      comp,
      S: this.target(w, h, 2, false),
      B1: this.target(bw, bh, 2, false),
      B2: this.target(bw, bh, 2, false),
      out: this.target(w, h, 2, [true, false]),
      step: 0,
      ms: 0,
    }
  }

  private dropJob(j: BakeJob) {
    this.dropTarget(j.S)
    this.dropTarget(j.B1)
    this.dropTarget(j.B2)
    if (!this.layer || this.layer.t !== j.out) this.dropTarget(j.out)
  }

  private queueJob() {
    if (this.jobQueued || !this.job) return
    this.jobQueued = true
    this.kick(true)
  }

  /** 굽기 한 단계. 끝나면 false */
  private runJobStep(j: BakeJob): boolean {
    const gl = this.gl
    const t0 = performance.now()
    const comp = j.comp
    const vaoDim = this.vaoDim
    if (!this.stars || !vaoDim) return false
    gl.disable(gl.DEPTH_TEST)
    gl.disable(gl.SCISSOR_TEST)
    if (j.step === 0) {
      // 1) 3·4등급 별 → S (두 장: 4등급 / 3등급)
      gl.bindFramebuffer(gl.FRAMEBUFFER, j.S.fb)
      gl.viewport(0, 0, j.w, j.h)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.ONE, gl.ONE)
      const ps = this.progs.starS!
      gl.useProgram(ps.p)
      this.setBand(ps, comp, true)
      gl.uniform1f(ps.u.uRes!, j.res)
      gl.uniform1f(ps.u.uFaint!, TIER[this.tier].faint)
      gl.uniform1f(ps.u.uStarExpo!, 1)
      gl.uniform1f(ps.u.uStill!, 0)
      gl.bindVertexArray(vaoDim)
      gl.drawArrays(gl.POINTS, 0, this.stars.dimCount)
      gl.disable(gl.BLEND)
      // 2) 분해 안 된 별빛 (1/4 해상도 흐림)
      gl.bindVertexArray(this.vaoEmpty)
      const pd = this.progs.down!
      gl.useProgram(pd.p)
      gl.bindFramebuffer(gl.FRAMEBUFFER, j.B1.fb)
      gl.viewport(0, 0, j.B1.w, j.B1.h)
      this.bind2(j.S, pd, 'uTex', 'uTex2')
      gl.uniform2f(pd.u.uTexel!, 1 / j.w, 1 / j.h)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      const pb = this.progs.blur!
      gl.useProgram(pb.p)
      for (let i = 0; i < 2; i++) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, j.B2.fb)
        this.bind2(j.B1, pb, 'uTex', 'uTex2')
        gl.uniform2f(pb.u.uDir!, (1 + i) / j.B1.w, 0)
        gl.drawArrays(gl.TRIANGLES, 0, 3)
        gl.bindFramebuffer(gl.FRAMEBUFFER, j.B1.fb)
        this.bind2(j.B2, pb, 'uTex', 'uTex2')
        gl.uniform2f(pb.u.uDir!, 0, (1 + i) / j.B1.h)
        gl.drawArrays(gl.TRIANGLES, 0, 3)
      }
    } else {
      // 3) 합성 → 층 (띠 조각 하나씩)
      const n = j.w * j.h < 0.5e6 ? 1 : STRIPS
      const i = j.step - 1
      const y0 = Math.floor((j.h * i) / n)
      const y1 = Math.floor((j.h * (i + 1)) / n)
      const pc = this.progs.compose!
      gl.useProgram(pc.p)
      gl.bindFramebuffer(gl.FRAMEBUFFER, j.out.fb)
      gl.viewport(0, 0, j.w, j.h)
      gl.enable(gl.SCISSOR_TEST)
      gl.scissor(0, y0, j.w, y1 - y0)
      this.setBand(pc, comp, true)
      gl.bindVertexArray(this.vaoEmpty)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, j.S.tex[0]!)
      gl.uniform1i(pc.u.uStars!, 0)
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, j.S.tex[1]!)
      gl.uniform1i(pc.u.uStars3!, 1)
      gl.activeTexture(gl.TEXTURE2)
      gl.bindTexture(gl.TEXTURE_2D, j.B1.tex[0]!)
      gl.uniform1i(pc.u.uBlur!, 2)
      gl.activeTexture(gl.TEXTURE3)
      gl.bindTexture(gl.TEXTURE_2D, j.B1.tex[1]!)
      gl.uniform1i(pc.u.uBlur3!, 3)
      gl.uniform1f(pc.u.uNebula!, comp.nebula)
      gl.uniform1f(pc.u.uDust!, comp.dust)
      gl.uniform1f(pc.u.uStill!, 0)
      gl.uniform1f(pc.u.uSeed!, (this.seed % 97) / 97)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      gl.disable(gl.SCISSOR_TEST)
      gl.activeTexture(gl.TEXTURE0)
      if (i + 1 >= n) {
        j.step = -1
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.bindVertexArray(null)
    j.ms += performance.now() - t0
    if (j.step < 0) return false
    j.step++
    return true
  }

  private bind2(t: Target, pr: Prog, a: string, b: string) {
    const gl = this.gl
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, t.tex[0]!)
    gl.uniform1i(pr.u[a]!, 0)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, t.tex[1]!)
    gl.uniform1i(pr.u[b]!, 1)
    gl.activeTexture(gl.TEXTURE0)
  }

  private finishJob(j: BakeJob, fade: boolean) {
    this.dropTarget(j.S)
    this.dropTarget(j.B1)
    this.dropTarget(j.B2)
    const old = this.layer
    if (this.prevLayer && this.prevLayer !== old) this.dropTarget(this.prevLayer.t)
    this.prevLayer = old && fade ? old : null
    if (old && !fade) this.dropTarget(old.t)
    this.layer = { t: j.out, comp: j.comp }
    this.layerT0 = fade && old ? performance.now() : -1e9
    this.bakes++
    this.bakeMs = j.ms
  }

  /* ---------- 루프 ---------- */

  private kick(force = false) {
    if (this.destroyed || this.lost || document.hidden) return
    if (this.isStill() && !this.animating(performance.now()) && !this.jobQueued) {
      // 움직이지 않는 한 장면: 바뀔 때만 다시 그린다
      if (force) {
        cancelAnimationFrame(this.raf)
        this.running = false
        this.raf = requestAnimationFrame((t) => {
          this.raf = 0
          const n = performance.now()
          this.clk += Math.min(20, n - this.clkReal)
          this.clkReal = n
          this.tick(t, true)
          if (this.animating(performance.now()) || this.jobQueued || !this.progsReady) this.kick(true)
        })
      }
      return
    }
    // 루프가 '도는 중'으로 표시됐지만 예약된 프레임이 없으면 다시 건다 (멈춤 방지)
    if (this.running && this.raf) return
    this.running = true
    this.lastFrame = 0
    cancelAnimationFrame(this.raf)
    this.raf = requestAnimationFrame(this.frame)
  }

  private stop() {
    cancelAnimationFrame(this.raf)
    this.raf = 0
    this.running = false
  }

  private frame = (t: number) => {
    this.raf = 0
    const still = this.isStill()
    if (this.destroyed || this.lost || document.hidden || (still && !this.animating(performance.now()) && !this.jobQueued && this.progsReady)) {
      this.running = false
      if (still && !this.destroyed && !this.lost && !document.hidden) this.kick(true)
      return
    }
    this.raf = requestAnimationFrame(this.frame)
    const cap = TIER[this.tier].cap
    if (cap && this.lastFrame && t - this.lastFrame < cap - 2) return
    const interval = this.lastFrame ? t - this.lastFrame : 0
    const dt = interval || 16.7
    this.lastFrame = t
    const j0 = performance.now()
    this.clk += Math.min(20, j0 - this.clkReal)
    this.clkReal = j0
    // 포인터 세기: 켜짐 250ms · 꺼짐 900ms
    const active = performance.now() - this.ptr.t < 1500 ? 1 : 0
    const tau = active > this.ptr.k ? 250 : 900
    this.ptr.k += (active - this.ptr.k) * (1 - Math.exp(-dt / (tau / 3)))
    this.tick(t, still)
    const js = performance.now() - j0
    this.jsMs = this.jsMs ? this.jsMs * 0.95 + js * 0.05 : js
    this.onFrame?.(interval, js)
    this.measure(t, interval)
  }

  /** 한 프레임: 프로그램 준비 → 굽기 한 조각 → 그리기 */
  private tick(t: number, still: boolean) {
    if (!this.progsReady) {
      try {
        if (!this.finishPrograms()) return
      } catch (e) {
        this.destroyed = true
        throw e
      }
      // 준비되자마자 별·층
      this.buildStars()
      this.startBake(this.canvas.width, this.canvas.height, this.res)
    }
    if (this.job) {
      this.jobQueued = false
      const more = this.runJobStep(this.job)
      if (!more) {
        const j = this.job
        this.job = null
        this.finishJob(j, true)
      } else this.jobQueued = true
    }
    if (!this.layer) return
    if (this.pendingTier) this.applyPendingTier()
    // 타일은 유휴 프레임에만 (비행·전환·굽기 중이 아닐 때) 한 조각씩
    if (!this.job && this.tiles.length && !this.animating(performance.now()) && this.fl.t0 < 1e11 && this.tiles.some((x) => x.step < x.n)) {
      this.tileStep()
      this.jobQueued = this.tiles.some((x) => x.step < x.n)
    }
    this.draw(t, still)
    if (!this.firstDone) {
      this.firstDone = true
      this.onFirstFrame?.()
    }
  }

  private scheduleMeteor(now: number, first = false) {
    // 평균 3분에 1회, 최소 간격 90초 (첫 유성은 40–90초 뒤)
    this.met.next = now + (first ? 40000 + Math.random() * 50000 : 90000 + Math.random() * 180000)
  }

  private draw(_tMs: number, still: boolean) {
    const gl = this.gl
    const now = performance.now()
    const L = this.layer
    const to = this.compTo
    if (!L || !to) return
    const cnow = this.ct()
    let { k } = this.mixState(cnow)
    if (this.xT0 > 0 && this.xT0 < 1e11 && k >= 1) {
      this.xT0 = -1e9
      this.compFrom = null
      this.xVel = 0
      k = 1
    }
    const from = this.compFrom && this.xT0 > 0 ? this.compFrom : null
    const cur = from ? this.lerpComp(from, to, k) : to
    const cam = this.camAt(cnow)
    this.camU[0] = cam.x
    this.camU[1] = cam.y
    this.camU[2] = cam.z
    this.camU[3] = cam.par
    const time = this.freezeAt ?? (still ? 12.0 : this.now())
    const motion = !still || this.freezeAt !== null
    const plateK = this.plateAt(now)
    const W = this.canvas.width
    const H = this.canvas.height
    const usePlate = plateK > 0.001
    if (usePlate && (!this.P || this.P.w !== W || this.P.h !== H)) {
      this.dropTarget(this.P)
      this.P = this.target(W, H, 1)
    }
    let layerMix = 1
    const PL = this.prevLayer
    if (PL) {
      layerMix = Math.min(1, (now - this.layerT0) / LAYER_FADE)
      if (layerMix >= 1) {
        this.dropTarget(PL.t)
        this.prevLayer = null
      }
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, usePlate && this.P ? this.P.fb : null)
    gl.viewport(0, 0, W, H)
    gl.disable(gl.BLEND)
    // 1) 정적 하늘 + 장면 노출 (매 프레임 유니폼)
    const pp = this.progs.present!
    gl.useProgram(pp.p)
    gl.bindVertexArray(this.vaoEmpty)
    this.setBand(pp, from ?? to)
    const texs = [L.t.tex[0]!, L.t.tex[1]!, (PL ?? L).t.tex[0]!, (PL ?? L).t.tex[1]!]
    texs.forEach((tx, i) => {
      gl.activeTexture(gl.TEXTURE0 + i)
      gl.bindTexture(gl.TEXTURE_2D, tx)
    })
    gl.uniform1i(pp.u.uL0!, 0)
    gl.uniform1i(pp.u.uL1!, 1)
    gl.uniform1i(pp.u.uP0!, 2)
    gl.uniform1i(pp.u.uP1!, 3)
    gl.uniform1f(pp.u.uLayerMix!, PL ? layerMix : 1)
    gl.uniform4fv(pp.u.uSafeB!, this.safeArr(to))
    gl.uniform1f(pp.u.uMix!, from ? k : 1)
    gl.uniform1f(pp.u.uBright!, cur.bright * (1 + this.swellAt(now)))
    gl.uniform1f(pp.u.uStarExpo!, cur.starExpo)
    gl.uniform1f(pp.u.uFaint!, cur.faint)
    gl.uniform1f(pp.u.uBlue!, cur.blue)
    gl.uniform1f(pp.u.uAirglow!, cur.airglow)
    gl.uniform1f(pp.u.uGain!, this.gainAt(now))
    gl.uniform3f(pp.u.uTint!, this.tint[0], this.tint[1], this.tint[2])
    const tf = this.tileFor(cam)
    gl.activeTexture(gl.TEXTURE4)
    gl.bindTexture(gl.TEXTURE_2D, tf.tile?.t?.tex[0] ?? L.t.tex[0]!)
    gl.uniform1i(pp.u.uTile!, 4)
    gl.uniform4f(pp.u.uTileRect!, ...(tf.tile?.rect ?? ([0, 0, 1, 1] as [number, number, number, number])))
    gl.uniform1f(pp.u.uTileW!, tf.tile ? tf.w : 0)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.activeTexture(gl.TEXTURE0)

    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE)
    const taps = new Float32Array(16)
    if (!still) {
      this.taps.forEach((p, i) => {
        taps[i * 4] = p.x
        taps[i * 4 + 1] = p.y
        taps[i * 4 + 2] = p.t0
        taps[i * 4 + 3] = p.a
      })
    }
    const gain = this.gainAt(now)

    // 2) 0~2등급 별
    const pd = this.progs.starD!
    gl.useProgram(pd.p)
    gl.uniform1f(pd.u.uRes!, this.res)
    gl.uniform1f(pd.u.uTime!, time)
    gl.uniform1f(pd.u.uMotion!, motion && plateK < 0.999 ? 1 : 0)
    gl.uniform4f(pd.u.uPointer!, this.ptr.x, this.ptr.y, this.ptr.r, still ? 0 : this.ptr.k)
    gl.uniform4fv(pd.u.uTaps!, taps)
    gl.uniform1f(pd.u.uFocus!, this.focus)
    gl.uniform1i(pd.u.uStatic!, 0)
    gl.uniform1f(pd.u.uSpikes!, 0)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, L.t.tex[0]!)
    const drawBright = (comp: Composition, alpha: number) => {
      if (!this.stars || !this.vaoBright || alpha <= 0.001) return
      this.setBand(pd, comp)
      gl.uniform1f(pd.u.uAlpha!, alpha * gain)
      gl.uniform1f(pd.u.uStarExpo!, comp.starExpo)
      gl.uniform1f(pd.u.uDynCut!, comp.dynCut > DYN_L ? comp.dynCut : 0)
      gl.bindVertexArray(this.vaoBright)
      gl.drawArrays(gl.POINTS, 0, this.stars.brightCount)
    }
    if (from) {
      drawBright(from, 1 - k)
      drawBright(to, k)
    } else drawBright(to, 1)

    // 3) 별가루 (정지 장면은 그리지 않는다)
    if (motion && plateK < 0.999 && this.vaoDust && !this.dustHold) {
      const pdu = this.progs.dust!
      gl.useProgram(pdu.p)
      gl.uniform1f(pdu.u.uRes!, this.res)
      gl.uniform1f(pdu.u.uTime!, time)
      gl.uniform4f(pdu.u.uGather!, this.gather.x, this.gather.y, this.gatherAt(now), 300)
      const drawDust = (comp: Composition, alpha: number) => {
        if (alpha <= 0.001 || comp.fall <= 0) return
        this.setBand(pdu, comp)
        gl.uniform1f(pdu.u.uAlpha!, alpha * gain)
        gl.uniform1f(pdu.u.uFall!, comp.fall)
        gl.bindVertexArray(this.vaoDust)
        gl.drawArrays(gl.POINTS, 0, this.dustN)
      }
      if (from) {
        drawDust(from, 1 - k)
        drawDust(to, k)
      } else drawDust(to, 1)
    }

    // 4) 데이터 별 (600ms 크로스페이드, 피어남 순간에만 회절)
    if (this.specials.length) {
      gl.useProgram(pd.p)
      this.setBand(pd, to)
      gl.bindTexture(gl.TEXTURE_2D, L.t.tex[0]!)
      gl.uniform1f(pd.u.uStarExpo!, 1)
      gl.uniform1f(pd.u.uDynCut!, 0)
      gl.uniform1f(pd.u.uSpikes!, still ? 0 : 1)
      const tNow = this.now()
      const newest = this.specials[this.specials.length - 1]!
      const kIn = newest.t0 < -50 ? 1 : Math.min(1, Math.max(0, (tNow - newest.t0) / DATA_FADE))
      this.specials.forEach((s) => {
        const a = s === newest ? kIn : 1 - kIn
        if (a <= 0.001 || !s.count) return
        gl.uniform1f(pd.u.uAlpha!, a * gain)
        gl.bindVertexArray(s.vao)
        gl.drawArrays(gl.POINTS, 0, s.count)
      })
      if (kIn >= 1 && this.specials.length > 1) {
        for (const s of this.specials.slice(0, -1)) this.dropSet(s)
        this.specials = [newest]
      }
    }

    // 5) 유성
    if (!still && this.meteorsOn && (to.meteors || this.met.forced)) this.drawMeteor(now, to)

    gl.disable(gl.BLEND)
    gl.bindVertexArray(null)

    // 낮(건판): 밤 프레임을 음화로 (섞는 비율 plateK)
    if (usePlate && this.P) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.viewport(0, 0, W, H)
      const pl = this.progs.plate!
      gl.useProgram(pl.p)
      gl.bindVertexArray(this.vaoEmpty)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, this.P.tex[0]!)
      gl.uniform1i(pl.u.uA!, 0)
      gl.uniform1f(pl.u.uPlate!, plateK)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      gl.bindVertexArray(null)
    }
  }

  private inSafe(comp: Composition, x: number, y: number, pad: number): boolean {
    return comp.safe.some((r) => {
      const x0 = (r[0] / comp.ref[0]) * this.cssW - pad
      const y0 = (r[1] / comp.ref[1]) * this.cssH - pad
      const x1 = (r[2] / comp.ref[0]) * this.cssW + pad
      const y1 = (r[3] / comp.ref[1]) * this.cssH + pad
      return x > x0 && x < x1 && y > y0 && y < y1
    })
  }

  private drawMeteor(now: number, comp: Composition) {
    const m = this.met
    if (now >= m.next && now - m.t0 > m.dur * 1000) {
      // 화면 위쪽 40–55% 안, 글자·독 구역 밖. 방향은 띠와 같은 왼쪽 아래 ±20°, 0.6–0.9초
      const ang = ((57 + (Math.random() - 0.5) * 40) * Math.PI) / 180
      m.dx = -Math.cos(ang)
      m.dy = Math.sin(ang)
      if (!m.forced) m.len = 60 + Math.random() * 60
      m.dur = m.forced ? 0.7 : 0.6 + Math.random() * 0.3
      m.peak = m.forced ? 0.75 : 0.7
      let ok = false
      for (let i = 0; i < 12 && !ok; i++) {
        m.x = this.cssW * (0.25 + Math.random() * 0.7)
        m.y = this.cssH * (0.04 + Math.random() * 0.25)
        const ex = m.x + m.dx * m.len * 1.6
        const ey = m.y + m.dy * m.len * 1.6
        ok = ey < this.cssH * (m.forced ? 0.4 : 0.55) && !this.inSafe(comp, m.x, m.y, 24) && !this.inSafe(comp, ex, ey, 24)
      }
      m.t0 = now
      // 신호 유성 뒤 60초는 환경 유성을 쉰다
      if (m.forced) m.next = now + 60000 + Math.random() * 120000
      else this.scheduleMeteor(now)
      m.forced = false
      if (!ok) m.t0 = -1e9
    }
    const p = (now - m.t0) / (m.dur * 1000)
    if (p < 0 || p > 1) return
    const gl = this.gl
    const pm = this.progs.meteor!
    gl.useProgram(pm.p)
    gl.uniform2f(pm.u.uView!, this.cssW, this.cssH)
    gl.uniform4f(pm.u.uMet!, m.x, m.y, m.dx, m.dy)
    gl.uniform2f(pm.u.uMetP!, p, m.len)
    gl.uniform1f(pm.u.uMetA!, m.peak * Math.sin(Math.PI * p) * this.gainAt(now))
    gl.bindVertexArray(this.vaoEmpty)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  /* ---------- 측정 ---------- */

  /**
   * 자동 등급: 보이는 상태에서 연속 120프레임(이후 2초 창)만 표본으로 쓴다.
   * 가려진 탭·포커스 없는 창·스로틀(간격 > 100ms) 프레임이 끼면 그 창은 버리고 처음부터 다시 센다 → 백그라운드에서 강등되지 않는다.
   * 강등·재굽기는 전환·비행 중이 아닌 유휴 프레임에만 적용한다(pendingTier).
   */
  private measure(t: number, interval: number) {
    if (!this.fpsT) this.fpsT = t
    this.fpsN++
    if (t - this.fpsT >= 1000) {
      this.fps = Math.round((this.fpsN * 1000) / (t - this.fpsT))
      this.fpsN = 0
      this.fpsT = t
      this.onStats?.(this.stats())
    }
    if (!this.tierAuto || this.job) return
    if (document.hidden || !document.hasFocus() || interval <= 0 || interval > 100) {
      // 스로틀·숨김·창이 가려져 포커스 없음(미리보기 창 등은 hidden=false여도 프레임이 들쭉날쭉): 연속 표본이 끊겼다 → 처음부터
      this.samples = []
      this.winStart = 0
      return
    }
    this.samples.push(interval)
    if (!this.winStart) this.winStart = t
    const enough = this.measured ? t - this.winStart > 2000 && this.samples.length >= 60 : this.samples.length >= 120
    if (!enough) return
    const s = [...this.samples].sort((a, b) => a - b)
    const p95 = s[Math.floor(0.95 * (s.length - 1))]!
    const p10 = s[Math.floor(0.1 * (s.length - 1))]!
    this.p95 = p95
    this.samples = []
    this.winStart = t
    this.measured = true
    if (p95 > 1.2 * Math.max(BUDGET[this.tier], p10)) {
      const lower = LOWER[this.tier]
      if (lower && !this.pendingTier) {
        this.pendingTier = lower
        this.autoDowngraded = true
      }
    }
  }

  /** 등급 변경(재굽기)은 유휴 프레임에만 */
  private applyPendingTier() {
    const next = this.pendingTier
    if (!next || this.animating(performance.now()) || this.fl.t0 > 0 || this.xT0 > 0) return
    this.pendingTier = null
    if (next === this.tier) return
    this.tier = next
    this.samples = []
    this.winStart = 0
    this.measured = false
    this.resize(this.cssW, this.cssH, this.resOverride)
  }
  private pendingTier: Tier | null = null
  private autoDowngraded = false
  private restores = 0

  /* ---------- 이벤트 ---------- */

  private onVis = () => {
    this.samples = []
    this.winStart = 0
    if (document.hidden) this.stop()
    else {
      // 자동 강등된 적이 있으면 다시 보일 때 원래 등급으로 올려 다시 잰다 (사용자가 고정한 등급은 그대로, 세션당 2번까지)
      if (this.tierAuto && this.autoDowngraded && this.restores < 2) {
        const auto = guessTier(this.renderer)
        if (auto !== this.tier) {
          this.restores++
          this.autoDowngraded = false
          this.pendingTier = auto
        }
      }
      this.kick(true)
    }
  }
  private onLost = (e: Event) => {
    e.preventDefault()
    this.lost = true
    this.stop()
  }
  private onRestored = () => {
    this.lost = false
    this.progs = {}
    this.vaoEmpty = this.gl.createVertexArray()!
    this.P = null
    this.layer = null
    this.prevLayer = null
    this.job = null
    this.jobQueued = false
    this.vaoDim = this.vaoBright = this.vaoDust = null
    this.specials = []
    this.bufs = []
    this.buildPrograms()
    const w = this.cssW
    const h = this.cssH
    this.cssW = 0
    this.resize(w, h, this.resOverride)
  }
}
