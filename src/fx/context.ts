import { createContext, useContext, useSyncExternalStore } from 'react'
import type { FieldEngine, Mode } from './sky/field'
import type { MotionPrefs } from './types'

export const FieldContext = createContext<FieldEngine | null>(null)

/* getSkyStats()처럼 React 밖에서 읽는 계측용 */
let active: FieldEngine | null = null
export function setActiveEngine(e: FieldEngine | null): void {
  active = e
}
export function getActiveEngine(): FieldEngine | null {
  return active
}

/** 내부용: 가까운 FieldProvider의 엔진 (없으면 null → 훅들은 조용히 아무것도 안 함) */
export function useFieldEngine(): FieldEngine | null {
  return useContext(FieldContext)
}

/* FieldProvider 밖에서도 OS '동작 줄이기'는 지킨다 */
const RM = '(prefers-reduced-motion: reduce)'
function subscribeOS(f: () => void) {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {}
  const mq = window.matchMedia(RM)
  mq.addEventListener('change', f)
  return () => mq.removeEventListener('change', f)
}
function osReduced(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(RM).matches
}
const noopSub = () => () => {}

const FALLBACK_RICH: MotionPrefs = { level: 'rich', reduced: false, tier: 'B', fps: 0 }
const FALLBACK_OFF: MotionPrefs = { level: 'rich', reduced: true, tier: 'B', fps: 0 }

export function usePrefsInternal(): MotionPrefs {
  const eng = useFieldEngine()
  const os = useSyncExternalStore(eng ? noopSub : subscribeOS, eng ? () => false : osReduced, () => false)
  const prefs = useSyncExternalStore(eng ? eng.subscribe : noopSub, eng ? eng.getPrefs : () => FALLBACK_RICH, () => FALLBACK_RICH)
  if (!eng) return os ? FALLBACK_OFF : FALLBACK_RICH
  return prefs
}

/** 내부용: 실제로 적용되는 모션 모드. fps 변화로는 리렌더하지 않는다 */
export function useMotionMode(): Mode {
  const eng = useFieldEngine()
  const os = useSyncExternalStore(eng ? noopSub : subscribeOS, eng ? () => false : osReduced, () => false)
  const mode = useSyncExternalStore(
    eng ? eng.subscribe : noopSub,
    () => (eng ? eng.mode : 'rich'),
    () => 'rich' as Mode,
  )
  if (!eng) return os ? 'off' : 'rich'
  return mode
}
