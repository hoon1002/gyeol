/** 떠올리기 모드 열기 신호 (앱 A). 노트 장소가 Recall(지연 조각)을 띄운다. 입구: 종이 머리 · ⋯ 메뉴 · ⌘K · ⌥R */
import { useSyncExternalStore } from 'react'

let cur: string | null = null
const ls = new Set<() => void>()
export function openRecall(noteId: string): void {
  cur = noteId
  ls.forEach((f) => f())
}
export function closeRecall(): void {
  cur = null
  ls.forEach((f) => f())
}
export function useRecallId(): string | null {
  return useSyncExternalStore(
    (f) => {
      ls.add(f)
      return () => ls.delete(f)
    },
    () => cur,
  )
}

/** 노트 저장 뒤 후보 추출 (디바운스 2초 → 한가할 때). 노트를 떠나도 남은 추출은 한다 */
const timers = new Map<string, number>()
export function scheduleExtract(noteId: string, onNew?: (n: number) => void): void {
  window.clearTimeout(timers.get(noteId))
  timers.set(
    noteId,
    window.setTimeout(() => {
      timers.delete(noteId)
      const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }
      const run = () =>
        void import('@/memory/candidates')
          .then((m) => m.syncNoteCandidates(noteId))
          .then((n) => n > 0 && onNew?.(n))
          .catch(() => {})
      if (w.requestIdleCallback) w.requestIdleCallback(run, { timeout: 4000 })
      else window.setTimeout(run, 200)
    }, 2000),
  )
}
