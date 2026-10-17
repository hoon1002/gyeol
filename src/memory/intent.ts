/**
 * 복습을 밖에서 시작하라는 뜻 (지도 흐린 별 ▶ · 별 정보 · ⌘K · 오늘 줄). 복습 화면이 받아서 세션을 연다.
 *   requestReview({ kind: 'note', noteId, limit: 10 }) 뒤 '/review'로 가면 된다(reviewIntent도 함께 켠다).
 *   openCandidates(noteId?) · openFreshStart() — 후보함 · 새 출발 확인 칸 (복습 장소에서 열린다)
 */
import { useSyncExternalStore } from 'react'
import { useUi } from '@/stores/ui'
import type { SessionMode } from './session'

export type ReviewAsk = { kind: 'session'; mode: SessionMode } | { kind: 'candidates'; noteId?: string | null } | { kind: 'fresh' }

let pending: ReviewAsk | null = null
const ls = new Set<() => void>()
const emit = () => ls.forEach((f) => f())

export function requestReview(mode: SessionMode): void {
  pending = { kind: 'session', mode }
  useUi.getState().setReviewIntent(true)
  emit()
}
export function openCandidates(noteId?: string | null): void {
  pending = { kind: 'candidates', noteId: noteId ?? null }
  emit()
}
export function openFreshStart(): void {
  pending = { kind: 'fresh' }
  emit()
}
export function takeReviewAsk(): ReviewAsk | null {
  const m = pending
  pending = null
  return m
}
export function useReviewAsk(): ReviewAsk | null {
  return useSyncExternalStore(
    (f) => {
      ls.add(f)
      return () => ls.delete(f)
    },
    () => pending,
  )
}
