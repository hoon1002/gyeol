/**
 * 결 3D 은하 엔진 (M1) — 앱(src/fx FieldEngine)과 시제품(galaxy3d.html)이 함께 쓰는 렌더러.
 * 캔버스 1개 · 그리기 고리 1개. 입자는 Web Worker가 만들고(메인 스레드 긴 작업 0) 한 번 GPU에 올린다.
 * 매 프레임 CPU는 카메라 행렬·유니폼과 전경 별 가중치·데이터 별 수십 개만 바꾼다.
 * 한 페이지에 하나만 둔다(화면 자리 SEAT가 모듈에 하나).
 *
 *   const g = new Galaxy3D(canvas, { input: window, dragFilter })
 *   g.setPlace('focus') → 비행 길이(ms) · g.holdFlight(true/false) · g.setRotation · g.setTheme · g.setSheet · g.setTravel
 *   g.onAnchor('focus-disk', cb) · g.pick(x, y) · g.stats() · g.destroy()
 */
import { omega, OMEGA_P, LANDMARKS, BAR_ANGLE, ARM_TEX_W as SH_ARM_W, ARM_TEX_H as SH_ARM_H } from './galaxy'
import * as SH from './shaders'
import GenWorker from './gen.worker.ts?worker'
import { powerMonitor, SPACE_RULES } from '@/perf/scheduler'
import { SKY_ZONES, type ZonePlace, type ZoneRect } from './zones'

export type Tier = 'A' | 'B' | 'C'
export type Rot = 'on' | 'slow' | 'off'
export type PlaceId = 'today' | 'planner' | 'notes' | 'review' | 'graph' | 'focus' | 'settings'
const TIERS: Record<Tier, { stars: number; clouds: number; scale: number; bloom: number }> = {
  // design-v4 §1: A 40만 · B 16만 · C 10만(정지 이미지용)
  A: { stars: 400_000, clouds: 1, scale: 1, bloom: 6 },
  B: { stars: 160_000, clouds: 0.7, scale: 0.75, bloom: 5 },
  C: { stars: 100_000, clouds: 0.4, scale: 0.6, bloom: 4 },
}
const ROT: Record<Rot, number> = { on: 1, slow: 1 / 3, off: 0 } // 코어 1.2 · 0.4 · 0°/s

/* ---------- 장소 (design-v4 §4·§7-1) ---------- */
export interface Place {
  id: string
  name: string
  sub: string
  /** 바라보는 점 (은하 패턴 좌표, t=0). 구조물에 붙은 장소는 패턴과 함께 돈다 */
  t: [number, number, number]
  /** 방위(°, +X에서 반시계) · 고도(°) · 거리(u) */
  az: number
  el: number
  dist: number
  expo: number
  /** 자동 공전 배율 (design-v4 §7-1 장소별 공전: 오늘·플래너·설정 1, 집중 0.3°/s, 노트·복습·그래프 0) */
  orbit: number
  /** 화면 속 원반 장축 각도(카메라 롤, °). 오늘 −57 · 플래너 0(수평 띠) · 노트 −90(세로 띠) · 복습 +40 */
  roll: number
  /** 바라보는 점의 화면 자리 (가로 · 세로 화면) */
  seat: [number, number]
  /** 태블릿 가로(너비 < 1300) · 세로 · 폰(너비 < 600)에서 다르면 (design-m1 4장 끝) */
  seatT?: [number, number]
  seatP: [number, number]
  seatPh?: [number, number]
  /** 크기 맞춤 (은하 중심 장소만): 눈에 보이는 팔 고리(11.5u)의 긴 지름(long) 또는 가로 폭(xext)이 화면 높이(h)·폭(w)·짧은 변(short)의 frac배 */
  fit?: { m: 'long' | 'xext'; frac: number; of: 'h' | 'w' | 'short' }
  fitP?: { m: 'long' | 'xext'; frac: number; of: 'h' | 'w' | 'short' }
  fitPh?: { m: 'long' | 'xext'; frac: number; of: 'h' | 'w' | 'short' }
  /** 해상도 배율(별이 한 줄로 겹치는 옆 모습 등 채우기가 몰리는 장소만) */
  rsK?: number
}
const C0: [number, number, number] = [0, 0, 0]
export const PLACES: Place[] = [
  // design-v4 §8: 장소마다 은하의 실루엣이 다르다. 글·조작이 놓이는 자리는 어둡게 비운다
  { id: 'today', name: '오늘', sub: '위 3/4 — 비스듬한 타원', t: C0, az: 210, el: 30, dist: 25, expo: 1, orbit: 1, roll: -57, seat: [0.62, 0.46], seatP: [0.54, 0.4], fit: { m: 'long', frac: 0.8, of: 'h' }, fitP: { m: 'xext', frac: 0.92, of: 'w' } },
  { id: 'planner', name: '플래너', sub: '거의 옆 — 화면을 가로지르는 시간의 띠', t: C0, az: 200, el: 8, dist: 40, expo: 0.95, orbit: 0.4, roll: 0, rsK: 0.85, seat: [0.5, 0.66], seatP: [0.5, 0.72], seatPh: [0.5, 0.74], fit: { m: 'long', frac: 1.15, of: 'w' }, fitP: { m: 'long', frac: 1.3, of: 'w' } },
  { id: 'notes', name: '노트', sub: '정확히 옆 — 오른쪽에 선 책등', t: C0, az: 225, el: 2, dist: 30, expo: 0.9, orbit: 0, roll: -90, seat: [0.86, 0.5], seatP: [0.8, 0.5], seatPh: [0.95, 0.5], fit: { m: 'long', frac: 1.2, of: 'h' }, fitP: { m: 'long', frac: 1.1, of: 'h' } },
  { id: 'review', name: '복습', sub: '아래에서 — 뒤집힌 은하, 다시 꺼내 보는 기억', t: C0, az: 195, el: -35, dist: 25, expo: 1, orbit: 0.3, roll: 40, seat: [0.62, 0.5], seatT: [0.66, 0.5], seatP: [0.5, 0.32], seatPh: [0.5, 0.27], fit: { m: 'long', frac: 0.8, of: 'h' }, fitP: { m: 'long', frac: 0.85, of: 'w' }, fitPh: { m: 'long', frac: 0.95, of: 'w' } },
  { id: 'graph', name: '그래프', sub: '팔 속, 낮게 — 별 하나하나가 생각', t: LANDMARKS.graph, az: 72, el: 25, dist: 11.5, expo: 1, orbit: 0, roll: -30, rsK: 0.9, seat: [0.6, 0.5], seatP: [0.5, 0.45] },
  { id: 'focus', name: '집중', sub: '정면 — 시계판처럼 25분에 한 바퀴', t: C0, az: 210, el: 90, dist: 25, expo: 0.95, orbit: 0, roll: 0, rsK: 0.9, seat: [0.6, 0.5], seatT: [0.62, 0.5], seatP: [0.54, 0.4], seatPh: [0.5, 0.36], fit: { m: 'long', frac: 0.66, of: 'short' }, fitP: { m: 'long', frac: 0.66, of: 'short' } }, // 링(베젤)까지 짧은 변의 ≈ 80%, 세로 좌우 여백 ≥ 6%
  { id: 'settings', name: '설정', sub: '집 안, 어둡게', t: C0, az: 210, el: 30, dist: 25, expo: 0.65, orbit: 1, roll: -57, seat: [0.62, 0.46], seatP: [0.54, 0.4], fit: { m: 'long', frac: 0.8, of: 'h' }, fitP: { m: 'xext', frac: 0.92, of: 'w' } },
]
/** 화면에서 바라보는 점의 자리 (design-v4: 0.66, 0.44) · 원반 장축 57° 대각선 고정 기울기(롤 변화 0) */
const SEAT: [number, number] = [0.66, 0.44] // 가로. 세로 화면은 resize에서 (0.56, 0.36)
let EMIT = 0.3
let STAR = 2.2
let ARM: [number, number] = [0.85, 2.0] // 팔 사이는 어둡게, 팔은 밝게 (대비 ≈ 2.5–3 : 1)
const TILT = -57
const FOV = 50

/* ---------- 수학 ---------- */
const DEG = Math.PI / 180
type V3 = [number, number, number]
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}
function viewProj(eye: V3, s: V3, u: V3, f: V3, fovY: number, aspect: number, near: number, far: number) {
  const view = [s[0], u[0], -f[0], 0, s[1], u[1], -f[1], 0, s[2], u[2], -f[2], 0, -(s[0] * eye[0] + s[1] * eye[1] + s[2] * eye[2]), -(u[0] * eye[0] + u[1] * eye[1] + u[2] * eye[2]), f[0] * eye[0] + f[1] * eye[1] + f[2] * eye[2], 1]
  const t = 1 / Math.tan(fovY / 2)
  const p = [t / aspect, 0, 0, 0, 0, t, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0]
  // 렌즈 이동: 바라보는 점(은하 중심·장소)이 화면 SEAT에 온다 (FOV 고정)
  p[8] = -(SEAT[0]! - 0.5) * 2
  p[9] = (SEAT[1]! - 0.5) * 2
  const m = new Float32Array(16)
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      let v = 0
      for (let k = 0; k < 4; k++) v += p[k * 4 + r]! * view[c * 4 + k]!
      m[c * 4 + r] = v
    }
  return { m, right: s, up: u }
}

/* ---------- 쿼터니언 (x, y, z, w) — 오일러각을 쓰지 않아 극을 넘어도 짐벌 락·뒤집힘이 없다 ---------- */
type Q = [number, number, number, number]
const qMul = (a: Q, b: Q): Q => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
]
const qAxis = (ax: V3, ang: number): Q => {
  const n = norm(ax)
  const h = Math.sin(ang / 2)
  return [n[0] * h, n[1] * h, n[2] * h, Math.cos(ang / 2)]
}
const qNorm = (q: Q): Q => {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l]
}
function qRot(q: Q, v: V3): V3 {
  const [x, y, z, w] = q
  const tx = 2 * (y * v[2] - z * v[1])
  const ty = 2 * (z * v[0] - x * v[2])
  const tz = 2 * (x * v[1] - y * v[0])
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)]
}
const qDot = (a: Q, b: Q) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]
/** 두 자세 사이 최단 회전각(라디안) */
const qAngle = (a: Q, b: Q) => 2 * Math.acos(Math.min(1, Math.abs(qDot(a, b))))
function qSlerp(a: Q, b: Q, t: number): Q {
  let d = qDot(a, b)
  const c: Q = d < 0 ? [-b[0], -b[1], -b[2], -b[3]] : b // 최단 경로
  d = Math.abs(d)
  if (d > 0.9995) return qNorm([a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t, a[2] + (c[2] - a[2]) * t, a[3] + (c[3] - a[3]) * t])
  const th = Math.acos(d)
  const sn = Math.sin(th)
  const wa = Math.sin((1 - t) * th) / sn
  const wb = Math.sin(t * th) / sn
  return [a[0] * wa + c[0] * wb, a[1] * wa + c[1] * wb, a[2] * wa + c[2] * wb, a[3] * wa + c[3] * wb]
}
/** 기저(오른쪽 s · 위 u · 뒤 b = 바라보는 점에서 눈 쪽) → 쿼터니언 */
function qBasis(s: V3, u: V3, b: V3): Q {
  const [m00, m10, m20] = s
  const [m01, m11, m21] = u
  const [m02, m12, m22] = b
  const tr = m00 + m11 + m22
  let q: Q
  if (tr > 0) {
    const S = Math.sqrt(tr + 1) * 2
    q = [(m21 - m12) / S, (m02 - m20) / S, (m10 - m01) / S, 0.25 * S]
  } else if (m00 > m11 && m00 > m22) {
    const S = Math.sqrt(1 + m00 - m11 - m22) * 2
    q = [0.25 * S, (m01 + m10) / S, (m02 + m20) / S, (m21 - m12) / S]
  } else if (m11 > m22) {
    const S = Math.sqrt(1 + m11 - m00 - m22) * 2
    q = [(m01 + m10) / S, 0.25 * S, (m12 + m21) / S, (m02 - m20) / S]
  } else {
    const S = Math.sqrt(1 + m22 - m00 - m11) * 2
    q = [(m02 + m20) / S, (m12 + m21) / S, 0.25 * S, (m10 - m01) / S]
  }
  return qNorm(q)
}
/** 바라보는 점을 향한 자세: 눈이 있는 방위·고도(°) + 화면 기울기(롤, 기본 −57°: 원반 장축이 57° 대각선) */
function orientAzEl(azDeg: number, elDeg: number, rollDeg = TILT): Q {
  const az = azDeg * DEG
  const el = elDeg * DEG
  const dir: V3 = [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)]
  const f: V3 = [-dir[0], -dir[1], -dir[2]]
  const hint: V3 = Math.abs(elDeg) > 85 ? [-Math.cos(az), 0, -Math.sin(az)] : [0, 1, 0]
  const s0 = norm(cross(f, hint))
  const u0 = cross(s0, f)
  const ca = Math.cos(rollDeg * DEG)
  const sa = Math.sin(rollDeg * DEG)
  const sv: V3 = [s0[0] * ca + u0[0] * sa, s0[1] * ca + u0[1] * sa, s0[2] * ca + u0[2] * sa]
  const uv: V3 = [-s0[0] * sa + u0[0] * ca, -s0[1] * sa + u0[1] * ca, -s0[2] * sa + u0[2] * ca]
  return qBasis(sv, uv, dir)
}
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const smooth01 = (t: number) => {
  const x = Math.min(1, Math.max(0, t))
  return x * x * (3 - 2 * x)
}
const easeS = (p: number) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, p))) // 사인 inout: 최고 속도 = 평균 × π/2

/** 화면 위치(CSS px) — useSkyAnchor */
export interface Anchor {
  x: number
  y: number
  r: number
  visible: boolean
}
export type AnchorName = 'core' | 'focus-disk'
/** 데이터 별 (오늘의 별자리·복습 카드·노트 별 …): 은하 패턴 좌표(t=0) — 팔과 함께 돈다 */
export interface DataStar {
  id: string
  /** 자리 이름(seat · cluster · nebula · exam) — 자리 부풂(V13s) 대상 */
  group?: string
  pos: [number, number, number]
  L: number
  color: [number, number, number]
  /** 밝기 보간: from → to, t0(초, Galaxy3D.now() 기준)부터 dur초 */
  from: number
  to: number
  t0: number
  dur: number
  /** 핵 지름(CSS px) — 세트 별 2.4 (design-m1 0-2-9) */
  size?: number
}
export interface LinkSpec {
  a: [number, number, number]
  b: [number, number, number]
  t0: number
  dur: number
  alpha: number
}
export interface G3DOptions {
  /** 시제품 쿼리 문자열(?tier=…&rot=…). 앱은 비운다 */
  query?: string
  tier?: 'auto' | Tier
  rotation?: Rot
  /** 드래그·휠·더블클릭을 받는 곳 (기본: 캔버스). 앱은 window + dragFilter(빈 하늘만) */
  input?: EventTarget
  dragFilter?: (e: Event) => boolean
  drag?: boolean
  /** 전경 별을 흐리게 할 크롬 요소들 (시제품 제목·버튼·HUD) */
  maskEls?: () => Element[]
  ring?: { svg: SVGSVGElement; circle: Element; arc: Element }
  onHud?: (text: string) => void
  onPlace?: (id: PlaceId) => void
  onState?: () => void
  onClean?: (on: boolean) => void
  onFirstFrame?: () => void
}
/** 엔진 공개 API — Galaxy3D 클래스가 이것을 감싼다 */
export type G3DApi = ReturnType<typeof createGalaxy3D>

/** 3D 은하 엔진 만들기 (WebGL2가 없으면 예외 — 부르는 쪽이 2.5D로 내려간다) */
export function createGalaxy3D(canvas: HTMLCanvasElement, opts: G3DOptions = {}) {
/* ---------- GL ---------- */
const qs = new URLSearchParams(opts.query ?? '')
const glc = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, premultipliedAlpha: false, powerPreference: 'low-power' })
if (!glc) throw new Error('WebGL2 없음')
const gl = glc
const cleanups: Array<() => void> = []
const listen = <E extends Event>(t: EventTarget, type: string, f: (e: E) => void, o?: AddEventListenerOptions) => {
  t.addEventListener(type, f as unknown as EventListener, o)
  cleanups.push(() => t.removeEventListener(type, f as unknown as EventListener, o))
}
let destroyed = false
let cleanMode = qs.get('clean') === '1'
const inputEl: EventTarget = opts.input ?? canvas
let dragOn = opts.drag ?? true
const dragOk = (e: Event) => dragOn && (!opts.dragFilter || opts.dragFilter(e))
powerMonitor.start()
const hdr = !!gl.getExtension('EXT_color_buffer_float')
/** GPU 시간 (가능하면): EXT_disjoint_timer_query_webgl2 */
const tq = gl.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null
function guessTier(): Tier {
  const ext = gl.getExtension('WEBGL_debug_renderer_info')
  const ren = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '').toLowerCase()
  if (/swiftshader|llvmpipe/.test(ren)) return 'C'
  if (/apple m\d|nvidia|geforce|rtx|radeon/.test(ren)) return 'A'
  return 'B'
}
let tier: Tier = (opts.tier && opts.tier !== 'auto' ? opts.tier : ['A', 'B', 'C'].includes(qs.get('tier') ?? '') ? qs.get('tier') : guessTier()) as Tier
const reducedOS = matchMedia('(prefers-reduced-motion: reduce)').matches
let userRot: Rot = opts.rotation ?? (qs.get('rot') as Rot) ?? 'on'
if (!(userRot in ROT)) userRot = 'on'
let motion: 'rich' | 'calm' | 'off' = 'rich'
let rot: Rot = 'on'
/** 실제 회전 = 사용자 설정 · 모션 수준(절제 → 느리게, 끔 → 끔) · OS 동작 줄이기 */
function applyRot() {
  rot = reducedOS || motion === 'off' ? 'off' : motion === 'calm' && userRot === 'on' ? 'slow' : userRot
}
applyRot()

function prog(vs: string, fs: string) {
  const mk = (t: number, s: string) => {
    const sh = gl.createShader(t)!
    gl.shaderSource(sh, s)
    gl.compileShader(sh)
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? 'compile')
    return sh
  }
  const p = gl.createProgram()!
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vs))
  gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs))
  gl.linkProgram(p)
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link')
  const u = new Proxy({} as Record<string, WebGLUniformLocation | null>, { get: (c, k: string) => (k in c ? c[k] : (c[k] = gl.getUniformLocation(p, k))) })
  return { p, u }
}
const P = {
  star: prog(SH.STAR_VS, SH.STAR_FS),
  cloud: prog(SH.CLOUD_VS, SH.CLOUD_FS),
  down: prog(SH.FULL_VS, SH.DOWN_FS),
  up: prog(SH.FULL_VS, SH.UP_FS),
  comp: prog(SH.FULL_VS, SH.COMPOSITE_FS),
  blit: prog(SH.FULL_VS, SH.BLIT_FS),
  fg: prog(SH.FG_VS, SH.FG_FS),
  down4: prog(SH.FULL_VS, SH.DOWN4_FS),
  dot: prog(SH.DOT_VS, SH.DOT_FS),
  seg: prog(SH.SEG_VS, SH.SEG_FS),
}

/* ---------- 4층 전경 별 (design-v4 §7-2) ---------- */
const FG_N = 4500 // 후보 — 화면에 남기는 수는 CPU가 상한으로 고른다
const FG_R = 3 // 상자를 줄여 가까운 별(보케)이 더 자주 지나가게
const fgPos = new Float32Array(FG_N * 4)
const fgKey = new Float32Array(FG_N) // 고르는 순서(고정) — 같은 별이 계속 남아 깜빡이지 않게
const fgW = new Float32Array(FG_N) // 지금 가중치 (GPU로)
const fgScr = new Float32Array(FG_N * 2) // 지난 프레임 화면 위치(CSS px) — 속도 측정
const fgSeen = new Uint8Array(FG_N)
const fgCam: V3 = [0, 0, 0]
let fgPrevEye: V3 | null = null
const fgStat = { visible: 0, area: 0, maxSpeed: 0, cap: 0, speedWin: 0, speedT: 0 }
const fgWBuf = gl.createBuffer()!
const fgVao = (() => {
  let a = 77 >>> 0
  const rnd = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), a | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const d = new Float32Array(FG_N * 8)
  for (let i = 0; i < FG_N; i++) {
    const o = i * 8
    d[o] = fgPos[i * 4] = (rnd() * 2 - 1) * FG_R
    d[o + 1] = fgPos[i * 4 + 1] = (rnd() * 2 - 1) * FG_R * 0.6
    d[o + 2] = fgPos[i * 4 + 2] = (rnd() * 2 - 1) * FG_R
    d[o + 3] = fgPos[i * 4 + 3] = 0.004 + Math.pow(rnd(), 3.5) * 0.12 // 대부분 어둡고 작게, 소수만 밝게
    const T = rnd()
    // 흑체 팔레트, 살짝 따뜻하게
    const c = T < 0.18 ? [0.8, 0.87, 1] : T < 0.7 ? [1, 0.96, 0.9] : [1, 0.84, 0.64]
    d[o + 4] = c[0]!
    d[o + 5] = c[1]!
    d[o + 6] = c[2]!
    fgKey[i] = rnd()
  }
  const vao = gl.createVertexArray()!
  gl.bindVertexArray(vao)
  const b = gl.createBuffer()!
  gl.bindBuffer(gl.ARRAY_BUFFER, b)
  gl.bufferData(gl.ARRAY_BUFFER, d, gl.STATIC_DRAW)
  gl.enableVertexAttribArray(0)
  gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 32, 0)
  gl.enableVertexAttribArray(1)
  gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 16)
  gl.bindBuffer(gl.ARRAY_BUFFER, fgWBuf)
  gl.bufferData(gl.ARRAY_BUFFER, fgW, gl.DYNAMIC_DRAW)
  gl.enableVertexAttribArray(2)
  gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 4, 0)
  gl.bindVertexArray(null)
  return vao
})()
const vaoEmpty = gl.createVertexArray()!

/** 글자·크롬 구역 (NDC): 프로토타입의 제목·HUD·버튼 + 앱의 글자 안전 구역·독 (design-v3 §2-1) */
const maskNdc = new Float32Array(24).fill(9)
/** 지금 장소의 글 구역 (SKY_ZONES) — 전경 별 마스크와 합성 안전 마스크가 같이 쓴다 */
const zoneUv = new Float32Array(12).fill(-9)
function zonePlace(): ZonePlace {
  if (sheetOpen) return 'sheet'
  const id = (flight ? flight.to.id : place.id) as PlaceId
  return id === 'planner' ? 'plan' : id === 'graph' ? 'map' : id === 'settings' ? 'sheet' : (id as ZonePlace)
}
function updateMask(cssW: number, cssH: number, dom = true) {
  const rects: ZoneRect[] = [...SKY_ZONES[zonePlace()][cssW < 600 ? 'phone' : cssW >= cssH ? 'land' : 'port']]
  zoneUv.fill(-9)
  rects.slice(0, 3).forEach((r, i) => {
    zoneUv[i * 4] = r[0]
    zoneUv[i * 4 + 1] = 1 - r[3]
    zoneUv[i * 4 + 2] = r[2]
    zoneUv[i * 4 + 3] = 1 - r[1]
  })
  if (dom)
    for (const el of opts.maskEls?.() ?? []) {
      if (!el || (el as HTMLElement).offsetParent === null) continue
      const b = el.getBoundingClientRect()
      if (b.width > 0) rects.push([b.left / cssW, b.top / cssH, b.right / cssW, b.bottom / cssH])
    }
  maskNdc.fill(9)
  rects.slice(0, 6).forEach((r, i) => {
    maskNdc[i * 4] = r[0] * 2 - 1
    maskNdc[i * 4 + 1] = 1 - r[3] * 2
    maskNdc[i * 4 + 2] = r[2] * 2 - 1
    maskNdc[i * 4 + 3] = 1 - r[1] * 2
  })
}

interface RT {
  fb: WebGLFramebuffer
  tex: WebGLTexture
  w: number
  h: number
}
function rt(w: number, h: number): RT {
  const tex = gl.createTexture()!
  gl.bindTexture(gl.TEXTURE_2D, tex)
  if (hdr) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null)
  else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  const fb = gl.createFramebuffer()!
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  return { fb, tex, w, h }
}
const freeRT = (t: RT | null) => {
  if (!t) return
  gl.deleteFramebuffer(t.fb)
  gl.deleteTexture(t.tex)
}

/* ---------- 입자: Worker가 만들고 메인은 올리기만 ---------- */
let starVao: WebGLVertexArrayObject | null = null
let cloudVao: WebGLVertexArrayObject | null = null
let starN = 0
let cloudN = 0
let genMs = 0
let uploadMs = 0
let readyAt = 0
const bufs: WebGLBuffer[] = []
const worker = new GenWorker()
let genId = 0
let dustVao: WebGLVertexArrayObject | null = null
let dustN = 0
const armTex = gl.createTexture()!
worker.onmessage = (e: MessageEvent<{ id: number; ms: number; stars: Float32Array; starCount: number; clouds: Float32Array; cloudCount: number; dustCount: number; armTex: Uint8Array }>) => {
  if (e.data.id !== genId) return
  const t0 = performance.now()
  genMs = e.data.ms
  bufs.forEach((b) => gl.deleteBuffer(b))
  bufs.length = 0
  const mkVao = (data: Float32Array, inst: boolean, off = 0) => {
    const vao = gl.createVertexArray()!
    gl.bindVertexArray(vao)
    const b = gl.createBuffer()!
    bufs.push(b)
    gl.bindBuffer(gl.ARRAY_BUFFER, b)
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 32, off)
    gl.enableVertexAttribArray(1)
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, off + 16)
    if (inst) {
      gl.vertexAttribDivisor(0, 1)
      gl.vertexAttribDivisor(1, 1)
    }
    gl.bindVertexArray(null)
    return vao
  }
  starVao = mkVao(e.data.stars, false)
  // 구름: 앞쪽 dustCount개 = 먼지 → 먼지 패스·빛 패스를 범위로 나눠 그린다(인스턴스 반씩, 버리는 정점 0)
  dustVao = mkVao(e.data.clouds, true)
  cloudVao = mkVao(e.data.clouds, true, e.data.dustCount * 32)
  dustN = e.data.dustCount
  gl.bindTexture(gl.TEXTURE_2D, armTex)
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8, SH_ARM_W, SH_ARM_H, 0, gl.RG, gl.UNSIGNED_BYTE, e.data.armTex)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  starN = e.data.starCount
  cloudN = e.data.cloudCount - e.data.dustCount
  uploadMs = performance.now() - t0
  if (!readyAt) {
    readyAt = performance.now()
    opts.onFirstFrame?.()
  }
  kick()
}
function generate() {
  genId++
  const T = TIERS[tier]
  worker.postMessage({ id: genId, stars: T.stars, clouds: T.clouds })
}

/* ---------- 크기: 렌더 타깃은 전체 크기로 한 번, 상태별 해상도는 그 안의 일부만 쓴다 ---------- */
let W = 1
let H = 1
let dpr = 1
let cssW = 1
let cssH = 1
let scene: RT | null = null
let mips: RT[] = []
let dustRT: RT | null = null
let emitRT: RT | null = null
function resize(vw = innerWidth, vh = innerHeight, vdpr = Math.min(devicePixelRatio || 1, 2)) {
  cssW = vw
  cssH = vh
  dpr = vdpr * TIERS[tier].scale
  W = Math.max(2, Math.round(vw * dpr))
  H = Math.max(2, Math.round(vh * dpr))
  canvas.width = W
  canvas.height = H
  freeRT(scene)
  mips.forEach(freeRT)
  freeRT(dustRT)
  freeRT(emitRT)
  scene = rt(W, H)
  dustRT = rt(Math.max(1, W >> 1), Math.max(1, H >> 1))
  emitRT = rt(Math.max(1, W >> 1), Math.max(1, H >> 1))
  mips = []
  // 블룸은 ¼ 해상도에서 시작(첫 단 쌍선형 4탭) — 단 수는 하나 줄지만 가장 큰 번짐은 같다
  let w = W >> 1
  let h = H >> 1
  for (let i = 0; i < TIERS[tier].bloom - 1; i++) {
    w = Math.max(1, w >> 1)
    h = Math.max(1, h >> 1)
    mips.push(rt(w, h))
  }
  updateMask(vw, vh, !cleanMode)
  anchorDirty = true
  computeFit(vw / vh)
}

/* ---------- 카메라: 은하 중심(바라보는 점) 둘레 구 위의 자유 회전 — 쿼터니언 아크볼 ----------
   orient = 장소 프레임(구조물 장소는 패턴과 함께 돈다) 안의 카메라 자세. 눈 = 바라보는 점 + orient·(0, 0, 거리).
   고도 제한 없음: 위·아래·극을 넘어 어디로든 굴린다. 롤은 사용자가 굴린 만큼만 생기고, 자동으로는 바꾸지 않는다. */
interface CamS {
  t: V3
  dist: number
  q: Q
  expo: number
  /** 화면 자리 (비행 중엔 같은 이징으로 옮겨 간다) */
  seat: [number, number]
  /** 큰 회전 비행의 가운데 효과(0–1): 노출 85% · 피사계 심도 조금 깊게 · 어둡게 바꾸기(동작 줄이기) */
  fx: number
  dim: number
}
const YAX: V3 = [0, 1, 0]
let simT = 0 // 은하 시계
void omega
const frameRot = (pl: Place, t: number) => (Math.hypot(pl.t[0], pl.t[2]) < 0.01 ? 0 : OMEGA_P * t)
function placeTarget(pl: Place, t: number): V3 {
  const r = Math.hypot(pl.t[0], pl.t[2])
  const th = Math.atan2(pl.t[2], pl.t[0]) + frameRot(pl, t)
  return [r * Math.cos(th), pl.t[1], r * Math.sin(th)]
}
/** 장소 프레임 자세 → 세계 자세 (은하 θ가 늘어나는 쪽으로 함께 돈다) */
const worldQ = (pl: Place, t: number, o: Q) => qMul(qAxis(YAX, -frameRot(pl, t)), o)
const homeOrient = (pl: Place) => orientAzEl(pl.az, pl.el, pl.roll)
let place = PLACES.find((p) => p.id === qs.get('place')) ?? PLACES[0]!
let orient: Q = homeOrient(place)
/** zoom: 핀치·휠 거리 배율 · wv: 관성 각속도(카메라 좌표의 축 × rad/ms, 은하가 굴러가는 쪽) */
let user = { zoom: 1, wv: [0, 0, 0] as V3 }
let flight: { from: CamS; to: Place; o: Q; t0: number; dur: number; ang: number; fade: boolean } | null = null
let flightMax = 0
let flightPeak = 0
let prevFlightQ: Q | null = null
let flightFrames: number[] = []
const flightLog: Array<{ to: string; ms: number; maxFrame: number; p95: number; angDeg: number; peakDegS: number }> = []
/** 처음 구도 맞춤 (화면비별): 기본 3/4 자세에서 원반 가장자리(14.5u 고리 32점 + 팽대부 위아래)가 화면 여백 3% 안에 드는
 *  가장 가까운 거리 → 은하 중심 장소(오늘·플래너·설정)의 거리 배율. 오른쪽 치우침(좌석)은 유지, 세로 화면은 좌석 (0.56, 0.36) */
let portrait = false
/** 화면 종류: 데스크톱 · 태블릿 가로(너비 < 1300) · 세로 · 폰(너비 < 600) */
let lay: 'desk' | 'tabL' | 'port' | 'phone' = 'desk'
const fitD: Record<string, number> = {}
const seatOf = (pl: Place): [number, number] =>
  lay === 'phone' ? (pl.seatPh ?? pl.seatP) : lay === 'port' ? pl.seatP : lay === 'tabL' ? (pl.seatT ?? pl.seat) : pl.seat
/** 장소마다 크기 맞춤 (design-v4 §8): 그 장소의 기본 자세·화면 자리에서 눈에 보이는 팔 고리(11.5u)가 규칙대로 화면을 채우는 거리 */
function computeFit(aspect: number) {
  portrait = aspect < 1
  lay = cssW < 600 ? 'phone' : portrait ? 'port' : cssW < 1300 ? 'tabL' : 'desk'
  const ring: V3[] = []
  for (let k = 0; k < 48; k++) ring.push([11.5 * Math.cos((k / 48) * Math.PI * 2), 0, 11.5 * Math.sin((k / 48) * Math.PI * 2)])
  const keep: [number, number] = [SEAT[0], SEAT[1]]
  for (const pl of PLACES) {
    const rule = lay === 'phone' ? (pl.fitPh ?? pl.fitP) : portrait ? pl.fitP : pl.fit
    if (!rule) continue
    const q = homeOrient(pl)
    const back = qRot(q, [0, 0, 1])
    const sv = qRot(q, [1, 0, 0])
    const uv = qRot(q, [0, 1, 0])
    const f: V3 = [-back[0], -back[1], -back[2]]
    ;[SEAT[0], SEAT[1]] = seatOf(pl)
    const want = rule.frac * 2 * (rule.of === 'h' ? 1 : rule.of === 'w' ? aspect : Math.min(1, aspect)) // NDC 높이 2 = 화면 높이
    const measure = (d: number) => {
      const m = viewProj([back[0] * d, back[1] * d, back[2] * d], sv, uv, f, FOV * DEG, aspect, 0.02, 3000).m
      const P2 = ring.map((p) => {
        const w = m[3]! * p[0] + m[7]! * p[1] + m[11]! * p[2] + m[15]!
        return [((m[0]! * p[0] + m[4]! * p[1] + m[8]! * p[2] + m[12]!) / w) * aspect, (m[1]! * p[0] + m[5]! * p[1] + m[9]! * p[2] + m[13]!) / w] as [number, number]
      })
      if (rule.m === 'xext') return Math.max(...P2.map((p) => p[0])) - Math.min(...P2.map((p) => p[0]))
      let L = 0
      for (let a = 0; a < 24; a++) L = Math.max(L, Math.hypot(P2[a]![0] - P2[a + 24]![0], P2[a]![1] - P2[a + 24]![1]))
      return L
    }
    let lo = 4
    let hi = 200
    for (let i = 0; i < 32; i++) {
      const mid = (lo + hi) / 2
      if (measure(mid) > want) lo = mid
      else hi = mid
    }
    fitD[pl.id] = hi
  }
  ;[SEAT[0], SEAT[1]] = keep
}
const pdist = (pl: Place) => fitD[pl.id] ?? pl.dist
const lookW = (p: V3): V3 => {
  const r = Math.hypot(p[0], p[2])
  const th = Math.atan2(p[2], p[0]) + OMEGA_P * simT
  return [r * Math.cos(th), p[1], r * Math.sin(th)]
}
const camNow = (): CamS => ({ t: look ? lookW(look.pos) : placeTarget(place, simT), dist: look ? look.dist : pdist(place), q: worldQ(place, simT, orient), expo: place.expo, seat: seatOf(place), fx: 0, dim: 0 })
function curCam(now: number): { c: CamS; flying: boolean } {
  if (!flight) return { c: camNow(), flying: false }
  if (holdOn) flight.t0 = now // 노출 → 커밋 → 비행: 커밋 전에는 출발하지 않는다
  const p = Math.min(1, (now - flight.t0) / flight.dur)
  const e = easeS(p) // 이동·회전 같은 이징
  const a = flight.from
  const b: CamS = { t: look ? lookW(look.pos) : placeTarget(flight.to, simT), dist: look ? look.dist : pdist(flight.to), q: worldQ(flight.to, simT, flight.o), expo: flight.to.expo, seat: seatOf(flight.to), fx: 0, dim: 0 }
  const far = Math.abs(Math.log(b.dist / a.dist)) + Math.hypot(b.t[0] - a.t[0], b.t[2] - a.t[2]) / 6
  const arc = Math.sin(Math.PI * p)
  if (p >= 1) {
    const st = flightFrames.slice().sort((x, y) => x - y)
    flightLog.push({ to: flight.to.id, ms: flight.dur, maxFrame: flightMax, p95: st[Math.floor(0.95 * (st.length - 1))] ?? 0, angDeg: flight.ang, peakDegS: flightPeak })
    orient = flight.o
    flight = null
    anchorDirty = true
    opts.onState?.()
    return { c: camNow(), flying: false }
  }
  // 회전 끔·동작 줄이기: 0.5초 어둡게 바꾸기(회전 없음) — 가운데에서 자리를 바꾼다
  if (flight.fade) return { c: { ...(p < 0.5 ? a : b), dim: 1 - Math.abs(1 - 2 * p) }, flying: true }
  return {
    c: {
      seat: [a.seat[0] + (b.seat[0] - a.seat[0]) * e, a.seat[1] + (b.seat[1] - a.seat[1]) * e],
      fx: flight.ang > 100 ? arc : 0,
      dim: 0,
      t: [a.t[0] + (b.t[0] - a.t[0]) * e, a.t[1] + (b.t[1] - a.t[1]) * e, a.t[2] + (b.t[2] - a.t[2]) * e],
      dist: Math.exp(Math.log(a.dist) + (Math.log(b.dist) - Math.log(a.dist)) * e) * (1 + Math.min(0.12, 0.04 * far) * arc),
      // 최단 회전(slerp): 롤도 비행 전체에 고르게 나뉘어 끝에서 목적지 up에 맞는다(급한 롤 없음)
      q: qSlerp(a.q, b.q, e),
      expo: a.expo + (b.expo - a.expo) * e,
    },
    flying: true,
  }
}
function startFlight(pl: Place, o: Q, home: boolean) {
  const now = performance.now()
  touch(now)
  const cur = curCam(now)
  const from: CamS = { ...cur.c, dist: cur.c.dist * user.zoom }
  user = { zoom: 1, wv: [0, 0, 0] }
  const toQ = worldQ(pl, simT, o)
  const ang = qAngle(from.q, toQ) / DEG
  const tt = placeTarget(pl, simT)
  const dz = Math.abs(Math.log(pdist(pl) / from.dist))
  const dp = Math.hypot(tt[0] - from.t[0], tt[2] - from.t[2])
  let dur: number
  // 리더 결정(2026-10-17): 처음 자리로·장소 비행 모두 최고 각속도 60°/s를 지키되 길이는 3.0s에서 자른다.
  // 115°까지는 60°/s 안, 그보다 큰 회전(뒤집힌 자세에서 출발)은 최고 94°/s까지 허용 — 사용자가 직접 누른 이동이라서.
  dur = home ? Math.min(2000, 1200 + (ang / 90) * 800) : Math.min(2400, 1200 + (ang / 90) * 800)
  if (!home) dur = Math.max(dur, Math.min(1800, 1200 + ((200 * dz) / Math.LN2) * 0.7 + 25 * dp))
  dur = Math.min(3000, Math.max(dur, ((Math.PI / 2) * ang * 1000) / 60))
  place = pl
  flightMax = 0
  flightPeak = 0
  prevFlightQ = null
  flightFrames = []
  const fade = reduced() || travelMode !== 'fly'
  flight = { from, to: pl, o, t0: now, dur: fade ? 500 : dur, ang, fade }
  if (pl.id === 'focus') focusEnter(o)
  setTitle()
  updateButtons()
}
function flyTo(id: string) {
  look = null
  const pl = PLACES.find((p) => p.id === id)
  if (!pl || pl === place) return
  // 목적지 자세: 장소의 기본 구도를 은하 축 둘레로 돌린 것 가운데 지금 자세와 가장 가까운 것 → 비행 회전 최소
  // (design-v4 §7-1 '지금 방위 + 장소 오프셋'의 구형 버전)
  startFlight(pl, nearestPose(pl), false)
}
/** 그래프 자세 조건: 막대를 끝에서 보지 않고(막대와 시선 ≥ 30°), 눈이 막대 끝 바깥쪽에 있어 막대가 화면 뒤로 물러나 작게 보일 것 */
function graphOk(q: Q) {
  const b = qRot(q, [0, 0, 1])
  const a = BAR_ANGLE + OMEGA_P * simT
  return barLook(q) <= Math.cos(30 * DEG) && b[0] * Math.cos(a) + b[2] * Math.sin(a) >= 0.2
}
/** |cos(막대 축, 시선)| — 1이면 막대를 끝에서 본다 */
function barLook(q: Q) {
  const f = qRot(q, [0, 0, -1])
  const a = BAR_ANGLE + OMEGA_P * simT
  return Math.abs(f[0] * Math.cos(a) + f[2] * Math.sin(a))
}
/** 장소의 기본 자세를 은하 축 둘레로 돌린 것 가운데 지금 자세와 가장 가까운 것(실루엣은 같다) */
function nearestPose(pl: Place): Q {
  const cur = curCam(performance.now()).c.q
  const base = homeOrient(pl)
  let best = base
  let bestA = 9
  for (let k = 0; k < 72; k++) {
    const o = qMul(qAxis(YAX, k * 5 * DEG), base)
    const wq = worldQ(pl, simT, o)
    if (pl.id === 'graph' && !graphOk(wq)) continue
    const a = qAngle(cur, wq)
    if (a < bestA) {
      bestA = a
      best = o
    }
  }
  return best
}
/** 처음 자리로: 장소의 기본 3/4 구도로 slerp (더블클릭 · 더블탭 · 버튼) */
const goHome = () => startFlight(place, nearestPose(place), true)

/* ---------- 타이머 자리 미리보기 (개발 토글 ?ring=1 · 버튼 · __g3d.ring) ---------- */
let ringOn = qs.get('ring') === '1'
const RING_R = 14 // 시계 베젤: 보이는 팔 가장 바깥(≈ 13u)보다 ≈ 7% 크게 — 은하가 돌아도 팔이 링을 뚫지 않는다
const ringEls = opts.ring ?? null
let ringGeo: { cx: number; cy: number; r: number; frac: number } | null = null // 캔버스 장치 px
function updateRing(m: Float32Array, target: V3, now: number) {
  ringGeo = null
  if (place.id !== 'focus' || (flight && !flight.fade)) {
    if (ringEls) ringEls.svg.style.display = 'none'
    return
  }
  let cx = 0
  let cy = 0
  const pts: Array<[number, number]> = []
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2
    const x = target[0] + RING_R * Math.cos(a)
    const y = target[1]
    const z = target[2] + RING_R * Math.sin(a)
    const w = m[3]! * x + m[7]! * y + m[11]! * z + m[15]!
    const px = (((m[0]! * x + m[4]! * y + m[8]! * z + m[12]!) / w + 1) / 2) * W
    const py = ((1 - (m[1]! * x + m[5]! * y + m[9]! * z + m[13]!) / w) / 2) * H
    pts.push([px, py])
    cx += px / 16
    cy += py / 16
  }
  const r = pts.reduce((acc, p) => acc + Math.hypot(p[0] - cx, p[1] - cy), 0) / 16
  const frac = Math.min(1, (now - focusT0) / (FOCUS_MIN * 60_000))
  ringGeo = { cx, cy, r, frac }
  if (!ringOn || !ringEls) {
    if (ringEls) ringEls.svg.style.display = 'none'
    return
  }
  const k = cssW / W
  ringEls.svg.style.display = 'block'
  ringEls.circle.setAttribute('cx', String(cx * k))
  ringEls.circle.setAttribute('cy', String(cy * k))
  ringEls.circle.setAttribute('r', String(r * k))
  const a1 = -Math.PI / 2 + frac * Math.PI * 2
  const x1 = cx * k + r * k * Math.cos(a1)
  const y1 = cy * k + r * k * Math.sin(a1)
  ringEls.arc.setAttribute('d', `M ${cx * k} ${cy * k - r * k} A ${r * k} ${r * k} 0 ${frac > 0.5 ? 1 : 0} 1 ${x1} ${y1}`)
}

/* ---------- 집중의 시계 (design-v4 §8): 타이머 한 번(25분)에 은하가 정확히 한 바퀴 — 0.24°/s, 각도는 시각에서 ---------- */
const FOCUS_MIN = 25
let focusT0 = 0
let focusBase: Q = [0, 0, 0, 1]
let focusDisp = 0
function focusEnter(o: Q) {
  focusT0 = performance.now()
  focusBase = o
  focusDisp = 0
}
/** useSkyClock: 진행률 × 360° (리더 결정 2). startedAt = 지금 달리는 구간이 시작된 시각(Date.now), elapsedMs = 그 전까지 쌓인 시간 */
let focusClock: { startedAt: number; durationMs: number; elapsedMs: number; paused: boolean } | null = null
function clockAngle(): number | null {
  const c = focusClock
  if (!c || c.durationMs <= 0) return null
  const el = c.elapsedMs + (c.paused ? 0 : Math.max(0, Date.now() - c.startedAt))
  return Math.min(1, el / c.durationMs) * Math.PI * 2
}
const focusAngle = (now: number) => (((now - focusT0) / 1000) * 360 * DEG) / (FOCUS_MIN * 60)
const reduced = () => reducedOS || rot === 'off'
let sheetOpen = false
let sheetK = 0
let holdOn = false
let travelMode: 'fly' | 'short' | 'off' = 'fly'
let extExpo = 1
let lightOn = false
let lightK = 0
let anchorDirty = true
/** 시간대 위상: 1 푸른 밤(낮 시간) · 0 깊은 밤 · −1 새벽 */
let phaseTo = 0
let phaseK = 0
let tint: [number, number, number, number] = [1, 1, 1, 0]
/** 별 고르기 다가감 (design-m1 #31): 바라보는 점을 데이터 별로, 거리 d — 자세(롤·방위)는 그대로 */
let look: { pos: V3; dist: number } | null = null
let eventUntil = 0
let calm = false
let calmK = 0
let swellT0 = -1e9
let swellAt: 'core' | 'seat' | 'cluster' = 'core'
let lastEye: V3 = [0, 0, 1]
let lastBasis: { s: V3; u: V3; f: V3 } | null = null

/* ---------- 전력 상태 (design-v4 §7-4) ----------
   활동(입력·비행·관성, 마지막 입력 2s 안) 60fps ×1.0 · 평소(입력 없음 0–60s) 30fps ×0.75 · 깊은 대기(60s+) 15fps ×0.6 ·
   쉼(5분+ · 저전력 · 발열 추정 · 동작 줄이기 · 회전 끔) 2s 크로스페이드 뒤 그리기 멈춤(깨우기 0) · 숨김 0.
   저전력이면 활동도 한 단계 낮춘다(30fps ×0.75). 돌아오면 600ms 동안 속도가 0에서 차오른다. */
type Power = 'active' | 'normal' | 'deep' | 'rest'
const FRAME_MS: Record<Power, number> = { active: 1000 / 60, normal: 1000 / 30, deep: 1000 / 15, rest: 1000 / 15 }
const RSCALE: Record<Power, number> = { active: 1, normal: 0.75, deep: 0.6, rest: 1 }
let power: Power = 'active'
let forced: Power | null = null
let lowPower = qs.get('lowpower') === '1' || !!(navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData
;(navigator as Navigator & { getBattery?: () => Promise<{ charging: boolean; level: number; addEventListener: (t: string, f: () => void) => void }> }).getBattery?.().then((b) => {
  const upd = () => (lowPower = qs.get('lowpower') === '1' || (!b.charging && b.level <= 0.2))
  upd()
  b.addEventListener('chargingchange', upd)
  b.addEventListener('levelchange', upd)
})
let thermalUntil = 0
let hotSec = 0
let lastInput = -1e9
let wakeAt = 0 // 쉼·숨김에서 돌아온 순간 (600ms 속도 램프)
let restK = 0 // 정지 장면 크로스페이드 0→1 (2s)
let releasedAt = 0
let drag: { x: number; y: number; t: number } | null = null
function powerState(now: number): Power {
  if (forced) return forced
  const idle = now - lastInput
  const low = lowPower || powerMonitor.lowPower() || now < thermalUntil
  const moving = !!flight || !!drag || Math.hypot(user.wv[0], user.wv[1], user.wv[2]) > 1e-9 || idle < 2000
  if (moving || now < eventUntil) return low ? 'normal' : 'active' // 사건 중·끝나고 2초까지 활동 (design-m1 0-2-7)
  // 장소별 규칙 (src/perf/scheduler SPACE_RULES): 집중 20초 → 쉼, 노트·복습·설정 30초 → 깊은 대기
  const rule = sheetOpen ? SPACE_RULES.settings : SPACE_RULES[place.id]
  if (reduced() || low || idle > (rule?.restAfterMs ?? 300_000)) return 'rest'
  if (idle > (rule?.deepAfterMs ?? 60_000)) return 'deep'
  return 'normal'
}

/* ---------- 그리기 고리: 활동은 rAF, 평소·깊은 대기는 타이머로 다음 rAF를 예약(깨우기 = 그린 프레임), 쉼·숨김은 멈춤 ---------- */
let rafId = 0
let timerId = 0
let pending = false
let stopped = false
let lastDraw = 0
const wake = { n: 0, t: performance.now(), rate: 0 }
let wakeAll = 0
const countWake = () => {
  wake.n++
  wakeAll++
}
function schedule() {
  if (pending || document.hidden || destroyed) return
  if (power === 'rest' && restK >= 1 && !forced) {
    stopped = true // 정지 장면: 다음 입력까지 깨우지 않는다
    return
  }
  pending = true
  const iv = FRAME_MS[power]
  if (iv < 20) rafId = requestAnimationFrame(frame)
  // 평소·깊은 대기: 타이머가 깨운 자리에서 바로 그린다(깨우기 = 그린 프레임, power-budget §4-1).
  // 창이 가려져 rAF가 멈추면 그리지 않도록 1초마다 rAF 맥박을 한 번 걸고, 1.5초 넘게 맥박이 없으면 rAF가 다시 올 때까지 쉰다.
  else
    timerId = window.setTimeout(() => {
      const t = performance.now()
      if (t - rafSeenAt > 1500) {
        rafId = requestAnimationFrame((ts) => {
          rafSeenAt = performance.now()
          frame(ts, true)
        })
        return
      }
      if (t - beatAt > 1000) {
        beatAt = t
        requestAnimationFrame(() => (rafSeenAt = performance.now()))
      }
      frame(t, true)
    }, Math.max(0, lastDraw + iv - performance.now()))
}
let rafSeenAt = performance.now()
let beatAt = 0
function kick() {
  if (document.hidden) return
  if (pending) {
    // 타이머로 기다리는 중이면 당겨서 바로 그린다
    clearTimeout(timerId)
    cancelAnimationFrame(rafId)
    pending = false
  }
  stopped = false
  pending = true
  rafId = requestAnimationFrame(frame)
}
function touch(now = performance.now()) {
  if (stopped || restK > 0 || now - lastDraw > 1000) wakeAt = now
  lastInput = now
  kick()
}
listen(document, 'visibilitychange', () => {
  if (document.hidden) {
    clearTimeout(timerId)
    cancelAnimationFrame(rafId)
    pending = false
  } else {
    wakeAt = performance.now()
    lastInput = wakeAt
    kick()
  }
})

/* ---------- 입력: 아크볼 드래그(구 위 자유 회전, 관성) · 더블클릭/더블탭 처음 자리로 · 휠 거리 ---------- */
/** 화면에서 (dx, dy)px 끌면 은하가 손가락 방향으로 굴러간다(카메라는 반대로) — 0.15°/px, 최대 180°/s */
function applyDrag(dx: number, dy: number, dt: number) {
  const len = Math.hypot(dx, dy)
  if (len < 1e-6) return
  const ang = Math.min(len * 0.15 * DEG, 0.18 * DEG * dt)
  const ax: V3 = [dy / len, dx / len, 0] // 카메라 좌표: 오른쪽 끌기 = 위 축 둘레, 아래로 끌기 = 오른쪽 축 둘레
  orient = qNorm(qMul(orient, qAxis(ax, -ang)))
  user.wv = [(ax[0] * ang) / dt, (ax[1] * ang) / dt, 0]
}
let lastTap = { t: 0, x: 0, y: 0 }
listen(inputEl, 'pointerdown', (e: PointerEvent) => {
  if (!dragOk(e)) return
  const now = performance.now()
  touch(now)
  if (e.pointerType !== 'mouse') {
    if (now - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) {
      lastTap.t = 0
      goHome()
      return
    }
    lastTap = { t: now, x: e.clientX, y: e.clientY }
  }
  if (flight) return // 비행 중엔 잡지 않는다(비행이 끝나면 그 자세에서 이어서)
  drag = { x: e.clientX, y: e.clientY, t: now }
  user.wv = [0, 0, 0]
  if (inputEl === canvas) canvas.setPointerCapture(e.pointerId)
})
listen(inputEl === canvas ? canvas : window, 'pointermove', (e: PointerEvent) => {
  if (!drag) return
  const now = performance.now()
  applyDrag(e.clientX - drag.x, e.clientY - drag.y, Math.max(1, now - drag.t))
  releasedAt = 0
  touch(now)
  drag = { x: e.clientX, y: e.clientY, t: now }
})
const endDrag = () => {
  if (!drag) return
  drag = null
  anchorDirty = true
  releasedAt = performance.now()
  // 관성 시작 속도 ≤ 90°/s, 동작 줄이기면 0
  const w = Math.hypot(user.wv[0], user.wv[1], user.wv[2])
  const lim = reducedOS ? 0 : 0.09 * DEG
  if (w > lim) user.wv = w > 0 ? [(user.wv[0] * lim) / w, (user.wv[1] * lim) / w, 0] : [0, 0, 0]
  touch()
}
listen(inputEl === canvas ? canvas : window, 'pointerup', endDrag)
listen(inputEl === canvas ? canvas : window, 'pointercancel', endDrag)
listen(inputEl, 'dblclick', (e: MouseEvent) => {
  if (!dragOk(e)) return
  e.preventDefault()
  goHome()
})
listen(
  inputEl,
  'wheel',
  (e: WheelEvent) => {
    if (!dragOk(e)) return
    e.preventDefault()
    user.zoom = Math.max(0.6, Math.min(1.6, user.zoom * Math.exp(e.deltaY * 0.0012))) // 핀치: 장소 거리의 0.6–1.6배
    touch()
  },
  { passive: false },
)
listen(window, 'keydown', () => touch())

/* ---------- 바깥 알림 (시제품 UI · 앱) ---------- */
const updateButtons = () => opts.onState?.()
const setTitle = () => opts.onPlace?.(place.id as PlaceId)
let hudOn = !!opts.onHud && qs.get('hud') !== '0'
let lastHud = ''

/* ---------- 계측 ---------- */
const frames: number[] = []
let fps = 0
let fpsN = 0
let fpsT = 0
let hudT = 0
let jsMs = 0
let gpuMs = 0
const qPool: WebGLQuery[] = []
const qPend: WebGLQuery[] = []
let gpuSync = false // 타이머 쿼리가 없을 때 측정 중에만: 1픽셀 읽기로 끝까지 기다려 (JS+GPU) 시간을 잰다
const meas = { on: false, drawn: 0, wakes: 0, js: [] as number[], gpu: [] as number[], iv: [] as number[], t0: 0, states: {} as Record<string, number> }
function pollGpu() {
  if (!tq) return
  while (qPend.length) {
    const q = qPend[0]!
    if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break
    qPend.shift()
    const disjoint = gl.getParameter(tq.GPU_DISJOINT_EXT)
    const ns = gl.getQueryParameter(q, gl.QUERY_RESULT) as number
    if (!disjoint) {
      gpuMs = gpuMs * 0.9 + (ns / 1e6) * 0.1
      if (meas.on) meas.gpu.push(ns / 1e6)
    }
    qPool.push(q)
  }
}

/* ---------- 프레임 ---------- */
let last = 0
let orbitK = 0 // 0–1 공전 램프 (3s 뒤 4s inout, 입력 300ms 안 0)
let orbitRate = 1 * DEG // 장소·상태별 공전 속도 (2s·5s 이즈)
let fgCapK = 1
const fgVis: number[] = []
const fgArea = new Float32Array(FG_N)
const fgSx = new Float32Array(FG_N)
const fgSy = new Float32Array(FG_N)
const fgKeep = new Uint8Array(FG_N)
let fgMoveK = 0
let capMoving = false // 렌더용: 드래그 중 장면
const t0 = performance.now()
function frame(now: number, timed = false) {
  pending = false
  countWake()
  if (!timed) rafSeenAt = performance.now()
  power = powerState(now)
  const iv = FRAME_MS[power]
  if (!timed && now - lastDraw < iv - 4) {
    schedule()
    return
  }
  draw(now)
  drawnAll++
  schedule()
}
let drawnAll = 0
let skipMask = 0
let rsOverride = 0 // 측정용: 해상도 배율 고정

interface DrawOpt {
  capture?: boolean
}
function draw(now: number, opt: DrawOpt = {}) {
  if (!scene || !starVao || !cloudVao || !dustRT || !emitRT) return
  const j0 = performance.now()
  pollGpu()
  const dt = last ? Math.min(100, now - last) : 16.7
  const interval = last ? now - last : 0
  last = now
  lastDraw = performance.now() // 예약 기준은 실제 시각(rAF 타임스탬프는 몇 ms 앞설 수 있다)
  // 쉼 크로스페이드(2s) · 돌아옴(600ms)
  if (power === 'rest') restK = Math.min(1, restK + dt / 2000)
  else restK = Math.max(0, restK - dt / 600)
  const ramp = smooth01((now - wakeAt) / 600)
  sheetK += ((sheetOpen ? 1 : 0) - sheetK) * Math.min(1, dt / 450)
  lightK += ((lightOn ? 1 : 0) - lightK) * (reduced() ? 1 : Math.min(1, dt / 680))
  calmK += ((calm ? 1 : 0) - calmK) * Math.min(1, dt / 300)
  const spd = (1 - smooth01(restK)) * (opt.capture ? 1 : ramp) * (1 - 0.67 * sheetK) * (1 - 0.7 * calmK) // 설정 시트·편집 중: 느리게
  // 은하 시계: 회전 켬 1 · 느리게 ⅓ · 끔 0
  simT += (dt / 1000) * ROT[rot] * spd
  // 관성 (τ 0.5s, 느리게 0.25s, 최대 1.2s): 구 위에서 그 축으로 계속 구르다 멈춘 자세에 머문다
  if (!drag) {
    if (reducedOS || now - releasedAt > 1200) user.wv = [0, 0, 0]
    const w = Math.hypot(user.wv[0], user.wv[1], user.wv[2])
    if (w > 1e-9 && !flight) {
      orient = qNorm(qMul(orient, qAxis(user.wv, -w * dt)))
      const k = Math.exp(-dt / (rot === 'slow' ? 250 : 500))
      user.wv = w * k < 2e-7 ? [0, 0, 0] : [user.wv[0] * k, user.wv[1] * k, user.wv[2] * k]
      if (w * k < 2e-7) anchorDirty = true
    }
    // 자동 공전 (design-v4 §7-1): 마지막 입력 3s 뒤 4s inout, 입력이 오면 300ms 안에 0. 깊은 대기 0.3°/s(5s 이즈)
    const want = !reduced() && !flight && now - lastInput > 3000 ? 1 : 0
    orbitK += want > orbitK ? Math.min(want - orbitK, dt / 4000) : Math.max(want - orbitK, -dt / 300)
    const base = power === 'deep' ? 0.3 : rot === 'slow' ? 0.4 : 1.0
    const tgt = (place.orbit === 0 ? 0 : Math.min(base, place.orbit)) * DEG // 장소·상태가 바뀌면 2s(깊은 대기 5s)에 걸쳐
    orbitRate += (tgt - orbitRate) * Math.min(1, dt / (power === 'deep' ? 1700 : 700))
    // 사용자가 만든 지금 자세에서 이어서, 은하 축 둘레로(은하 자전과 같은 방향) 아주 느리게
    if (!flight && orbitK > 0) orient = qNorm(qMul(qAxis(YAX, -(orbitRate * easeInOut(orbitK) * spd * dt) / 1000), orient))
  } else orbitK = Math.max(0, orbitK - dt / 300)
  // 집중의 시계: 지금 시각의 각도를 따라간다(쉼에서 돌아오면 ≈600ms에 걸쳐 맞는 각도로), 끌면 그 자세에서 이어서
  if (place.id === 'focus' && !flight && !reduced()) {
    if (drag || Math.hypot(user.wv[0], user.wv[1], user.wv[2]) > 1e-9) focusBase = qMul(qAxis(YAX, focusDisp), orient)
    else {
      const want = clockAngle() ?? focusAngle(now)
      focusDisp = Math.abs(want - focusDisp) > 0.5 * DEG ? focusDisp + (want - focusDisp) * Math.min(1, dt / 200) : want
      orient = qMul(qAxis(YAX, -focusDisp), focusBase)
    }
  }
  const st = curCam(now)
  SEAT[0] = st.c.seat[0]
  SEAT[1] = st.c.seat[1]
  if (st.flying && prevFlightQ && dt > 0 && !flight?.fade) flightPeak = Math.max(flightPeak, (qAngle(prevFlightQ, st.c.q) / DEG / dt) * 1000)
  prevFlightQ = st.flying ? st.c.q : null
  // 카메라 호흡: 은하 축 둘레 ±3° · 카메라 가로축 ±1.5° · 거리 ±2% — 동작 줄이기·회전 끔이면 없음
  const bk = (reduced() ? 0 : 1) * spd
  const tt = (now - t0) / 1000
  const settle = 1 // design-m1 #1: 앱 열기에 카메라 진입 비행 없음 (오늘 자세에서 노출만 55 → 100%)
  const dist = st.c.dist * user.zoom * (1 + 0.02 * bk * Math.sin((tt / 24) * Math.PI * 2)) * (reducedOS ? 1 : settle)
  let cq = qMul(qAxis(YAX, -3 * DEG * bk * Math.sin((tt / 40) * Math.PI * 2)), st.c.q)
  cq = qMul(cq, qAxis([1, 0, 0], 1.5 * DEG * bk * Math.sin((tt / 31) * Math.PI * 2 + 1)))
  const target = st.c.t
  const back = qRot(cq, [0, 0, 1])
  const eye: V3 = [target[0] + back[0] * dist, target[1] + back[1] * dist, target[2] + back[2] * dist]
  lastEye = eye
  lastBasis = { s: qRot(cq, [1, 0, 0]), u: qRot(cq, [0, 1, 0]), f: [-back[0], -back[1], -back[2]] }
  const vp = viewProj(eye, qRot(cq, [1, 0, 0]), qRot(cq, [0, 1, 0]), [-back[0], -back[1], -back[2]], FOV * DEG, W / H, 0.02, 3000)
  const entrance = opt.capture ? 1 : Math.min(1, (now - readyAt) / 1400)
  updateRing(vp.m, target, now)
  const expo = st.c.expo * (0.55 + 0.45 * (1 - Math.pow(1 - entrance, 3))) * (1 - 0.15 * st.c.fx) * (1 - st.c.dim) * (1 - 0.35 * sheetK) * extExpo * (1 + 0.08 * swellK(now)) // 시트: 노출 ×0.65 · V13 원반 부풂 +8%

  // 상태별 해상도: 타깃 안의 일부만 쓴다
  // 비행 중 동적 해상도 ×0.8 (움직임이 가려 준다 — 원반 가까이 채우기 비용 ↓)
  // 총 픽셀 상한 4.0MP (power-budget §2: iPad 11\" DPR 2 = 4.0MP)
  const pxCap = Math.min(1, Math.sqrt(3.6e6 / (W * H))) // M1: 3.6MP (앱 위에서 활동 GPU 5ms 여유)
  const rs = rsOverride ? rsOverride : opt.capture ? 1 : (flight ? 1 : (place.rsK ?? 1)) * pxCap * (st.flying ? Math.min(0.8, RSCALE[power]) : RSCALE[power])
  const sw = Math.max(2, Math.round(W * rs))
  const sh = Math.max(2, Math.round(H * rs))
  const cw = Math.max(1, sw >> 1)
  const ch = Math.max(1, sh >> 1)
  const px = sh / 2 / Math.tan((FOV * DEG) / 2)
  const sdpr = dpr * rs

  let q: WebGLQuery | null = null
  if (tq && !opt.capture) {
    q = qPool.pop() ?? gl.createQuery()
    gl.beginQuery(tq.TIME_ELAPSED_EXT, q)
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, scene.fb)
  gl.viewport(0, 0, sw, sh)
  gl.clearColor(0, 0, 0, 1)
  gl.clear(gl.COLOR_BUFFER_BIT)
  gl.enable(gl.BLEND)
  // 1) 별 (가산) — 1층 먼 하늘 · 2층 헤일로 · 3층 원반
  gl.blendFunc(gl.ONE, gl.ONE)
  const S = P.star
  gl.useProgram(S.p)
  gl.uniformMatrix4fv(S.u.uVP!, false, vp.m)
  gl.uniform3f(S.u.uCam!, eye[0], eye[1], eye[2])
  gl.uniform1f(S.u.uTime!, simT)
  gl.uniform1f(S.u.uPx!, px)
  gl.uniform1f(S.u.uExpo!, STAR)
  gl.uniform1f(S.u.uFocus!, dist)
  gl.uniform1f(S.u.uDof!, (dist < 12 ? 1 : 0.35) * (1 + 0.6 * st.c.fx))
  gl.uniform1f(S.u.uDpr!, sdpr)
  gl.uniform2f(S.u.uArm!, ARM[0], ARM[1])
  gl.uniform1f(S.u.uRest!, smooth01(restK))
  gl.activeTexture(gl.TEXTURE2)
  gl.bindTexture(gl.TEXTURE_2D, armTex)
  gl.uniform1i(S.u.uArmTex!, 2)
  gl.activeTexture(gl.TEXTURE0)
  gl.bindVertexArray(starVao)
  if (!(skipMask & 1)) gl.drawArrays(gl.POINTS, 0, starN)
  // 1b) 4층 전경 별
  fgUpdate(dt, eye, vp.m, sdpr, st.flying || !!drag || Math.hypot(user.wv[0], user.wv[1]) > 1e-9 || capMoving, opt.capture ? 1 : spd)
  {
    const F = P.fg
    gl.useProgram(F.p)
    gl.uniformMatrix4fv(F.u.uVP!, false, vp.m)
    gl.uniform3f(F.u.uCam!, eye[0], eye[1], eye[2])
    gl.uniform3f(F.u.uFgCam!, fgCam[0], fgCam[1], fgCam[2])
    gl.uniform1f(F.u.uR!, FG_R)
    gl.uniform1f(F.u.uDpr!, sdpr)
    gl.uniform1f(F.u.uK!, fgK(eye))
    gl.uniform1f(F.u.uMaxPx!, (rot === 'slow' ? 8 : 22) * sdpr) // 가까운 보케 원판은 22px까지(개수·점유 상한 안)
    gl.uniform1f(F.u.uCA!, rot === 'slow' ? 0 : 0.9 * sdpr)
    gl.uniform4fv(F.u['uMask[0]']!, maskNdc)
    gl.uniform2f(F.u.uFeather!, (24 / cssW) * 2, (24 / cssH) * 2)
    gl.bindVertexArray(fgVao)
    gl.drawArrays(gl.POINTS, 0, FG_N)
  }
  // 1c) 데이터 별 (오늘의 별자리·복습 카드·노트 별): 별 프로그램 그대로, 패턴과 함께 돈다
  syncZones()
  if (anchorDirty && !st.flying && !opt.capture) emitAnchors(vp.m, target)
  lastVP = vp.m
  // 2) 구름 (장면의 반 해상도): 먼지 투과율 T (곱하기) · 성운·팔 빛 E (더하기)
  const C = P.cloud
  gl.useProgram(C.p)
  gl.uniformMatrix4fv(C.u.uVP!, false, vp.m)
  gl.uniform3f(C.u.uCam!, eye[0], eye[1], eye[2])
  gl.uniform1f(C.u.uTime!, simT)
  gl.uniform3f(C.u.uRight!, vp.right[0], vp.right[1], vp.right[2])
  gl.uniform3f(C.u.uUp!, vp.up[0], vp.up[1], vp.up[2])
  gl.uniform1f(C.u.uGain!, 1)
  gl.bindVertexArray(dustVao)
  gl.bindFramebuffer(gl.FRAMEBUFFER, dustRT.fb)
  gl.viewport(0, 0, cw, ch)
  gl.clearColor(1, 1, 1, 1)
  gl.clear(gl.COLOR_BUFFER_BIT)
  gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_COLOR)
  gl.uniform1f(C.u.uKindMin!, 0)
  gl.uniform1f(C.u.uKindMax!, 0)
  if (!(skipMask & 2)) gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, dustN)
  gl.bindVertexArray(cloudVao)
  gl.bindFramebuffer(gl.FRAMEBUFFER, emitRT.fb)
  gl.clearColor(0, 0, 0, 1)
  gl.clear(gl.COLOR_BUFFER_BIT)
  gl.blendFunc(gl.ONE, gl.ONE)
  gl.uniform1f(C.u.uKindMin!, 1)
  gl.uniform1f(C.u.uKindMax!, 4)
  gl.uniform1f(C.u.uGain!, EMIT)
  if (!(skipMask & 2)) gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, cloudN)
  // 3) 장면 = (별 + E) × T
  const src = (t: RT, uw: number, uh: number) => [uw / t.w, uh / t.h, (uw - 0.5) / t.w, (uh - 0.5) / t.h] as const
  gl.bindFramebuffer(gl.FRAMEBUFFER, scene.fb)
  gl.viewport(0, 0, sw, sh)
  gl.bindVertexArray(vaoEmpty)
  gl.useProgram(P.blit.p)
  gl.uniform1i(P.blit.u.uTex!, 0)
  gl.uniform4f(P.blit.u.uSrc!, ...src(emitRT, cw, ch))
  gl.bindTexture(gl.TEXTURE_2D, emitRT.tex)
  gl.uniform3f(P.blit.u.uFloor!, 0, 0, 0)
  gl.blendFunc(gl.ONE, gl.ONE)
  gl.drawArrays(gl.TRIANGLES, 0, 3)
  // 먼지 투과율 하한: 비스듬히 볼 땐 짙은 갈색(0.40), 옆(edge-on)에서는 원반을 가르는 진한 먼지띠(0.16)
  const edgeCam = 1 - smooth01((Math.abs(eye[1] - target[1]) / dist - 0.08) / 0.27)
  gl.uniform3f(P.blit.u.uFloor!, 0.32 - 0.16 * edgeCam, 0.24 - 0.13 * edgeCam, 0.19 - 0.11 * edgeCam)
  gl.bindTexture(gl.TEXTURE_2D, dustRT.tex)
  gl.blendFunc(gl.DST_COLOR, gl.ZERO)
  gl.drawArrays(gl.TRIANGLES, 0, 3)
  gl.disable(gl.BLEND)
  // 4) 블룸
  gl.useProgram(P.down.p)
  let from = scene
  let fw = sw
  let fh = sh
  const used: Array<[number, number]> = []
  for (const m of skipMask & 4 ? [] : mips) {
    const first = m === mips[0]
    const mw = Math.max(1, fw >> (first ? 2 : 1))
    const mh = Math.max(1, fh >> (first ? 2 : 1))
    const D = first ? P.down4 : P.down
    gl.useProgram(D.p)
    gl.bindFramebuffer(gl.FRAMEBUFFER, m.fb)
    gl.viewport(0, 0, mw, mh)
    gl.bindTexture(gl.TEXTURE_2D, from.tex)
    gl.uniform1i(D.u.uTex!, 0)
    gl.uniform2f(D.u.uTexel!, 1 / from.w, 1 / from.h)
    gl.uniform4f(D.u.uSrc!, ...src(from, fw, fh))
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    used.push([mw, mh])
    from = m
    fw = mw
    fh = mh
  }
  gl.useProgram(P.up.p)
  gl.enable(gl.BLEND)
  gl.blendFunc(gl.ONE, gl.ONE)
  for (let i = skipMask & 4 ? 0 : mips.length - 1; i > 0; i--) {
    const a = mips[i]!
    const b = mips[i - 1]!
    const ua = used[i]!
    const ub = used[i - 1]!
    gl.bindFramebuffer(gl.FRAMEBUFFER, b.fb)
    gl.viewport(0, 0, ub[0], ub[1])
    gl.bindTexture(gl.TEXTURE_2D, a.tex)
    gl.uniform1i(P.up.u.uTex!, 0)
    gl.uniform2f(P.up.u.uTexel!, 1 / a.w, 1 / a.h)
    gl.uniform4f(P.up.u.uSrc!, ...src(a, ua[0], ua[1]))
    gl.uniform1f(P.up.u.uW!, 1)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }
  gl.disable(gl.BLEND)
  // 5) 합성 (캔버스 전체 크기)
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  gl.viewport(0, 0, W, H)
  gl.useProgram(P.comp.p)
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, scene.tex)
  gl.uniform1i(P.comp.u.uScene!, 0)
  gl.activeTexture(gl.TEXTURE1)
  gl.bindTexture(gl.TEXTURE_2D, mips[0]!.tex)
  gl.uniform1i(P.comp.u.uBloom!, 1)
  gl.uniform4f(P.comp.u.uSrc!, ...src(scene, sw, sh))
  gl.uniform4f(P.comp.u.uSrcB!, ...src(mips[0]!, used[0]?.[0] ?? 1, used[0]?.[1] ?? 1))
  gl.uniform1f(P.comp.u.uBloomK!, 0.085)
  gl.uniform1f(P.comp.u.uExposure!, expo * 0.55)
  gl.uniform1f(P.comp.u.uAspect!, W / H)
  gl.uniform1f(P.comp.u.uRest!, smooth01(restK))
  gl.uniform1f(P.comp.u.uPlate!, lightK)
  phaseK += (phaseTo - phaseK) * Math.min(1, dt / 60000) // 시간대 위상: 60초에 걸쳐
  gl.uniform3f(P.comp.u.uBg!, 0.004 + 0.002 * Math.max(0, phaseK) + 0.003 * Math.max(0, -phaseK), 0.006 + 0.003 * Math.max(0, phaseK) + 0.001 * Math.max(0, -phaseK), 0.014 + 0.006 * Math.max(0, phaseK) - 0.002 * Math.max(0, -phaseK))
  gl.uniform4f(P.comp.u.uTint!, tint[0], tint[1], tint[2], tint[3] * (1 - lightK))
  gl.uniform3f(P.comp.u.uTintC!, SEAT[0], 1 - SEAT[1], 0.38)
  gl.uniform4fv(P.comp.u['uZone[0]']!, zoneUv)
  gl.uniform2f(P.comp.u.uZoneF!, (cssW < 600 ? 64 : 120) / cssW, (cssW < 600 ? 64 : 120) / cssH)
  gl.drawArrays(gl.TRIANGLES, 0, 3)
  gl.activeTexture(gl.TEXTURE0)
  // 사건 층: 데이터 별 · 반짝 · 선 (캔버스에 바로, 화면 px 고정)
  drawEvents(vp.m, now)
  gl.bindVertexArray(null)
  if (q && tq) {
    gl.endQuery(tq.TIME_ELAPSED_EXT)
    qPend.push(q)
  }
  if (opt.capture) return

  // 계측
  const js = performance.now() - j0
  let sync = 0
  if (gpuSync && meas.on) {
    const px1 = new Uint8Array(4)
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px1)
    sync = performance.now() - j0
  }
  jsMs = jsMs * 0.95 + js * 0.05
  if (meas.on) {
    meas.drawn++
    meas.js.push(js)
    if (sync) meas.gpu.push(sync)
    if (interval > 0) meas.iv.push(interval)
    meas.states[power] = (meas.states[power] ?? 0) + 1
  }
  if (interval > 0 && interval < 250) {
    frames.push(interval)
    if (frames.length > 240) frames.shift()
    if (st.flying && flight && now - flight.t0 > 50) {
      // 비행 첫 프레임 간격은 평소(30fps 타이머) 박자에서 넘어오는 간격이라 뺀다
      flightFrames.push(interval)
      flightMax = Math.max(flightMax, interval)
    }
  }
  fpsN++
  if (now - fpsT > 1000) {
    fps = Math.round((fpsN * 1000) / (now - fpsT))
    wake.rate = Math.round((wake.n * 1000) / (now - wake.t))
    wake.n = 0
    wake.t = now
    fpsN = 0
    fpsT = now
    // 발열 추정 (design-v4 §7-4): 활동 중 프레임 p95가 예산의 1.5배를 10초 넘게 → 2분 동안 한 단계 낮춘다
    const s = frames.slice(-60).sort((a, b) => a - b)
    const p95 = s[Math.floor(0.95 * (s.length - 1))] ?? 0
    // 창이 가려지거나 탭이 느려져 생긴 긴 간격은 발열이 아니다 → 실제로 계속 그리고(초당 20장 넘게) GPU 시간이 길 때만 센다
    const busy = fps >= 20 && (tq ? gpuMs > FRAME_MS.active : true)
    hotSec = power === 'active' && busy && p95 > FRAME_MS.active * 1.5 ? hotSec + 1 : 0
    if (hotSec >= 10) {
      thermalUntil = now + 120_000
      hotSec = 0
    }
  }
  if (now - hudT > 500 && hudOn) {
    hudT = now
    const s = frames.slice().sort((a, b) => a - b)
    const p95 = s[Math.floor(0.95 * (s.length - 1))] ?? 0
    const lf = flightLog[flightLog.length - 1]
    lastHud =
      `${power}${lowPower ? ' · 저전력' : ''}${now < thermalUntil ? ' · 발열' : ''} · ${fps} fps · 깨우기 ${wake.rate}/s · ×${rs} ${sw}×${sh}\n` +
      `p95 ${p95.toFixed(1)}ms · js ${jsMs.toFixed(2)}ms · gpu ${tq ? gpuMs.toFixed(2) + 'ms' : '쿼리 없음'}\n` +
      `별 ${(starN / 1000).toFixed(0)}k · 구름 ${(cloudN / 1000).toFixed(1)}k · 등급 ${tier} · 블룸 ${mips.length}단 · ${hdr ? 'HDR' : 'LDR'}\n` +
      `전경 ${fgStat.visible}/${fgStat.cap}개 · 점유 ${(fgStat.area * 100).toFixed(2)}% · ${fgStat.maxSpeed.toFixed(0)}px/s\n` +
      `생성 ${genMs.toFixed(0)}ms(Worker) · 올리기 ${uploadMs.toFixed(0)}ms${lf ? `\n마지막 비행 ${lf.to} ${Math.round(lf.ms)}ms 최장 ${lf.maxFrame.toFixed(1)}ms` : ''}`
    opts.onHud?.(lastHud)
  }
}

/** 전경 별의 밀도·밝기: 원반 안에서는 1, 은하 밖(오늘·플래너)에서는 낮게 */
function fgK(eye: V3) {
  const inDisk = Math.exp(-Math.abs(eye[1]) / 3) * Math.exp(-Math.max(0, Math.hypot(eye[0], eye[2]) - 15) / 6)
  void inDisk
  return 1 // 전경 별은 원반이 아니라 '카메라 주변 국소 별' — 어느 장소에서든 같은 밝기
}
/**
 * 전경 별 고르기 (design-v4 §7-2) — 셰이더와 같은 식으로 600개를 투영해
 * ① 감싸기 기준(가상 카메라)의 속도에 상한: 공전 ≤ 24px/s(느리게 10) · 드래그·비행 ≤ 600px/s · 표류 ≤ 4px/s
 * ② 보이는 별 가운데 고정 순서대로 개수(iPad ≤ 40 · 폰 ≤ 20, 느리게 12·6, 깊은 대기 ×0.3)와 점유(≤ 1.5%, 느리게 0.5%) 안에서만 남긴다
 * ③ 가중치는 250ms에 걸쳐 바뀐다(튀지 않게)
 */
function fgUpdate(dt: number, eye: V3, m: Float32Array, sdpr: number, moving: boolean, spd: number) {
  const pxPerRad = cssH / 2 / Math.tan((FOV * DEG) / 2)
  const orbiting = orbitK > 0.01 && orbitRate > 0.01 * DEG
  const capPx = moving ? 600 : orbiting ? (rot === 'slow' ? 10 : 24) : 4
  // 화면 속도 ≈ 이동 속도 / 거리 × px — 가장 가까이 보이는 0.45u 기준으로 묶는다(회전 성분은 모든 층이 같이 받는다)
  const vmax = reducedOS ? 0 : ((capPx / pxPerRad) * 0.45 * spd * dt) / 1000
  if (fgPrevEye) {
    const d = sub(eye, fgPrevEye)
    const l = Math.hypot(d[0], d[1], d[2])
    const k = l > vmax ? vmax / l : 1
    fgCam[0] += d[0] * k
    fgCam[1] += d[1] * k
    fgCam[2] += d[2] * k
  } else {
    fgCam[0] = eye[0]
    fgCam[1] = eye[1]
    fgCam[2] = eye[2]
  }
  fgPrevEye = eye
  const phone = Math.min(cssW, cssH) < 600
  // 가만히: 조용하게(데스크톱·iPad 12 · 폰 8) · 드래그·비행: 많이(80 · 40) — 올라갈 땐 0.3s, 내려갈 땐 1.5s에 걸쳐
  fgMoveK += ((moving ? 1 : 0) - fgMoveK) * Math.min(1, dt / (moving ? 300 : 1500))
  const idleCap = rot === 'slow' ? (phone ? 6 : 12) : phone ? 8 : 12
  const moveCap = rot === 'slow' ? (phone ? 6 : 12) : phone ? 36 : 72 // 바뀌는 동안 사라지는 별까지 세어도 ≤ 80
  let cap = Math.round(idleCap + (moveCap - idleCap) * fgMoveK)
  if (reducedOS) cap = 6
  const deepK = power === 'deep' ? 0.3 : 1
  fgCapK += (deepK - fgCapK) * Math.min(1, dt / 5000)
  // 설정 시트 ×0.3 · 편집 중 0 · 낮(건판) 0
  cap = Math.max(0, Math.round(cap * fgCapK * (1 - 0.7 * sheetK) * (1 - calmK) * (1 - lightK)))
  const areaCap = (rot === 'slow' ? 0.005 : 0.015) * cssW * cssH
  const K = fgK(eye)
  const maxCss = rot === 'slow' ? 8 : 22
  const R = FG_R
  // 프레임마다 새 배열을 만들지 않는다(GC 멈칫 방지)
  const vis = fgVis
  vis.length = 0
  const area = fgArea.fill(0)
  const sx = fgSx
  const sy = fgSy
  for (let i = 0; i < FG_N; i++) {
    let rx = fgPos[i * 4]! - fgCam[0] + R
    let ry = fgPos[i * 4 + 1]! - fgCam[1] + R
    let rz = fgPos[i * 4 + 2]! - fgCam[2] + R
    rx = rx - 2 * R * Math.floor(rx / (2 * R)) - R
    ry = ry - 2 * R * Math.floor(ry / (2 * R)) - R
    rz = rz - 2 * R * Math.floor(rz / (2 * R)) - R
    const d = Math.hypot(rx, ry, rz)
    const fade = smooth01((d - 0.3) / 0.3) * (1 - smooth01((d - 0.7 * R) / (0.28 * R)))
    if (fade <= 0) continue
    const x = eye[0] + rx
    const y = eye[1] + ry
    const z = eye[2] + rz
    const cw_ = m[3]! * x + m[7]! * y + m[11]! * z + m[15]!
    if (cw_ <= 0) continue
    const nx = (m[0]! * x + m[4]! * y + m[8]! * z + m[12]!) / cw_
    const ny = (m[1]! * x + m[5]! * y + m[9]! * z + m[13]!) / cw_
    if (nx < -1.02 || nx > 1.02 || ny < -1.02 || ny > 1.02) continue
    let sig = 0.45 * sdpr + (d < 1 ? (1 - d) * (1 - d) * 6 * sdpr : 0)
    sig = Math.min(sig, (maxCss * sdpr) / 4)
    const peak = (((fgPos[i * 4 + 3]! / (d * d)) * K * fade) * 40) / (6.2831853 * sig * sig) * (1 + 3 * smooth01((0.95 - d) / 0.4))
    if (Math.min(peak, 0.55) < 0.012) continue
    const sc = sig / sdpr
    area[i] = Math.PI * (2 * sc) * (2 * sc)
    sx[i] = ((nx + 1) / 2) * cssW
    sy[i] = ((1 - ny) / 2) * cssH
    vis.push(i)
  }
  vis.sort((a, b) => fgKey[a]! - fgKey[b]!)
  const keep = fgKeep.fill(0)
  let n = 0
  let A = 0
  for (const i of vis) {
    if (n >= cap) break
    if (A + area[i]! > areaCap) continue
    keep[i] = 1
    n++
    A += area[i]!
  }
  const a = Math.min(1, dt / 250)
  const aOut = Math.min(1, dt / 600) // 사라질 땐 천천히
  const aFast = Math.min(1, dt / 30)
  let shown = 0
  let shownA = 0
  let vmaxPx = 0
  for (let i = 0; i < FG_N; i++) {
    // 화면 속도: 감싸기 기준을 묶어도 시선 회전(드래그·비행)은 모든 층이 같이 받는다 → 상한을 넘는 별은 50ms 안에 감춘다
    let v = 0
    if (area[i]! > 0 && fgSeen[i] && dt > 0) v = (Math.hypot(sx[i]! - fgScr[i * 2]!, sy[i]! - fgScr[i * 2 + 1]!) * 1000) / dt
    const fast = v > capPx * 0.8 // 상한의 80%에서 감추기 시작 — 사라지는 동안에도 상한을 넘지 않게
    const tgtW = keep[i] && !fast ? 1 : 0
    fgW[i]! += (tgtW - fgW[i]!) * (fast ? aFast : tgtW > fgW[i]! ? a : aOut)
    if (fgW[i]! < 0.002) fgW[i] = 0
    if (fgW[i]! > 0.3 && area[i]! > 0) {
      shown++
      shownA += area[i]!
      if (v < 5000) vmaxPx = Math.max(vmaxPx, v)
    }
    if (area[i]! > 0) {
      fgScr[i * 2] = sx[i]!
      fgScr[i * 2 + 1] = sy[i]!
    }
    fgSeen[i] = area[i]! > 0 ? 1 : 0
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, fgWBuf)
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, fgW)
  fgStat.visible = shown
  fgStat.cap = cap
  fgStat.area = shownA / (cssW * cssH)
  // 최고 속도는 1초 창에서
  const now = performance.now()
  fgStat.speedWin = Math.max(fgStat.speedWin, vmaxPx)
  if (now - fgStat.speedT > 1000) {
    fgStat.maxSpeed = fgStat.speedWin
    fgStat.speedWin = 0
    fgStat.speedT = now
  }
}

/* ---------- 검증 · 측정 · 렌더용 ---------- */
const debug = {
  fly: flyTo,
  rot: (r: Rot) => {
    userRot = r
    applyRot()
    updateButtons()
    touch()
  },
  stats: () => {
    const s = frames.slice().sort((a, b) => a - b)
    return { power, fps, wakes: wake.rate, p95: s[Math.floor(0.95 * (s.length - 1))] ?? 0, jsMs, gpuMs: tq ? gpuMs : null, stars: starN, clouds: cloudN, tier, W, H, genMs, uploadMs, fg: { ...fgStat }, flights: flightLog.slice(), simT, orient, timerQuery: !!tq, wakeAll, drawnAll, restK, stopped }
  },
  ring: (on: boolean) => {
    ringOn = on
    touch()
  },
  /** 렌더용: 집중 타이머 진행 (0–1) */
  focusProgress: (f: number) => {
    focusT0 = performance.now() - f * FOCUS_MIN * 60_000
  },
  clean: (on: boolean) => {
    cleanMode = on
    opts.onClean?.(on)
    updateMask(cssW, cssH, !on)
  },
  tune: (emit: number, star: number, armBase?: number, armAmp?: number) => {
    EMIT = emit
    STAR = star
    if (armBase !== undefined && armAmp !== undefined) ARM = [armBase, armAmp]
    touch()
  },
  /** 드래그 흉내: (dx, dy)px를 steps번에 나눠 굴리고, 매 걸음 카메라 up·시선의 변화(튐·뒤집힘 검사)를 잰다 */
  drag: (dx: number, dy: number, steps = 60, zoom?: number) => {
    let maxStep = 0
    let maxUp = 0
    for (let k = 0; k < steps; k++) {
      const q0 = orient
      applyDrag(dx / steps, dy / steps, 16)
      maxStep = Math.max(maxStep, qAngle(q0, orient) / DEG)
      const u0 = qRot(q0, [0, 1, 0])
      const u1 = qRot(orient, [0, 1, 0])
      maxUp = Math.max(maxUp, Math.acos(Math.min(1, u0[0] * u1[0] + u0[1] * u1[1] + u0[2] * u1[2])) / DEG)
    }
    user.wv = [0, 0, 0]
    if (zoom !== undefined) user.zoom = zoom
    touch()
    const back = qRot(orient, [0, 0, 1])
    return { stepDeg: Math.hypot(dx, dy) / steps * 0.15, maxStepDeg: maxStep, maxUpChangeDeg: maxUp, elevationDeg: (Math.asin(Math.max(-1, Math.min(1, back[1]))) / DEG) }
  },
  home: () => goHome(),
  setTime: (t: number) => {
    simT = t
    touch()
  },
  /** 마지막 입력을 sec초 전으로 (상태 전환 확인용) */
  idle: (sec: number) => {
    lastInput = performance.now() - sec * 1000
    kick()
  },
  /** 측정용: 활동 상태 fps 상한을 풀어 기기 최대 처리량(=실제 프레임 비용)을 본다 */
  uncap: (on: boolean) => {
    FRAME_MS.active = on ? 1 : 1000 / 60
    touch()
  },
  /** 측정용: 1 별 · 2 구름 · 4 블룸 건너뛰기 (비용 나누기) */
  skip: (m: number) => {
    skipMask = m
    touch()
  },
  rs: (x: number) => {
    rsOverride = x
    touch()
  },
  lowPower: (on: boolean) => {
    lowPower = on
    touch()
  },
  force: (s: Power | null) => {
    forced = s
    if (s !== 'rest') restK = 0
    kick()
  },
  /** sec초 동안 지금 상태를 잰다: 초당 그린 프레임 · 초당 깨우기 · JS ms · GPU ms(타이머 쿼리, 없으면 1픽셀 동기화 근사) */
  measure: async (sec: number, state?: Power | 'auto') => {
    if (state && state !== 'auto') forced = state
    if (state === 'auto') forced = null
    if (state !== 'auto' && state !== 'rest') restK = 0
    gpuSync = !tq
    if (state !== 'auto') kick()
    await new Promise((r) => setTimeout(r, 1200)) // 전환 안정
    Object.assign(meas, { on: true, drawn: 0, wakes: 0, js: [], gpu: [], iv: [], t0: performance.now(), states: {} })
    const w0 = wakeTotal()
    await new Promise((r) => setTimeout(r, sec * 1000))
    meas.on = false
    gpuSync = false
    const el = (performance.now() - meas.t0) / 1000
    const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0)
    const p95 = (a: number[]) => (a.length ? a.slice().sort((x, y) => x - y)[Math.floor(0.95 * (a.length - 1))]! : 0)
    const res = {
      state: state ?? power,
      states: meas.states,
      drawnPerSec: +(meas.drawn / el).toFixed(1),
      wakesPerSec: +((wakeTotal() - w0) / el).toFixed(1),
      jsMs: +avg(meas.js).toFixed(3),
      jsP95: +p95(meas.js).toFixed(3),
      gpuMs: +avg(meas.gpu).toFixed(3),
      gpuP95: +p95(meas.gpu).toFixed(3),
      gpuMethod: tq ? 'timer-query' : 'readPixels 동기화(JS+GPU)',
      frameP95: +p95(meas.iv).toFixed(1),
      res: `${Math.round(W * RSCALE[forced ?? power])}×${Math.round(H * RSCALE[forced ?? power])}`,
    }
    forced = null
    return res
  },
  /** 가상 화면 렌더: w×h CSS · DPR 2로 오프스크린 크기를 바꿔 한 장 그리고 PNG를 로컬 저장 도우미로 보낸다 */
  capture: async (name: string, w: number, h: number, setup?: { place?: string; az?: number; el?: number; roll?: number; zoom?: number; t?: number; fg?: boolean; moving?: boolean; ring?: boolean; progress?: number }) => {
    const keep = { orient, zoom: user.zoom, simT, clean: cleanMode }
    opts.onClean?.(true)
    clearTimeout(timerId)
    cancelAnimationFrame(rafId)
    pending = false
    resize(w, h, 2)
    updateMask(w, h, false)
    if (setup?.t !== undefined) simT = setup.t
    const pl0 = setup?.place ? PLACES.find((p) => p.id === setup.place) : null
    if (pl0) {
      place = pl0
      flight = null
      orient = homeOrient(pl0)
      if (pl0.id === 'focus') focusEnter(orient)
      if (setup?.progress !== undefined) focusT0 = performance.now() - setup.progress * FOCUS_MIN * 60_000
      setTitle()
    }
    if (setup?.az !== undefined) orient = orientAzEl(setup.az, setup.el ?? 30, setup.roll ?? TILT)
    if (setup?.zoom !== undefined) user.zoom = setup.zoom
    orbitK = setup?.fg ? 1 : 0
    capMoving = !!setup?.moving
    if (capMoving) fgMoveK = 1
    const tnow = performance.now()
    // 전경 별 가중치를 차오르게 몇 번 그린다 (같은 자리)
    const st0 = simT
    const o0 = orient
    for (let k = 0; k < 12; k++) {
      simT = st0
      orient = o0
      last = 0
      draw(tnow + k * 100, { capture: true })
    }
    simT = st0
    orient = o0
    last = 0
    draw(tnow + 1300, { capture: true })
    let outCanvas: HTMLCanvasElement = canvas
    if (setup?.ring && ringGeo) {
      // 타이머 링은 DOM(SVG) 덧층이라 캔버스에 없다 → 렌더용으로 2D에 겹쳐 그린다
      const c2 = document.createElement('canvas')
      c2.width = W
      c2.height = H
      const x = c2.getContext('2d')!
      x.drawImage(canvas, 0, 0)
      x.lineWidth = 1.5 * 2
      x.strokeStyle = 'rgba(237,231,218,.32)'
      x.beginPath()
      x.arc(ringGeo.cx, ringGeo.cy, ringGeo.r, 0, Math.PI * 2)
      x.stroke()
      x.lineWidth = 2.5 * 2
      x.lineCap = 'round'
      x.strokeStyle = '#F3D29A'
      x.beginPath()
      x.arc(ringGeo.cx, ringGeo.cy, ringGeo.r, -Math.PI / 2, -Math.PI / 2 + Math.max(0.02, ringGeo.frac) * Math.PI * 2)
      x.stroke()
      outCanvas = c2
    }
    const blob: Blob = await new Promise((r) => outCanvas.toBlob((b) => r(b!), 'image/png'))
    capMoving = false
    void name
    orient = keep.orient
    user.zoom = keep.zoom
    simT = keep.simT
    opts.onClean?.(keep.clean)
    resize()
    touch()
    return { blob, bytes: blob.size, fg: { ...fgStat } }
  },
}
function wakeTotal() {
  return wakeAll
}

/* ---------- 데이터 별 (사건 API → 3D 자리): 별 프로그램을 그대로 쓰고 kind 5(패턴과 함께, 가까워도 솎지 않음) ---------- */
let dataStars: DataStar[] = []
let lastVP: Float32Array | null = null
const dataBuf = gl.createBuffer()!
const dataVao = (() => {
  const vao = gl.createVertexArray()!
  gl.bindVertexArray(vao)
  gl.bindBuffer(gl.ARRAY_BUFFER, dataBuf)
  gl.enableVertexAttribArray(0)
  gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 32, 0)
  gl.enableVertexAttribArray(1)
  gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 16)
  gl.bindVertexArray(null)
  return vao
})()
const nowS = () => performance.now() / 1000
function levelOf(d: DataStar, t: number) {
  const k = d.dur > 0 ? Math.min(1, Math.max(0, (t - d.t0) / d.dur)) : 1
  return d.from + (d.to - d.from) * k * k * (3 - 2 * k)
}
/** 데이터 별 → 사건 층 배열 (가림 ×0.5 · 자리 부풂 · 반짝 · 책등 점) */
let dotArr = new Float32Array(0)
const DAY_INK: Record<string, [number, number, number]> = { seat: [0.478, 0.341, 0.078], branch: [0.478, 0.341, 0.078], exam: [0.659, 0.251, 0.173] }
function buildDots(t: number): number {
  if (sparkles.length) sparkles = sparkles.filter((x) => t < x.t0 + 0.6)
  const spine = place.id === 'notes' ? spineDots() : []
  const all = dataStars.concat(sparkles, spine)
  if (!all.length) return 0
  if (dotArr.length < all.length * 8) dotArr = new Float32Array(all.length * 8)
  let n = 0
  let animating = false
  const day = lightK > 0.5
  for (const d of all) {
    let lv = d.id.startsWith('spark:') ? (t - d.t0 < 0.3 ? 1.4 * Math.sin((Math.PI * (t - d.t0)) / 0.3) : 0) : levelOf(d, t)
    if (d.dur > 0 && t < d.t0 + d.dur) animating = true
    if (lv <= 0.001) continue
    // 가림: 카메라에서 원반 반대편이면 ×0.5 — 복습(아래에서)은 예외 (design-m1 0-2-2)
    if (lastEye[1] < 0 && place.id !== 'review') lv *= 0.5
    if (d.group && d.group === swellAt) lv *= 1 + 0.25 * swellK(performance.now()) // V13s 자리 부풂
    const o = n * 8
    dotArr[o] = Math.hypot(d.pos[0], d.pos[2])
    dotArr[o + 1] = Math.atan2(d.pos[2], d.pos[0])
    dotArr[o + 2] = d.pos[1]
    dotArr[o + 3] = Math.min(1.6, lv)
    const c = day ? (DAY_INK[d.group ?? ''] ?? [0.102, 0.125, 0.188]) : d.color
    dotArr[o + 4] = c[0]
    dotArr[o + 5] = c[1]
    dotArr[o + 6] = c[2]
    dotArr[o + 7] = d.size ?? 2.4
    n++
  }
  if (animating) eventUntil = Math.max(eventUntil, performance.now() + 2000) // 사건 중 활동, 끝나고 2초 뒤 평소
  return n
}
let segArr = new Float32Array(0)
function buildSegs(t: number): number {
  if (!links.length) return 0
  if (segArr.length < links.length * 8) segArr = new Float32Array(links.length * 8)
  let n = 0
  for (const l of links) {
    const k = l.dur > 0 ? Math.min(1, Math.max(0, (t - l.t0) / l.dur)) : 1
    if (k <= 0 || l.alpha <= 0.001) continue
    if (l.dur > 0 && k < 1) eventUntil = Math.max(eventUntil, performance.now() + 2000)
    const e = k * k * (3 - 2 * k)
    const b: V3 = [l.a[0] + (l.b[0] - l.a[0]) * e, l.a[1] + (l.b[1] - l.a[1]) * e, l.a[2] + (l.b[2] - l.a[2]) * e]
    const o = n * 8
    segArr[o] = Math.hypot(l.a[0], l.a[2])
    segArr[o + 1] = Math.atan2(l.a[2], l.a[0])
    segArr[o + 2] = l.a[1]
    segArr[o + 3] = l.alpha * (lastEye[1] < 0 && place.id !== 'review' ? 0.5 : 1)
    segArr[o + 4] = Math.hypot(b[0], b[2])
    segArr[o + 5] = Math.atan2(b[2], b[0])
    segArr[o + 6] = b[1]
    segArr[o + 7] = 0
    n++
  }
  return n
}
function drawEvents(m: Float32Array, now: number) {
  void now
  const t = nowS()
  const nd = buildDots(t)
  const ns = buildSegs(t)
  if (!nd && !ns) return
  const day = lightK > 0.5 ? 1 : 0
  gl.enable(gl.BLEND)
  if (day) gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_COLOR)
  else gl.blendFunc(gl.ONE, gl.ONE)
  const feather: [number, number] = [(cssW < 600 ? 64 : 120) / cssW, (cssW < 600 ? 64 : 120) / cssH]
  if (ns) {
    const L = P.seg
    gl.useProgram(L.p)
    gl.uniformMatrix4fv(L.u.uVP!, false, m)
    gl.uniform1f(L.u.uTime!, simT)
    gl.uniform4fv(L.u['uZone[0]']!, zoneUv)
    gl.uniform2f(L.u.uZoneF!, feather[0], feather[1])
    gl.uniform2f(L.u.uView!, W, H)
    gl.uniform1f(L.u.uWidth!, 0.6 * dpr)
    gl.uniform3f(L.u.uLineCol!, day ? 0.271 : 0.95, day ? 0.294 : 0.86, day ? 0.345 : 0.68)
    gl.uniform1f(L.u.uDay!, day)
    gl.bindBuffer(gl.ARRAY_BUFFER, segBuf)
    gl.bufferData(gl.ARRAY_BUFFER, segArr.subarray(0, ns * 8), gl.DYNAMIC_DRAW)
    gl.bindVertexArray(segVao)
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, ns)
  }
  if (nd) {
    const D = P.dot
    gl.useProgram(D.p)
    gl.uniformMatrix4fv(D.u.uVP!, false, m)
    gl.uniform1f(D.u.uTime!, simT)
    gl.uniform4fv(D.u['uZone[0]']!, zoneUv)
    gl.uniform2f(D.u.uZoneF!, feather[0], feather[1])
    gl.uniform1f(D.u.uDpr!, dpr)
    gl.uniform1f(D.u.uDay!, day)
    gl.bindBuffer(gl.ARRAY_BUFFER, dataBuf)
    gl.bufferData(gl.ARRAY_BUFFER, dotArr.subarray(0, nd * 8), gl.DYNAMIC_DRAW)
    gl.bindVertexArray(dataVao)
    gl.drawArrays(gl.POINTS, 0, nd)
  }
  gl.disable(gl.BLEND)
}
/* 노트 책등 위 점 (design-m1 #28): 옆모습 원반의 긴 축을 따라, 노트 별의 높이(s ∈ −1..1)에 점 하나 */
let spine: Array<{ id: string; s: number; level: number; color: [number, number, number] }> = []
function spineDots(): DataStar[] {
  const B = lastBasis
  if (!B || !spine.length) return []
  // 원반 평면 안에서 시선에 수직인 방향 = 화면 속 책등 방향
  const ax = norm([B.f[2], 0, -B.f[0]])
  const ang = -OMEGA_P * simT
  return spine.map((p) => {
    const w: V3 = [ax[0] * p.s * 11, 0.15, ax[2] * p.s * 11]
    const r = Math.hypot(w[0], w[2])
    const th = Math.atan2(w[2], w[0]) + ang
    return { id: 'spine:' + p.id, group: 'nebula', pos: [r * Math.cos(th), w[1], r * Math.sin(th)], L: 1, color: p.color, from: p.level, to: p.level, t0: 0, dur: 0, size: 2 }
  })
}
function dataWorld(d: DataStar): V3 {
  const r = Math.hypot(d.pos[0], d.pos[2])
  const th = Math.atan2(d.pos[2], d.pos[0]) + OMEGA_P * simT
  return [r * Math.cos(th), d.pos[1], r * Math.sin(th)]
}
function projectCss(m: Float32Array, p: V3): [number, number] | null {
  const w = m[3]! * p[0] + m[7]! * p[1] + m[11]! * p[2] + m[15]!
  if (w <= 0) return null
  const nx = (m[0]! * p[0] + m[4]! * p[1] + m[8]! * p[2] + m[12]!) / w
  const ny = (m[1]! * p[0] + m[5]! * p[1] + m[9]! * p[2] + m[13]!) / w
  return [((nx + 1) / 2) * cssW, ((1 - ny) / 2) * cssH]
}
/** 누른 자리(CSS px)에서 가장 가까운 보이는 데이터 별 */
function pick(x: number, y: number, radius = 28): { id: string; world: V3; screen: [number, number]; dist: number } | null {
  if (!lastVP) return null
  const t = nowS()
  let best: { id: string; world: V3; screen: [number, number]; dist: number } | null = null
  for (const d of dataStars) {
    if (levelOf(d, t) < 0.05) continue
    const wp = dataWorld(d)
    const sp = projectCss(lastVP, wp)
    if (!sp) continue
    const dist = Math.hypot(sp[0] - x, sp[1] - y)
    if (dist <= Math.max(18, radius) && (!best || dist < best.dist)) best = { id: d.id, world: wp, screen: sp, dist }
  }
  return best
}

/* ---------- 앵커: 은하의 화면 위치 (useSkyAnchor) — 비행이 끝날 때 · 크기가 바뀔 때 · 끌기·관성이 멈출 때만 ---------- */
const anchorSubs = new Map<AnchorName, Set<(a: Anchor) => void>>()
const anchorLast = new Map<AnchorName, Anchor>()
function ringPx(m: Float32Array, R: number): number {
  const c = projectCss(m, [0, 0, 0])
  if (!c) return 0
  let sum = 0
  let n = 0
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2
    const p = projectCss(m, [R * Math.cos(a), 0, R * Math.sin(a)])
    if (!p) continue
    sum += Math.hypot(p[0] - c[0], p[1] - c[1])
    n++
  }
  return n ? sum / n : 0
}
function emitAnchors(m: Float32Array, _target: V3) {
  anchorDirty = false
  const c = projectCss(m, [0, 0, 0])
  const on = !!c && c[0] > -cssW * 0.2 && c[0] < cssW * 1.2 && c[1] > -cssH * 0.2 && c[1] < cssH * 1.2
  const next: Record<AnchorName, Anchor> = {
    core: { x: c?.[0] ?? 0, y: c?.[1] ?? 0, r: ringPx(m, 11.5), visible: on },
    // r = 눈에 보이는 팔 고리 11.5u의 화면 반지름 — 앱이 링을 R = 1.22r(= 14u 베젤)로 그린다 (design-m1 2-3)
    'focus-disk': { x: c?.[0] ?? 0, y: c?.[1] ?? 0, r: ringPx(m, 11.5), visible: on && place.id === 'focus' },
  }
  for (const name of ['core', 'focus-disk'] as AnchorName[]) {
    const a = next[name]
    const b = anchorLast.get(name)
    if (b && Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.r - b.r) < 0.5 && a.visible === b.visible) continue
    anchorLast.set(name, a)
    anchorSubs.get(name)?.forEach((f) => f(a))
  }
}
function onAnchor(name: AnchorName, cb: (a: Anchor) => void): () => void {
  let set = anchorSubs.get(name)
  if (!set) anchorSubs.set(name, (set = new Set()))
  set.add(cb)
  const last = anchorLast.get(name)
  if (last) cb(last)
  else {
    anchorDirty = true
    kick()
  }
  return () => set!.delete(cb)
}

/* ---------- 사건 층 보조: 부풂 · 반짝 · 선 · 화면→원반 ---------- */
function swellK(now: number) {
  const p = (now - swellT0) / 2000
  return p > 0 && p < 1 ? Math.sin(Math.PI * p) : 0
}
let sparkles: DataStar[] = []
let links: LinkSpec[] = []
const lineBuf = gl.createBuffer()!
const segBuf = lineBuf
const segVao = (() => {
  const vao = gl.createVertexArray()!
  gl.bindVertexArray(vao)
  gl.bindBuffer(gl.ARRAY_BUFFER, segBuf)
  gl.enableVertexAttribArray(0)
  gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 32, 0)
  gl.vertexAttribDivisor(0, 1)
  gl.enableVertexAttribArray(1)
  gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 16)
  gl.vertexAttribDivisor(1, 1)
  gl.bindVertexArray(null)
  return vao
})()
function screenToDisk(x: number, y: number): [number, number, number] | null {
  const B = lastBasis
  if (!B) return null
  const t = 1 / Math.tan((FOV * DEG) / 2)
  const aspect = cssW / cssH
  const nx = (x / cssW) * 2 - 1
  const ny = 1 - (y / cssH) * 2
  const xv = (nx - (SEAT[0]! - 0.5) * 2) * (aspect / t)
  const yv = (ny - (SEAT[1]! - 0.5) * -2) / t
  const dir: V3 = [B.f[0] + B.s[0] * xv + B.u[0] * yv, B.f[1] + B.s[1] * xv + B.u[1] * yv, B.f[2] + B.s[2] * xv + B.u[2] * yv]
  if (Math.abs(dir[1]) < 1e-5) return null
  const k = -lastEye[1] / dir[1]
  if (k <= 0) return null
  const w: V3 = [lastEye[0] + dir[0] * k, 0, lastEye[2] + dir[2] * k]
  // 세계 → 패턴 좌표(t=0)
  const r = Math.hypot(w[0], w[2])
  const th = Math.atan2(w[2], w[0]) - OMEGA_P * simT
  return [r * Math.cos(th), 0.1, r * Math.sin(th)]
}
let zoneKey = ''
function syncZones() {
  const key = zonePlace() + '|' + cssW + 'x' + cssH
  if (key === zoneKey) return
  zoneKey = key
  updateMask(cssW, cssH, !cleanMode)
}

/* ---------- 바깥에서 부르는 것 ---------- */
function setPlace(id: PlaceId, o: { instant?: boolean } = {}): number {
  look = null
  const pl = PLACES.find((p) => p.id === id)
  if (!pl) return 0
  if (o.instant || !readyAt) {
    place = pl
    flight = null
    orient = homeOrient(pl)
    if (pl.id === 'focus') focusEnter(orient)
    anchorDirty = true
    setTitle()
    touch()
    return 0
  }
  if (pl === place) return flight ? Math.max(0, flight.dur - (performance.now() - flight.t0)) : 0
  flyTo(id)
  return flight ? flight.dur : 0
}
function destroy() {
  destroyed = true
  clearTimeout(timerId)
  cancelAnimationFrame(rafId)
  cleanups.forEach((f) => f())
  cleanups.length = 0
  worker.terminate()
  anchorSubs.clear()
  try {
    ;(gl.getExtension('WEBGL_lose_context') as { loseContext(): void } | null)?.loseContext()
  } catch {
    /* 무시 */
  }
}
/* ---------- 시작 ---------- */
generate()
resize()
let rz = 0
listen(window, 'resize', () => {
  cancelAnimationFrame(rz)
  rz = requestAnimationFrame(() => {
    resize()
    kick()
  })
})
setTitle()
updateButtons()
lastInput = performance.now()
kick()

return {
  setPlace,
  place: () => place.id as PlaceId,
  home: () => goHome(),
  holdFlight: (on: boolean) => {
    holdOn = on
    kick()
  },
  setRotation: (r: Rot) => {
    userRot = r
    applyRot()
    updateButtons()
    touch()
  },
  setMotion: (m: 'rich' | 'calm' | 'off') => {
    motion = m
    applyRot()
    touch()
  },
  setTheme: (t: 'dark' | 'light') => {
    lightOn = t === 'light'
    touch()
  },
  setSheet: (open: boolean) => {
    sheetOpen = open
    touch()
  },
  setTravel: (t: 'fly' | 'short' | 'off') => {
    travelMode = t
  },
  setDrag: (on: boolean) => {
    dragOn = on
    if (!on && drag) endDrag()
  },
  setExposure: (k: number) => {
    extExpo = Math.max(0.3, Math.min(1.2, k))
    touch()
  },
  setDataStars: (list: DataStar[]) => {
    dataStars = list
    if (!stopped) kick() // 쉼·숨김이면 깨우지 않고 최종 상태만 (돌아올 때 보인다)
  },
  setLinks: (list: LinkSpec[]) => {
    links = list
    if (!stopped) kick()
  },
  /** V13 원반 부풂(+8%, 2초) · 자리 부풂(seat·cluster 데이터 별 +25%) */
  swell: (at: 'core' | 'seat' | 'cluster' = 'core') => {
    swellT0 = performance.now()
    swellAt = at
    eventUntil = Math.max(eventUntil, swellT0 + 4000)
    if (!stopped) kick()
  },
  /** V11 반짝: 월드 자리(패턴 좌표)에 300ms 빛 점 +40% */
  sparkle: (pos: [number, number, number], color: [number, number, number] = [0.953, 0.824, 0.604]) => {
    const t = nowS()
    sparkles.push({ id: 'spark:' + t, pos, L: 4, color, from: 0, to: 0, t0: t, dur: 0.3 })
    eventUntil = Math.max(eventUntil, performance.now() + 2300)
    if (!stopped) kick()
  },
  /** 화면 점(CSS px) → 원반 평면(y = 0) 위 패턴 좌표 (계획의 시간 띠 band(d) 등) */
  screenToDisk,
  /** 계획에서 마감까지 d일 → 시간 띠 위 점 (design-m1 0-1 band) */
  bandPoint: (days: number) => screenToDisk((0.1 + (0.8 * Math.min(Math.max(days, 0), 14)) / 14) * cssW, SEAT[1] * cssH),
  /** 별 고르기 다가감: pos(패턴 좌표)로 거리 d까지 짧게 — 자세 그대로(롤·방위 변화 0). null이면 장소 자리로 물러남. 길이(ms) */
  approach: (pos: [number, number, number] | null, d = 1.6): number => {
    const same = !!look === !!pos && (!pos || !look || (look.pos[0] === pos[0] && look.pos[2] === pos[2]))
    if (same) return 0
    look = pos ? { pos, dist: d } : null
    startFlight(place, orient, true)
    return flight ? flight.dur : 0
  },
  /** 시간대 위상 (design-m1 #40) */
  setPhase: (p: 'blue' | 'night' | 'dawn') => {
    phaseTo = p === 'blue' ? 1 : p === 'dawn' ? -1 : 0
  },
  /** 과목 렌즈(V10): 그 장소 자리 둘레 반사 성운에 과목색 ≤ 10% (null이면 끔) */
  setTint: (c: [number, number, number] | null) => {
    tint = c ? [c[0], c[1], c[2], 0.1] : [1, 1, 1, 0]
    touch()
  },
  /** 노트 책등 위 점 (#28): s = −1..1 (책등 아래 → 위) */
  setSpine: (list: Array<{ id: string; s: number; level: number; color: [number, number, number] }>) => {
    spine = list
    if (!stopped) kick()
  },
  /** 편집 중(useFieldPause): 자전·공전 ×0.3, 전경 별 0 (300ms) */
  setCalm: (on: boolean) => {
    calm = on
    touch()
  },
  /** useSkyClock: 집중 시계 (null이면 0.24°/s 공전) */
  setClock: (c: { startedAt: number; durationMs: number; elapsedMs: number; paused: boolean } | null) => {
    focusClock = c
    if (place.id === 'focus' && !stopped) kick()
  },
  setRing: (on: boolean) => {
    ringOn = on
    touch()
  },
  setTier: (t: Tier) => {
    if (t === tier) return
    tier = t
    generate()
    resize()
    updateButtons()
    touch()
  },
  now: nowS,
  pick,
  onAnchor,
  anchor: (name: AnchorName) => anchorLast.get(name) ?? null,
  resize: () => {
    resize()
    kick()
  },
  stats: () => {
    const fr = frames.slice().sort((a, b) => a - b)
    return {
      place: place.id as PlaceId,
      power,
      fps,
      wakes: wake.rate,
      p95: fr[Math.floor(0.95 * (fr.length - 1))] ?? 0,
      jsMs,
      gpuMs: tq ? gpuMs : null,
      tier,
      rotation: rot,
      W,
      H,
      megapixels: (W * H) / 1e6,
      hdr,
      flights: flightLog.slice(),
      ready: readyAt > 0,
    }
  },
  state: () => ({ place: place.id as PlaceId, rot, userRot, tier, ringOn }),
  debug,
  destroy,
}
}

/** 3D 은하 엔진 — 마운트하면 캔버스 하나에 그리기 고리 하나 */
export class Galaxy3D {
  /** WebGL2가 되는지 (컨텍스트를 바로 돌려준다) */
  static supported(): boolean {
    try {
      const c = document.createElement('canvas')
      const g = c.getContext('webgl2')
      if (!g) return false
      ;(g.getExtension('WEBGL_lose_context') as { loseContext(): void } | null)?.loseContext()
      return true
    } catch {
      return false
    }
  }
  private api: G3DApi | null = null
  private own: HTMLCanvasElement | null = null
  constructor(private opts: G3DOptions = {}) {}
  /** host가 캔버스면 그 위에, 아니면 캔버스를 만들어 붙인다. WebGL2가 없으면 예외 */
  mount(host: HTMLElement): this {
    let cv: HTMLCanvasElement
    if (host instanceof HTMLCanvasElement) cv = host
    else {
      cv = document.createElement('canvas')
      cv.setAttribute('aria-hidden', 'true')
      cv.className = 'gx-sky-canvas'
      host.appendChild(cv)
      this.own = cv
    }
    try {
      this.api = createGalaxy3D(cv, this.opts)
    } catch (e) {
      this.own?.remove()
      this.own = null
      throw e
    }
    return this
  }
  get canvas(): HTMLCanvasElement | null {
    return this.own
  }
  setPlace(id: PlaceId, o?: { instant?: boolean }): number {
    return this.api?.setPlace(id, o) ?? 0
  }
  holdFlight(on: boolean): void {
    this.api?.holdFlight(on)
  }
  setRotation(r: Rot): void {
    this.api?.setRotation(r)
  }
  setMotion(m: 'rich' | 'calm' | 'off'): void {
    this.api?.setMotion(m)
  }
  setTheme(t: 'dark' | 'light'): void {
    this.api?.setTheme(t)
  }
  setSheet(open: boolean): void {
    this.api?.setSheet(open)
  }
  setTravel(t: 'fly' | 'short' | 'off'): void {
    this.api?.setTravel(t)
  }
  setDrag(on: boolean): void {
    this.api?.setDrag(on)
  }
  setExposure(k: number): void {
    this.api?.setExposure(k)
  }
  setDataStars(list: DataStar[]): void {
    this.api?.setDataStars(list)
  }
  now(): number {
    return this.api?.now() ?? performance.now() / 1000
  }
  setLinks(list: LinkSpec[]): void {
    this.api?.setLinks(list)
  }
  swell(at?: 'core' | 'seat' | 'cluster'): void {
    this.api?.swell(at)
  }
  sparkle(pos: [number, number, number]): void {
    this.api?.sparkle(pos)
  }
  bandPoint(days: number): [number, number, number] | null {
    return this.api?.bandPoint(days) ?? null
  }
  setCalm(on: boolean): void {
    this.api?.setCalm(on)
  }
  approach(pos: [number, number, number] | null, d?: number): number {
    return this.api?.approach(pos, d) ?? 0
  }
  setPhase(p: 'blue' | 'night' | 'dawn'): void {
    this.api?.setPhase(p)
  }
  setTint(c: [number, number, number] | null): void {
    this.api?.setTint(c)
  }
  setSpine(list: Array<{ id: string; s: number; level: number; color: [number, number, number] }>): void {
    this.api?.setSpine(list)
  }
  anchors(name: AnchorName, cb: (a: Anchor) => void): () => void {
    return this.api?.onAnchor(name, cb) ?? (() => {})
  }
  pick(x: number, y: number, radius?: number) {
    return this.api?.pick(x, y, radius) ?? null
  }
  stats() {
    return this.api?.stats() ?? null
  }
  resize(): void {
    this.api?.resize()
  }
  get debug() {
    return this.api?.debug ?? null
  }
  get raw(): G3DApi | null {
    return this.api
  }
  destroy(): void {
    this.api?.destroy()
    this.api = null
    this.own?.remove()
    this.own = null
  }
}
