/**
 * 집중 타이머 상태 (persist → 새로고침해도 이어서).
 * 남은 시간은 항상 '시각 차'로 계산한다(틱을 세지 않음, architecture 7.2).
 */
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { safeStorage } from './settings'

export type TimerPhase = 'idle' | 'running' | 'paused' | 'done'

interface FocusTimerState {
  phase: TimerPhase
  plannedMs: number
  startedAt: number
  pausedAt: number
  pausedTotalMs: number
  subjectId: string | null
  setPlanned: (ms: number) => void
  setSubject: (id: string | null) => void
  start: (now?: number) => void
  pause: (now?: number) => void
  resume: (now?: number) => void
  finish: () => void
  reset: () => void
}

export function remainingMs(s: Pick<FocusTimerState, 'phase' | 'plannedMs' | 'startedAt' | 'pausedAt' | 'pausedTotalMs'>, now = Date.now()): number {
  if (s.phase === 'idle') return s.plannedMs
  if (s.phase === 'done') return 0
  const end = s.phase === 'paused' ? s.pausedAt : now
  return Math.max(0, s.plannedMs - (end - s.startedAt - s.pausedTotalMs))
}

export const useFocusTimer = create<FocusTimerState>()(
  persist(
    (set, get) => ({
      phase: 'idle',
      plannedMs: 25 * 60_000,
      startedAt: 0,
      pausedAt: 0,
      pausedTotalMs: 0,
      subjectId: 'phys',
      setPlanned: (plannedMs) => {
        if (get().phase === 'idle' || get().phase === 'done') set({ plannedMs, phase: 'idle' })
      },
      setSubject: (subjectId) => set({ subjectId }),
      start: (now = Date.now()) => set({ phase: 'running', startedAt: now, pausedAt: 0, pausedTotalMs: 0 }),
      pause: (now = Date.now()) => {
        if (get().phase === 'running') set({ phase: 'paused', pausedAt: now })
      },
      resume: (now = Date.now()) => {
        const s = get()
        if (s.phase === 'paused') set({ phase: 'running', pausedTotalMs: s.pausedTotalMs + (now - s.pausedAt), pausedAt: 0 })
      },
      finish: () => set({ phase: 'done' }),
      reset: () => set({ phase: 'idle', startedAt: 0, pausedAt: 0, pausedTotalMs: 0 }),
    }),
    {
      name: 'gyeol-focus-timer',
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => ({ phase: s.phase, plannedMs: s.plannedMs, startedAt: s.startedAt, pausedAt: s.pausedAt, pausedTotalMs: s.pausedTotalMs, subjectId: s.subjectId }),
    },
  ),
)
