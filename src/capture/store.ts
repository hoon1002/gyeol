/** 입구 화면 상태 (저장하지 않음): 별가루함 열림 · 보관함 보기 */
import { create } from 'zustand'

/** 첫 실행: 'real' = DB에 쓴다, 'dry' = ?onboarding=1 개발용(메모리만, 사용자 데이터 그대로) */
export type OnboardingMode = 'real' | 'dry'

const forcedDry = typeof location !== 'undefined' && /[?&]onboarding=1\b/.test(location.search)

interface CaptureState {
  /** 첫 실행 강제 열기(설정 '처음 화면 다시 보기' · ?onboarding=1) */
  onboarding: OnboardingMode | null
  /** 첫 실행 화면이 지금 떠 있는가(오늘 하늘 preset이 'onboarding'이 된다) */
  onbActive: boolean
  startOnboarding: (m: OnboardingMode) => void
  endOnboarding: () => void
  setOnbActive: (v: boolean) => void
  dustOpen: boolean
  archive: boolean
  dustOrigin: Element | null
  openDust: (origin?: Element | null) => void
  closeDust: () => void
  setArchive: (v: boolean) => void
}

export const useCapture = create<CaptureState>()((set) => ({
  onboarding: forcedDry ? 'dry' : null,
  onbActive: false,
  startOnboarding: (onboarding) => set({ onboarding }),
  endOnboarding: () => set({ onboarding: null, onbActive: false }),
  setOnbActive: (onbActive) => set({ onbActive }),
  dustOpen: false,
  archive: false,
  dustOrigin: null,
  openDust: (origin = null) => set({ dustOpen: true, archive: false, dustOrigin: origin ?? (typeof document !== 'undefined' ? document.activeElement : null) }),
  closeDust: () => set({ dustOpen: false, archive: false }),
  setArchive: (archive) => set({ archive }),
}))

/** ⌘K '별가루' 등에서 별가루함 열기 */
export function openDust(origin?: Element | null): void {
  useCapture.getState().openDust(origin ?? null)
}
