/** 화면 상태 (저장하지 않음): ⌘K, 설정 시트, 렌즈 시트, 토스트, 크롬 숨김, 시계 */
import { create } from 'zustand'

export interface Toast {
  id: number
  text: string
  color?: string
}

export interface FocusIntent {
  minutes: number
  subjectId: string | null
  autostart: boolean
}

interface UiState {
  paletteOpen: boolean
  paletteQuery: string
  paletteOrigin: Element | null
  lensOpen: boolean
  /** 설정 시트 (장소가 아니라 지금 장소 위에 열린다) */
  settingsOpen: boolean
  /** 닫으면 포커스를 돌려줄 자리 */
  settingsOrigin: Element | null
  toast: Toast | null
  /** 집중 진행 중 등: 상단 바·독을 접는다 */
  chromeHidden: boolean
  /** 스크롤로 숨김 */
  scrollHidden: boolean
  /** ⌘K "물리 25분" → 집중 화면이 받아서 시작 */
  focusIntent: FocusIntent | null
  /** ⌘K 복습 → 복습 화면이 받아서 바로 시작 */
  reviewIntent: boolean
  /** ⌘K 노트 → 노트 화면 초점으로 */
  noteFocusId: string | null
  /** 1분마다 + visibilitychange 갱신 */
  tick: number
  openPalette: (query?: string, origin?: Element | null) => void
  closePalette: () => void
  setLensOpen: (v: boolean) => void
  openSettings: (origin?: Element | null) => void
  closeSettings: () => void
  showToast: (text: string, color?: string) => void
  clearToast: () => void
  setChromeHidden: (v: boolean) => void
  setScrollHidden: (v: boolean) => void
  setFocusIntent: (f: FocusIntent | null) => void
  setReviewIntent: (v: boolean) => void
  setNoteFocusId: (id: string | null) => void
  bumpTick: () => void
}

let toastSeq = 0

export const useUi = create<UiState>()((set) => ({
  paletteOpen: false,
  paletteQuery: '',
  paletteOrigin: null,
  lensOpen: false,
  settingsOpen: false,
  settingsOrigin: null,
  toast: null,
  chromeHidden: false,
  scrollHidden: false,
  focusIntent: null,
  reviewIntent: false,
  noteFocusId: null,
  tick: Date.now(),
  openPalette: (query = '', origin = null) =>
    set({ paletteOpen: true, paletteQuery: query, paletteOrigin: origin ?? (typeof document !== 'undefined' ? document.activeElement : null), lensOpen: false }),
  closePalette: () => set({ paletteOpen: false }),
  setLensOpen: (lensOpen) => set({ lensOpen }),
  openSettings: (origin = null) =>
    set({ settingsOpen: true, settingsOrigin: origin ?? (typeof document !== 'undefined' ? document.activeElement : null), lensOpen: false }),
  closeSettings: () => set({ settingsOpen: false }),
  showToast: (text, color) => set({ toast: { id: ++toastSeq, text, color } }),
  clearToast: () => set({ toast: null }),
  setChromeHidden: (chromeHidden) => set({ chromeHidden }),
  setScrollHidden: (scrollHidden) => set({ scrollHidden }),
  setFocusIntent: (focusIntent) => set({ focusIntent }),
  setReviewIntent: (reviewIntent) => set({ reviewIntent }),
  setNoteFocusId: (noteFocusId) => set({ noteFocusId }),
  bumpTick: () => set({ tick: Date.now() }),
}))
