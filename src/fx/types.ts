/**
 * 결 모션 엔진 — 공개 타입 (계약). index.ts가 그대로 다시 내보낸다.
 * 이름·필드는 리더가 확정한 계약(team/design-v2.md §6)과 같다. 바꾸지 말 것.
 */
import type { ElementType, ReactNode, RefObject } from 'react'

export type MotionLevel = 'rich' | 'calm' | 'off'
export type Tier = 'A' | 'B' | 'C'
export type ThemeName = 'dark' | 'light'
export type MoodName =
  | 'landing'
  | 'today'
  | 'notes'
  | 'graph'
  | 'review'
  | 'planner'
  | 'focus'
  | 'settings'

/** 필드 분위기. 좌표는 화면 비율(0..1). */
export interface Mood {
  /** 흐름 속도 배수 (1 = 기본) */
  speed: number
  /** 등고선 간격(노이즈 값 단위). 작을수록 촘촘 */
  step: number
  /** 결 방향 축척 [x, y]. x<y면 가로 결, x>y면 세로 결 */
  aniso: [number, number]
  /** 옹이 1개 위치 (화면 비율). null이면 옹이 없음 */
  knot?: [number, number] | null
  /** 옹이 여러 개 (최대 4). 있으면 knot보다 우선 */
  knots?: Array<[number, number]>
  /** 옹이 세기 0..1+ */
  knotStrength: number
  /** 옹이 둘레 색조 (CSS 색, var(--s-phys) 가능). 없으면 인주색 */
  tint?: string
  /** 색조 세기 0..1 (기본 1) */
  tintAmount?: number
  /** 옹이 둘레 인주 고리 수 (useFieldData.rings가 있으면 그쪽이 우선) */
  rings?: number
  /** 20초 무입력이면 숨 쉼 (focus는 항상) */
  breath?: boolean
  /** 선 밝기 배수 0..1 (기본 1) */
  dim?: number
}

export interface MotionPrefs {
  /** 사용자가 고른 수준. OS '동작 줄이기'면 실제로는 'off'처럼 동작 */
  level: MotionLevel
  /** OS prefers-reduced-motion 또는 level === 'off' */
  reduced: boolean
  tier: Tier
  fps: number
}

export interface FieldProviderProps {
  level: MotionLevel
  theme: ThemeName
  tier?: 'auto' | Tier
  debug?: boolean
  /** v3 카메라: 설정 '공간 이동' — 비행(기본) / 짧게(줌 30% + 크로스페이드) / 끔. 동작 줄이기면 언제나 끔 */
  travel?: 'fly' | 'short' | 'off'
  /** 유성 켬·끔 (기본 true). false면 자동 유성 없음, 사건 유성(meteor)은 띠가 잠깐 밝아지는 것(V13 +4%)으로 대체 */
  meteors?: boolean
  children?: ReactNode
}

export interface FieldMoodProps {
  preset: MoodName
  override?: Partial<Mood>
  /** 옹이를 이 요소 위치에 고정 */
  knotRef?: RefObject<Element | null>
  transitionMs?: number
}

export interface RippleOptions {
  strength?: number
  accent?: boolean
}

export interface RippleSurfaceProps {
  disabled?: boolean
  strength?: number
  as?: ElementType
  className?: string
  children?: ReactNode
}

export interface SealOptions {
  stamp?: { text: string; sub?: string }
}

export type PauseReason = 'ink' | 'typing' | 'overlay'

export interface TransitionOptions {
  /** 물결이 시작될 자리 (누른 아이콘 등) */
  origin?: Element | { x: number; y: number }
  direction?: 'forward' | 'back'
  /** v3 카메라: 목적지 공간. 주면 하늘·비행이 누른 프레임에 바로 출발한다(없으면 누른 링크 href로 추정) */
  to?: MoodName
  /** 비행이 정해지면 (비행 길이 ms, 글자가 들어올 시각 ms = D − 320, 짧게·끔이면 170) — 앱 글자 박자용 */
  onFlight?: (flightMs: number, contentInMs: number) => void
}

export interface FieldData {
  /** 옹이 둘레 인주 고리 수 = 오늘 집중 세트 */
  rings?: number
  /** 남은 할 일 양 0..1 → 등고선 밀도 */
  load?: number
  /** 시간 압박 0..1 → 흐름 속도 */
  pressure?: number
  /** 색조 (과목 렌즈, CSS 색) */
  tint?: string
}

export interface RevealTextProps {
  lines: ReactNode[]
  as?: ElementType
  className?: string
  stagger?: number
  delay?: number
  trigger?: 'mount' | 'inView'
  /** 바뀌면 나가는 줄 → 들어오는 줄로 교체 */
  swapKey?: string | number
}

export interface CountUpProps {
  value: number
  format?: (n: number) => string
  duration?: number
  once?: boolean
  className?: string
}

export interface FocusRingProps {
  /** 지난 시간 비율 0..1 (0 = 꽉 찬 링, 1 = 다 줄어든 링). v1 W3과 같은 뜻 */
  progress: number
  size?: number
  color?: string
  state: 'idle' | 'running' | 'paused' | 'done'
  drawIn?: boolean
  children?: ReactNode
}

export interface StampProps {
  show: boolean
  text: string
  sub?: string
  onDone?: () => void
}

export interface GyeolRingsProps {
  /** 나이테 하나 = 하루. size = 집중 시간(시간 단위, 25분 = 고리 1겹), color = CSS 색 */
  items: Array<{ size: number; color: string }>
  grow?: boolean
  className?: string
}

export interface ContourRibbonProps {
  segments: Array<{ start: Date; end: Date; kind: 'class' | 'focus'; color: string }>
  now: Date
  className?: string
}
