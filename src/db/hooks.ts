/** 데이터 훅 (dexie-react-hooks useLiveQuery). 화면은 여기서만 DB를 읽는다. */
import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo } from 'react'
import { db, type FocusSession, type Memo, type MemoState, type Note, type Subject } from './schema'
import { useSettings, type ClockPreset } from '@/stores/settings'
import { useUi } from '@/stores/ui'
import { atTime, addDays, DAY, MIN, studyDayRange, studyDayStart } from '@/lib/time'
import type { DayModel } from '@/lib/situation'

/* ---------- 시계 ---------- */

export interface NowInfo {
  now: Date
  preset: ClockPreset
  forceEmpty: boolean
}

export function presetNow(preset: ClockPreset, anchor: number | undefined): Date | null {
  if (preset === 'live' || anchor === undefined) return null
  const A = new Date(anchor)
  switch (preset) {
    case 'morning': return atTime(A, '08:10')
    case 'class': return atTime(A, '09:32')
    case 'gap': return atTime(A, '11:00')
    case 'before': return atTime(A, '12:50')
    case 'night': return atTime(A, '22:10')
    case 'late': return atTime(addDays(A, 1), '01:40')
    case 'exam': return atTime(addDays(A, 3), '19:40')
    case 'empty': return atTime(A, '09:32')
    default: return null
  }
}

export function useAnchor(): number | undefined {
  return useLiveQuery(async () => (await db.meta.get('anchor'))?.value as number | undefined, [])
}

/** 지금 시각 (설정 > 개발용 '시각 고정'을 따른다). 1분마다 + 다시 보일 때 갱신(RootLayout의 ClockTicker). */
export function useNow(): NowInfo {
  const preset = useSettings((s) => s.clock)
  const tick = useUi((s) => s.tick)
  const anchor = useAnchor()
  return useMemo(() => {
    const fixed = presetNow(preset, anchor)
    return { now: fixed ?? new Date(tick), preset, forceEmpty: preset === 'empty' }
  }, [preset, anchor, tick])
}

/* ---------- 공통 ---------- */

export function useSubjects(): Subject[] | undefined {
  return useLiveQuery(() => db.subjects.orderBy('order').toArray(), [])
}

export function useProfile(): { name: string; initial: string } {
  const p = useLiveQuery(async () => (await db.meta.get('profile'))?.value as { name: string; initial: string } | undefined, [])
  return p ?? { name: '도윤', initial: '도' }
}

function sumMin(list: FocusSession[]): number {
  return Math.round(list.reduce((a, s) => a + (s.endedAt - s.startedAt), 0) / MIN)
}

/* ---------- 오늘 ---------- */

export interface TodayData {
  model: DayModel
  recent: Note[]
}

export function useToday(now: Date, forceEmpty: boolean): TodayData | undefined {
  const minuteKey = Math.floor(now.getTime() / MIN)
  return useLiveQuery(async () => {
    const t = now.getTime()
    const [a, b] = studyDayRange(now)
    const [subjects, slots, tasks, notes, dueCards, tomorrowCount, sessions, metaRows] = await Promise.all([
      db.subjects.orderBy('order').toArray(),
      db.courseSlots.toArray(),
      db.tasks.where('done').equals(0).toArray(),
      db.notes.orderBy('updatedAt').reverse().toArray(),
      db.cards.where('due').below(b).toArray(),
      db.cards.where('due').between(b, b + DAY).count(),
      db.focusSessions.where('startedAt').between(a, b).toArray(),
      db.meta.bulkGet(['profile', 'term', 'goalMin']),
    ])
    const [profile, term, goal] = metaRows
    const name = (profile?.value as { name?: string } | undefined)?.name ?? '도윤'
    const termStart = (term?.value as { start?: number } | undefined)?.start
    const goalMin = (goal?.value as number | undefined) ?? 240
    const sd = studyDayStart(now)
    const weekOfTerm = termStart ? Math.floor((sd.getTime() - termStart) / (7 * DAY)) + 1 : null

    const bySubjectMap = new Map<string, number>()
    dueCards.forEach((c) => bySubjectMap.set(c.subjectId, (bySubjectMap.get(c.subjectId) ?? 0) + 1))
    const bySubject = [...bySubjectMap.entries()]
      .map(([subjectId, count]) => ({ subjectId, count }))
      .sort((x, y) => y.count - x.count)

    const exams = tasks.filter((x) => x.kind === 'exam')
    const scopeCards = exams.length ? await db.cards.where('examId').anyOf(exams.map((e) => e.id)).toArray() : []
    const examScope: DayModel['examScope'] = {}
    exams.forEach((e) => {
      const list = scopeCards.filter((c) => c.examId === e.id)
      examScope[e.id] = { total: list.length, left: list.filter((c) => c.reps === 0).length }
    })

    const done = sessions.filter((s) => s.completed && s.endedAt <= t)
    const todaySessions = done.filter((s) => s.startedAt >= a && s.startedAt < b).sort((x, y) => x.startedAt - y.startedAt)

    const model: DayModel = {
      now,
      name,
      weekOfTerm,
      subjects,
      slots: forceEmpty ? [] : slots,
      tasks,
      examScope,
      reviewDue: { total: dueCards.length, bySubject },
      reviewTomorrow: tomorrowCount,
      focusToday: { sets: todaySessions.length, minutes: sumMin(todaySessions), sessions: todaySessions },
      goalMin,
      notes,
      forceEmpty,
    }

    return { model, recent: notes.slice(0, 3) }
  }, [minuteKey, forceEmpty])
}

/* ---------- 노트 ---------- */

export function useNotes(): Note[] | undefined {
  return useLiveQuery(() => db.notes.orderBy('updatedAt').reverse().filter((n) => !n.deletedAt).toArray(), [])
}

/* ---------- 복습 ---------- */

export interface ReviewData {
  due: number
  bySubject: Array<{ subjectId: string; count: number }>
  tomorrow: number
  retention: number
  total: number
}

export function useReview(now: Date): ReviewData | undefined {
  const key = Math.floor(now.getTime() / MIN)
  return useLiveQuery(async () => {
    const [, b] = studyDayRange(now)
    const [dueCards, tomorrow, total, ret] = await Promise.all([
      db.cards.where('due').below(b).toArray(),
      db.cards.where('due').between(b, b + DAY).count(),
      db.cards.count(),
      db.meta.get('retention'),
    ])
    const m = new Map<string, number>()
    dueCards.forEach((c) => m.set(c.subjectId, (m.get(c.subjectId) ?? 0) + 1))
    return {
      due: dueCards.length,
      bySubject: [...m.entries()].map(([subjectId, count]) => ({ subjectId, count })).sort((x, y) => y.count - x.count),
      tomorrow,
      retention: (ret?.value as number | undefined) ?? 0.9,
      total,
    }
  }, [key])
}

/* ---------- 플래너 ---------- */

export function usePlanner() {
  return useLiveQuery(async () => {
    const [slots, tasks] = await Promise.all([db.courseSlots.toArray(), db.tasks.orderBy('dueAt').toArray()])
    return { slots, tasks }
  }, [])
}

/* ---------- 집중 ---------- */

export function useFocusToday(now: Date): { minutes: number; sets: number; list: Array<{ id: string; startedAt: number }> } | undefined {
  const key = Math.floor(now.getTime() / MIN)
  return useLiveQuery(async () => {
    const [a, b] = studyDayRange(now)
    const list = await db.focusSessions.where('startedAt').between(a, b).filter((s) => s.completed && s.endedAt <= now.getTime()).toArray()
    list.sort((a, b) => a.startedAt - b.startedAt)
    return { minutes: sumMin(list), sets: list.length, list: list.map((s) => ({ id: s.id, startedAt: s.startedAt })) }
  }, [key])
}

/* ---------- 별가루 (1초 메모) ---------- */

/** state별 메모, 최근 것이 위 */
export function useMemos(state: MemoState): Memo[] | undefined {
  return useLiveQuery(async () => (await db.memos.where('state').equals(state).toArray()).sort((a, b) => b.createdAt - a.createdAt), [state])
}

export function useMemoCount(state: MemoState): number | undefined {
  return useLiveQuery(() => db.memos.where('state').equals(state).count(), [state])
}

/** 사진 메모 썸네일 URL (없으면 null). 쓰고 나면 해제 */
export function useAssetUrl(id: string | null | undefined): string | null {
  const blob = useLiveQuery(async () => (id ? ((await db.assets.get(id))?.blob ?? null) : null), [id])
  const url = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob])
  useEffect(() => () => { if (url) URL.revokeObjectURL(url) }, [url])
  return url
}
