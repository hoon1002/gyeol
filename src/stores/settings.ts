/**
 * 설정 스토어 (zustand persist → localStorage, 접근 실패는 try/catch로 조용히).
 * index.html의 초기 테마 스크립트가 같은 키('gyeol-settings')의 state.theme / state.motion을 읽는다.
 */
import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'
import type { MotionLevel, Tier } from '@/fx'

export type ThemePref = 'system' | 'dark' | 'light'
export type TravelPref = 'fly' | 'short' | 'off'
export type ClockPreset = 'live' | 'morning' | 'class' | 'gap' | 'before' | 'night' | 'late' | 'exam' | 'empty'

export interface SettingsState {
  theme: ThemePref
  motion: MotionLevel
  /** 공간 이동: 비행 · 짧게 · 끔 (design-v3-camera §5) */
  travel: TravelPref
  /** 유성: 켬 · 끔 (끄면 자동 유성 없음, 신호 유성은 띠가 잠깐 밝아지는 것으로 대체) */
  meteors: boolean
  /** 과목 렌즈: null = 전체 */
  lens: string | null
  /** 개발용 */
  clock: ClockPreset
  tier: 'auto' | Tier
  fps: boolean
  setTheme: (t: ThemePref) => void
  setMotion: (m: MotionLevel) => void
  setTravel: (t: TravelPref) => void
  setMeteors: (v: boolean) => void
  setLens: (id: string | null) => void
  setClock: (c: ClockPreset) => void
  setTier: (t: 'auto' | Tier) => void
  setFps: (v: boolean) => void
}

export const SETTINGS_KEY = 'gyeol-settings'

export const safeStorage: StateStorage = {
  getItem: (k) => {
    try {
      return localStorage.getItem(k)
    } catch {
      return null
    }
  },
  setItem: (k, v) => {
    try {
      localStorage.setItem(k, v)
    } catch {
      /* 사파리 사생활 보호 모드 등: 저장 없이 계속 */
    }
  },
  removeItem: (k) => {
    try {
      localStorage.removeItem(k)
    } catch {
      /* noop */
    }
  },
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      theme: 'dark',
      motion: 'rich',
      travel: 'fly',
      meteors: true,
      lens: null,
      clock: 'live',
      tier: 'auto',
      fps: false,
      setTheme: (theme) => set({ theme }),
      setMotion: (motion) => set({ motion }),
      setTravel: (travel) => set({ travel }),
      setMeteors: (meteors) => set({ meteors }),
      setLens: (lens) => set({ lens }),
      setClock: (clock) => set({ clock }),
      setTier: (tier) => set({ tier }),
      setFps: (fps) => set({ fps }),
    }),
    {
      name: SETTINGS_KEY,
      version: 1,
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => ({ theme: s.theme, motion: s.motion, travel: s.travel, meteors: s.meteors, lens: s.lens, clock: s.clock, tier: s.tier, fps: s.fps }),
    },
  ),
)
