/**
 * 복습을 밖에서 시작하라는 뜻 (지도 흐린 별 ▶ · ⌘K · 오늘 줄 등). 복습 화면이 받아서 세션을 연다.
 *   requestReview({ kind: 'note', noteId, limit: 10 })  → 그 노트 카드 R 낮은 순 10장
 */
import { useSyncExternalStore } from 'react'
import type { SessionMode } from './session'

let pending: SessionMode | null = null
const ls = new Set<() => void>()
export function requestReview(mode: SessionMode): void {
  pending = mode
  ls.forEach((f) => f())
}
export function takeReviewRequest(): SessionMode | null {
  const m = pending
  pending = null
  return m
}
export function useReviewRequest(): SessionMode | null {
  return useSyncExternalStore(
    (f) => {
      ls.add(f)
      return () => ls.delete(f)
    },
    () => pending,
  )
}
