/**
 * 결 모션 엔진 — 공개 API (리더 확정 계약, team/design-v2.md §6 기준 → v3: 은하수 하늘, team/design-v3-motion.md §5)
 * v3: 기존 이름·시그니처는 그대로, 의미만 하늘로 바뀌었다. 새 사건 API는 아래 'v3 추가'에만 있다.
 *
 * 소유: 모션 개발자. 앱 코드는 이 파일에서 내보내는 것만 쓴다(내부 파일 직접 import 금지).
 * 이름·props·반환 타입은 계약 그대로다. 구현은 engine/ · components/ · hooks.ts에 나뉘어 있다.
 *
 * 레이어 규칙: 필드 캔버스는 position:fixed; inset:0; z-index:0; pointer-events:none (FieldProvider가 body에 붙임).
 * html에 배경색(--bg-0), body는 transparent, 앱 루트는 position:relative; z-index:1.
 * (body에 배경을 칠하거나 캔버스를 z-index:-1로 두면 필드가 가려진다.)
 *
 * 연결 규칙: 루트에 <FieldProvider>, 각 화면 맨 위에 <FieldMood preset="…"/>,
 * 독·⌘K 이동은 useFieldTransition()으로 commit을 감싼다, 노트 편집기는 useFieldPause(isEditing, 'ink'),
 * 완료 이벤트는 useSeal(). 컴포넌트들은 스스로 useMotionPrefs를 읽어 '끔'이면 즉시 전환한다.
 */

export type {
  MotionLevel,
  Tier,
  ThemeName,
  MoodName,
  Mood,
  MotionPrefs,
  FieldProviderProps,
  FieldMoodProps,
  RippleOptions,
  RippleSurfaceProps,
  SealOptions,
  PauseReason,
  TransitionOptions,
  FieldData,
  RevealTextProps,
  CountUpProps,
  FocusRingProps,
  StampProps,
  GyeolRingsProps,
  ContourRibbonProps,
} from './types'

export { MOODS } from './moods'

export { FieldProvider } from './FieldProvider'

export {
  FieldMood,
  useFieldKnot,
  useRipple,
  RippleSurface,
  useSeal,
  useFieldPause,
  useFieldTransition,
  useFieldData,
  useMotionPrefs,
  useIdle,
  // v3 추가
  useSkyEvent,
  useSkyPhase,
  useSkyLens,
  useSkyStars,
  useSkyEntrance,
  SkyEntrance,
  useSkyCaption,
  getSkyStats,
  useSkyCamera,
  useSkyPick,
  // M1 추가 (m1-brief 계약)
  useSkySheet,
  useSkyAnchor,
  useSkyDrag,
  useSkyPaper,
  useSkyClock,
} from './hooks'
/** 글 구역 (design-m1 2-1·2-2) — 렌더러 안전 마스크와 앱 배치가 같은 숫자를 쓴다 */
export { SKY_ZONES, zoneLayout } from '../galaxy3d/zones'
export type { ZoneRect, ZoneLayout, ZonePlace } from '../galaxy3d/zones'
export type { SkyEvents, SkyStarsSpec } from './hooks'
export { SKY_TIMING } from './sky/field'
export type { SkyPhase, StarKind, SkyStatsOut, CameraTarget, Travel } from './sky/field'
export { flightMs } from './sky/field'
export { isSkyDragClick } from './sky/gesture'
export { ProgressLine } from './components/ProgressLine'
export type { ProgressLineProps } from './components/ProgressLine'
export { SkyCaption } from './components/SkyCaption'
export type { SkyCaptionProps } from './components/SkyCaption'

export { RevealText } from './components/RevealText'
export { CountUp } from './components/CountUp'
export { FocusRing } from './components/FocusRing'
export { Stamp } from './components/Stamp'
export { GyeolRings } from './components/GyeolRings'
export { ContourRibbon } from './components/ContourRibbon'
