/**
 * 설정 스토어 (zustand persist → localStorage, 접근 실패는 try/catch로 조용히).
 * index.html의 초기 테마 스크립트가 같은 키('gyeol-settings')의 state.theme / state.motion을 읽는다.
 */
import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'
import type { MotionLevel, Tier } from '@/fx'

export type ThemePref = 'system' | 'dark' | 'light'
export type TravelPref = 'fly' | 'short' | 'off'
/** 은하 회전 (design-v4 7-3): 자동 공전 + 은하 자전을 함께 정한다 */
export type RotationPref = 'on' | 'slow' | 'off'
export type ClockPreset = 'live' | 'morning' | 'class' | 'gap' | 'before' | 'night' | 'late' | 'exam' | 'empty'

export interface SettingsState {
  theme: ThemePref
  motion: MotionLevel
  /** 공간 이동: 비행 · 짧게 · 끔 (design-v3-camera §5) */
  travel: TravelPref
  /** 은하 회전: 켬 · 느리게 · 끔 (기본 켬). OS 동작 줄이기면 끔으로 고정 */
  rotation: RotationPref
  /** 과목 렌즈: null = 전체 */
  lens: string | null
  /** 개발용 */
  clock: ClockPreset
  tier: 'auto' | Tier
  fps: boolean
  /** M4 기억: 목표 기억률(0.85 · 0.87 · 0.9 · 0.92 · 0.95, 기본 0.9) — 앱 A의 FSRS가 읽는다 */
  retention: number
  /** 하루 새 카드 상한(10 · 20 · 30, 기본 20) */
  newPerDay: number
  /** 하루 전체 상한(100 · 200 · 300, 기본 200) */
  maxPerDay: number
  /** 늘 쉬는 요일 (0 = 일 … 6 = 토) */
  restDays: number[]
  /** 하루만 쉬는 날 ('YYYY-MM-DD', 계획 띠 길게 누르기) */
  restDates: string[]
  /** 지도 별 기억 밝기 켬 · 끔 */
  memoryBrightness: boolean
  setTheme: (t: ThemePref) => void
  setMotion: (m: MotionLevel) => void
  setTravel: (t: TravelPref) => void
  setRotation: (r: RotationPref) => void
  setLens: (id: string | null) => void
  setClock: (c: ClockPreset) => void
  setTier: (t: 'auto' | Tier) => void
  setFps: (v: boolean) => void
  setRetention: (v: number) => void
  setNewPerDay: (v: number) => void
  setMaxPerDay: (v: number) => void
  setRestDays: (v: number[]) => void
  toggleRestDate: (day: string) => void
  setMemoryBrightness: (v: boolean) => void
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
      rotation: 'on',
      lens: null,
      retention: 0.9,
      newPerDay: 20,
      maxPerDay: 200,
      restDays: [],
      restDates: [],
      memoryBrightness: true,
      clock: 'live',
      tier: 'auto',
      fps: false,
      setTheme: (theme) => set({ theme }),
      setMotion: (motion) => set({ motion }),
      setTravel: (travel) => set({ travel }),
      setRotation: (rotation) => set({ rotation }),
      setLens: (lens) => set({ lens }),
      setRetention: (retention) => set({ retention }),
      setNewPerDay: (newPerDay) => set({ newPerDay }),
      setMaxPerDay: (maxPerDay) => set({ maxPerDay }),
      setRestDays: (restDays) => set({ restDays: [...new Set(restDays)].sort() }),
      toggleRestDate: (day) => set((st) => ({ restDates: st.restDates.includes(day) ? st.restDates.filter((d) => d !== day) : [...st.restDates.filter((d) => d >= new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)), day] })),
      setMemoryBrightness: (memoryBrightness) => set({ memoryBrightness }),
      setClock: (clock) => set({ clock }),
      setTier: (tier) => set({ tier }),
      setFps: (fps) => set({ fps }),
    }),
    {
      name: SETTINGS_KEY,
      version: 1,
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => ({ theme: s.theme, motion: s.motion, travel: s.travel, rotation: s.rotation, lens: s.lens, clock: s.clock, tier: s.tier, fps: s.fps, retention: s.retention, newPerDay: s.newPerDay, maxPerDay: s.maxPerDay, restDays: s.restDays, restDates: s.restDates, memoryBrightness: s.memoryBrightness }),
    },
  ),
)
