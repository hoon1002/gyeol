/**
 * 하늘 구도 (design-v3 §2): 하늘은 하나, 구도도 하나.
 * 은하 띠는 수평에서 57°, 오른쪽 위 → 왼쪽 아래로 쏟아진다. 기기마다 A·B만 다르고 화면이 바뀌어도 그대로다.
 * 화면마다 바뀌는 것은 노출 · 보이는 별 · 별가루 양 · 글자 안전 구역뿐 → 전환 때 움직임 0 (밝기만 900ms 보간).
 * 좌표: 화면 비율(uv, 0..1, y 아래로).
 */
export type SceneName =
  | 'hero'
  | 'cover'
  | 'today-class'
  | 'today-night'
  | 'focus'
  | 'review'
  | 'graph'
  | 'notes'
  | 'today-class-day'

export type Device = 'ipad' | 'ipad-port' | 'phone' | 'desktop' | 'cover'

export type Rect = [number, number, number, number] // css px x0, y0, x1, y1

export interface Composition {
  a: [number, number]
  b: [number, number]
  /** 띠를 따라 0..1 중 코어 자리 (v3: t 0.28–0.30) */
  core: number
  coreLen: number
  /** 띠 몸통 폭 (화면 높이 단위, 코어에서) */
  width: number
  bend: number
  /** 띠 밝기 (노출) */
  bright: number
  /** 별 밝기 배수 */
  starExpo: number
  /** 3등급(희미한 별) 보이는 비율 0..1 */
  faint: number
  /** 이보다 어두운 반짝이는 별은 숨긴다 (0 = 전부) */
  dynCut: number
  nebula: number
  dust: number
  /** 푸른 밤(낮 시간) 0..1 */
  blue: number
  /** 아래 20% 대기광 0..1 */
  airglow: number
  /** 별가루 양 0..1 */
  fall: number
  meteors: boolean
  /** 글자 안전 구역 (css px, ref 화면 크기 기준) — 그 안은 하늘을 어둡게, 밝은 별·별가루 없음 */
  safe: Rect[]
  ref: [number, number]
}

export function deviceOf(w: number, h: number): Device {
  const asp = w / h
  if (asp < 0.62) return 'phone'
  if (asp < 1.0) return 'ipad-port'
  if (w >= 1300) return 'desktop'
  return 'ipad'
}

type Geom = Pick<Composition, 'a' | 'b' | 'core' | 'coreLen' | 'width' | 'bend' | 'ref'>
/* 기기별 띠 (v3 §2-1 표) */
const GEOM: Record<Device, Geom> = {
  // 오른쪽 위 모서리 → 왼쪽 아래 모서리, 가운데가 오른쪽 아래로 살짝 휘는 완만한 곡선 (리더 아트 디렉션 2차)
  ipad: { a: [1.0, -0.06], b: [-0.04, 1.08], core: 0.3, coreLen: 0.2, width: 0.12, bend: -0.1, ref: [1180, 820] },
  'ipad-port': { a: [1.03, -0.03], b: [-0.05, 0.98], core: 0.26, coreLen: 0.2, width: 0.08, bend: -0.08, ref: [820, 1180] },
  phone: { a: [1.04, -0.03], b: [-0.06, 0.97], core: 0.25, coreLen: 0.2, width: 0.08, bend: -0.09, ref: [390, 844] },
  desktop: { a: [1.0, -0.06], b: [-0.03, 1.08], core: 0.3, coreLen: 0.2, width: 0.12, bend: -0.1, ref: [1440, 900] },
  cover: { a: [0.98, -0.08], b: [-0.02, 1.12], core: 0.3, coreLen: 0.22, width: 0.115, bend: -0.08, ref: [1920, 1080] },
}

const IPAD_TODAY: Rect[] = [
  [64, 210, 520, 650],
  [64, 664, 760, 704],
  [330, 744, 850, 804],
]
const PHONE_TODAY: Rect[] = [
  [24, 470, 366, 730],
  [24, 768, 366, 824],
]
/* 글자 안전 구역 (v3 §2-1, §7) */
const SAFE: Record<Exclude<Device, 'cover'>, Partial<Record<SceneName, Rect[]>>> = {
  ipad: {
    'today-class': IPAD_TODAY,
    'today-night': IPAD_TODAY,
    'today-class-day': IPAD_TODAY,
    focus: [[56, 220, 620, 600]],
    review: IPAD_TODAY,
    graph: [
      [64, 520, 440, 700],
      [330, 744, 850, 804],
    ],
    notes: [
      [64, 210, 600, 650],
      [330, 744, 850, 804],
    ],
  },
  'ipad-port': {
    'today-night': [[48, 700, 772, 1010]],
    focus: [[48, 640, 772, 1010]],
  },
  phone: {
    'today-class': PHONE_TODAY,
    'today-night': PHONE_TODAY,
    focus: [[24, 420, 366, 700]],
    review: PHONE_TODAY,
    graph: PHONE_TODAY,
    notes: PHONE_TODAY,
  },
  desktop: {
    'today-night': [
      [120, 220, 640, 700],
      [120, 724, 820, 764],
    ],
    'today-class': [
      [120, 220, 640, 700],
      [120, 724, 820, 764],
    ],
    focus: [[112, 230, 700, 640]],
  },
}

type Look = Omit<Composition, keyof Geom | 'safe'>
const base: Look = { bright: 1, starExpo: 1, faint: 1, dynCut: 0, nebula: 1, dust: 1, blue: 0, airglow: 1, fall: 1, meteors: true }
/* 화면마다 다른 하늘 (v3 §2-5): 노출 · 보이는 별 · 별가루 · 유성 */
const LOOK: Record<SceneName, Look> = {
  hero: { ...base },
  cover: { ...base },
  'today-night': { ...base },
  'today-class': { ...base, bright: 0.75, starExpo: 0.88, faint: 0.5, blue: 1, airglow: 0, fall: 0.6 },
  'today-class-day': { ...base, bright: 0.75, faint: 0.5, fall: 0, meteors: false },
  focus: { ...base, bright: 0.4, starExpo: 0.8, fall: 0.25, meteors: false },
  review: { ...base, bright: 0.6, starExpo: 0.88, faint: 0.5, fall: 0.4, meteors: false },
  graph: { ...base, bright: 0.35, starExpo: 0.85, faint: 0.5, fall: 0, meteors: false },
  notes: { ...base, bright: 0.3, starExpo: 0.75, faint: 0, dynCut: 90, fall: 0, meteors: false },
}

export function pickComposition(scene: SceneName, w: number, h: number): Composition {
  const dev: Device = scene === 'cover' ? 'cover' : deviceOf(w, h)
  const g = GEOM[dev]
  let safe: Rect[] = []
  if (dev !== 'cover' && scene !== 'hero') {
    const tbl = SAFE[dev]
    safe = tbl[scene] ?? tbl['today-night'] ?? []
  }
  return { ...g, ...LOOK[scene], safe }
}

/** 띠 좌표계 (월드 = x: 0..aspect, y: 0..1, 높이 단위) */
export interface BandFrame {
  ax: number
  ay: number
  dx: number
  dy: number
  nx: number
  ny: number
  len: number
  w0: number
  bend: number
}

export function bandFrame(c: Composition, aspect: number): BandFrame {
  const ax = c.a[0] * aspect
  const ay = c.a[1]
  const bx = c.b[0] * aspect
  const by = c.b[1]
  const len = Math.hypot(bx - ax, by - ay)
  const dx = (bx - ax) / len
  const dy = (by - ay) / len
  // 진행 방향의 오른쪽(화면 좌표, y 아래) = 띠의 아래쪽 가장자리
  const nx = -dy
  const ny = dx
  return { ax, ay, dx, dy, nx, ny, len, w0: c.width, bend: c.bend }
}

export function widen(s: number): number {
  // 쏟아지며 퍼진다: 아래로 갈수록 넓게 (셰이더와 같은 식)
  const k = Math.min(1, Math.max(0, (s - 0.2) / 0.8))
  return (0.88 + 0.5 * k * k * (3 - 2 * k)) * (1 + 0.06 * Math.sin(s * 9 + 1.3))
}

export function bendOffset(f: BandFrame, s: number): number {
  return f.bend * f.len * 4 * s * (1 - s)
}

/** 띠 좌표(s: 0..1 길이 방향, t: 폭 단위) → 월드 */
export function bandToWorld(f: BandFrame, s: number, t: number): [number, number] {
  const w = f.w0 * widen(s)
  const off = t * w + bendOffset(f, s)
  return [f.ax + f.dx * s * f.len + f.nx * off, f.ay + f.dy * s * f.len + f.ny * off]
}
