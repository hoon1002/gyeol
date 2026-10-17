/** 떠올리기 모드 열기 신호 (앱 A). 노트 장소가 Recall(지연 조각)을 띄운다. 입구: 종이 머리 · ⋯ 메뉴 · ⌘K · ⌥R */
import { useSyncExternalStore } from 'react'
import { db } from '@/db/schema'

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

/** 떠올리기 입구를 보일지: 글 노트는 본문 80자 이상, 필기는 획 · 글 상자가 하나라도, PDF는 늘 (QA M4 #6) */
export async function recallReady(noteId: string): Promise<boolean> {
  const n = await db.notes.get(noteId)
  if (!n || n.deletedAt) return false
  if (n.kind === 'pdf') return true
  if (n.kind === 'ink') {
    const ids = (await db.pages.where('noteId').equals(noteId).toArray()).filter((p) => !p.deletedAt).map((p) => p.id)
    if (!ids.length) return false
    return (await db.strokes.where('pageId').anyOf(ids).count()) > 0 || (await db.pageItems.where('pageId').anyOf(ids).count()) > 0
  }
  return ((await db.noteBodies.get(noteId))?.text ?? '').trim().length >= 80
}
