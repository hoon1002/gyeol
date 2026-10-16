/**
 * 오늘 화면 상황 엔진 (design-v2 4-1 조건 · 문구는 design-v3 4-2 '글 다이어트').
 * 형식: 명사구 1 + 메타 1 + 동작 1(+보조 0~1) + 지평선 줄(항목 ≤ 3). "~요" 문장·자랑·비교·% 없음.
 * 1분마다, 그리고 앱이 다시 보일 때 재평가(useNow).
 */
import type { CourseSlot, FocusSession, Note, Subject, Task } from '@/db/schema'
import { addDays, atTime, clamp, ddayOf, fmtDday, fmtHM, hm, minutesOfDay, MIN, weekdayKo, weekdayShort } from './time'

export type SitKey = 'empty' | 'class' | 'exam' | 'before' | 'gap' | 'night' | 'morning' | 'late' | 'free'

export interface DayModel {
  now: Date
  name: string
  weekOfTerm: number | null
  subjects: Subject[]
  slots: CourseSlot[]
  tasks: Task[]
  /** 시험 id → 범위 카드 { total, left(미학습) } */
  examScope: Record<string, { total: number; left: number }>
  reviewDue: { total: number; bySubject: Array<{ subjectId: string; count: number }> }
  reviewTomorrow: number
  focusToday: { sets: number; minutes: number; sessions: FocusSession[] }
  focusYesterday: number
  goalMin: number
  notes: Note[]
  forceEmpty?: boolean
}

export interface ShelfRow {
  k: string
  v: string
  color?: string
}

/** 지평선 줄 항목 (누르면 그 자리 선반) */
export interface Peri {
  id: string
  label: string
  value: string
  color: string
  shelf: ShelfRow[]
}

export type SitAction =
  | { kind: 'go'; to: '/' | '/notes' | '/graph' | '/review' | '/planner' | '/focus' | '/settings' }
  | { kind: 'focus'; minutes: number; subjectId: string | null }
  | { kind: 'review' }
  | { kind: 'note'; noteId: string | null; record?: boolean }
  | { kind: 'scroll'; id: string }
  | { kind: 'seed' }

export interface Situation {
  key: SitKey
  /** 명사구 (12자 이하) */
  title: string
  /** 메타 한 줄 (모노) */
  meta: string
  /** 수업 진행선 (D5: 남은 시간은 글 대신 선) */
  progress: { value: number; label: string } | null
  primary: { label: string; action: SitAction } | null
  quiet: { label: string; action: SitAction } | null
  peri: Peri[]
  mood: { speed: number; knotStrength: number }
  tintSubject: string | null
  rings: number
  load: number
  pressure: number
  /** 시험 별 */
  exam: { id: string; dday: number } | null
}

export function subjectColor(id: string | null | undefined, subjects: Subject[]): string {
  const s = subjects.find((x) => x.id === id)
  return s ? `var(--s-${s.color})` : 'var(--text-3)'
}

interface SlotAt {
  slot: CourseSlot
  start: Date
  end: Date
}

export function slotsOn(day: Date, slots: CourseSlot[]): SlotAt[] {
  return slots
    .filter((s) => s.weekday === day.getDay())
    .map((slot) => ({ slot, start: atTime(day, slot.start), end: atTime(day, slot.end) }))
    .sort((a, b) => a.start.getTime() - b.start.getTime())
}

export function nextSlotAfter(now: Date, slots: CourseSlot[]): SlotAt | null {
  for (let d = 0; d < 8; d++) {
    const found = slotsOn(addDays(now, d), slots).find((x) => x.start.getTime() > now.getTime())
    if (found) return found
  }
  return null
}

function stripSubject(title: string, subjects: Subject[]): string {
  for (const s of subjects) if (title.startsWith(s.name + ' ')) return title.slice(s.name.length + 1)
  return title
}

export function evaluateSituation(m: DayModel): Situation {
  const { now, subjects } = m
  const nm = (id: string | null | undefined) => subjects.find((s) => s.id === id)?.name ?? '자유'
  const hour = now.getHours()
  const t = now.getTime()
  const today = slotsOn(now, m.slots)
  const current = today.find((x) => x.start.getTime() <= t && t < x.end.getTime()) ?? null
  const nextToday = today.find((x) => x.start.getTime() > t) ?? null
  const startedToday = today.filter((x) => x.start.getTime() <= t)
  const endedToday = today.filter((x) => x.end.getTime() <= t)
  const nextAny = nextSlotAfter(now, m.slots)
  const openTasks = m.tasks.filter((x) => !x.done && x.dueAt >= t - 12 * 60 * MIN).sort((a, b) => a.dueAt - b.dueAt)
  const exams = openTasks.filter((x) => x.kind === 'exam')
  const nearestExam = exams[0] ?? null
  const examD = nearestExam ? ddayOf(now, nearestExam.dueAt) : 99
  const nearestAssignment = openTasks.find((x) => x.kind !== 'exam') ?? null
  const rev = m.reviewDue.total
  const revMin = Math.max(1, Math.round(rev * 0.6))
  const sets = m.focusToday.sets
  const load = clamp(rev / 40, 0, 1)
  const pressure = examD <= 3 ? 1 : clamp((14 - examD) / 14, 0, 1)
  const exam = nearestExam && examD >= 0 && examD <= 14 ? { id: nearestExam.id, dday: examD } : null

  /* 지평선 줄 항목 */
  const dayShelf = (list: SlotAt[]): ShelfRow[] =>
    list.length ? list.slice(0, 5).map((x) => ({ k: x.slot.start, v: `${nm(x.slot.subjectId)} · ${x.slot.room}`, color: subjectColor(x.slot.subjectId, subjects) })) : [{ k: '—', v: '수업 없음' }]
  const taskShelf = (): ShelfRow[] =>
    openTasks.length
      ? openTasks.slice(0, 5).map((x) => ({ k: fmtDday(ddayOf(now, x.dueAt)), v: `${x.title} · ${weekdayShort(new Date(x.dueAt).getDay())} ${fmtHM(x.dueAt)}`, color: subjectColor(x.subjectId, subjects) }))
      : [{ k: '—', v: '마감 없음' }]
  const pNext = (): Peri | null => {
    const n = nextToday ?? nextAny
    if (!n) return null
    const sameDay = ddayOf(now, n.start) === 0
    return { id: 'next', label: `${sameDay ? '' : weekdayShort(n.start.getDay()) + ' '}${n.slot.start} ${nm(n.slot.subjectId)}`, value: '', color: subjectColor(n.slot.subjectId, subjects), shelf: dayShelf(sameDay ? today : slotsOn(n.start, m.slots)) }
  }
  const pReview = (): Peri =>
    rev > 0
      ? { id: 'review', label: `복습 ${rev}`, value: '', color: subjectColor(m.reviewDue.bySubject[0]?.subjectId, subjects), shelf: m.reviewDue.bySubject.map((b) => ({ k: `${b.count}`, v: nm(b.subjectId), color: subjectColor(b.subjectId, subjects) })) }
      : { id: 'review', label: '복습 끝', value: '', color: 'var(--accent)', shelf: [{ k: '내일', v: `${m.reviewTomorrow}장` }] }
  const pExam = (): Peri | null =>
    nearestExam ? { id: 'exam', label: `${stripSubject(nearestExam.title, subjects)} ${fmtDday(examD)}`, value: '', color: 'var(--seal)', shelf: taskShelf() } : null
  const pTask = (): Peri | null =>
    nearestAssignment ? { id: 'task', label: `${stripSubject(nearestAssignment.title, subjects)} ${fmtDday(ddayOf(now, nearestAssignment.dueAt))}`, value: '', color: subjectColor(nearestAssignment.subjectId, subjects), shelf: taskShelf() } : null
  const line = (...xs: Array<Peri | null>): Peri[] => xs.filter((x): x is Peri => !!x).slice(0, 3)
  const lastNote = (subjectId: string | null | undefined) => m.notes.find((n) => n.subjectId === subjectId) ?? null
  const base = { load, pressure, rings: sets, tintSubject: null as string | null, exam, progress: null as Situation['progress'] }
  const review: SitAction = { kind: 'review' }
  const focus25: SitAction = { kind: 'focus', minutes: 25, subjectId: null }

  // 1. 빈 상태
  if (m.forceEmpty || m.slots.length === 0) {
    return { ...base, key: 'empty', title: '시간표', meta: '비어 있음', primary: { label: '만들기', action: { kind: 'go', to: '/planner' } }, quiet: { label: '샘플', action: { kind: 'seed' } }, peri: [], mood: { speed: 0.7, knotStrength: 0.5 }, rings: 0, load: 0.1, pressure: 0, exam: null }
  }

  // 2. 수업 중
  if (current) {
    const left = Math.max(1, Math.ceil((current.end.getTime() - t) / MIN))
    const total = (current.end.getTime() - current.start.getTime()) / MIN
    const name = nm(current.slot.subjectId)
    const note = lastNote(current.slot.subjectId)
    return {
      ...base,
      key: 'class',
      title: name,
      meta: `${current.slot.start} – ${current.slot.end} · ${current.slot.room}`,
      progress: { value: clamp(1 - left / total, 0, 1), label: `${name} 수업, ${left}분 남음` },
      primary: { label: '노트 열기', action: { kind: 'note', noteId: note?.id ?? null } },
      quiet: { label: '녹음', action: { kind: 'note', noteId: note?.id ?? null, record: true } },
      peri: line(pNext(), pReview(), pExam()),
      mood: { speed: 0.8, knotStrength: 0.95 },
      tintSubject: current.slot.subjectId,
    }
  }

  // 3. 시험 직전 (D-3 이하)
  if (nearestExam && examD <= 3 && examD >= 0) {
    const scope = m.examScope[nearestExam.id] ?? { total: 0, left: 0 }
    return {
      ...base,
      key: 'exam',
      title: nearestExam.title,
      meta: `${fmtDday(examD)} · 범위 ${scope.left} / ${scope.total}`,
      primary: { label: '시험 복습', action: review },
      quiet: { label: '범위', action: { kind: 'go', to: '/review' } },
      peri: line(pNext(), pTask()),
      mood: { speed: 1.6, knotStrength: 1.1 },
      tintSubject: nearestExam.subjectId,
    }
  }

  // 4. 수업 직전 (15분 이하)
  if (nextToday && Math.ceil((nextToday.start.getTime() - t) / MIN) <= 15) {
    const note = lastNote(nextToday.slot.subjectId)
    return {
      ...base,
      key: 'before',
      title: nm(nextToday.slot.subjectId),
      meta: `${nextToday.slot.start} · ${nextToday.slot.room}`,
      primary: { label: '지난 노트', action: { kind: 'note', noteId: note?.id ?? null } },
      quiet: { label: 'PDF', action: { kind: 'note', noteId: note?.id ?? null } },
      peri: line(pReview(), pExam()),
      mood: { speed: 1.1, knotStrength: 0.9 },
      tintSubject: nextToday.slot.subjectId,
    }
  }

  // 5. 공강
  if (hour >= 5 && endedToday.length > 0 && nextToday) {
    return {
      ...base,
      key: 'gap',
      title: '공강',
      meta: `~ ${nextToday.slot.start}${rev ? ` · 복습 ${rev}장 ${revMin}분` : ''}`,
      primary: rev ? { label: '복습', action: review } : { label: '25분', action: focus25 },
      quiet: rev ? { label: '25분', action: focus25 } : null,
      peri: line(pNext(), pTask()),
      mood: { speed: 1.0, knotStrength: 0.9 },
    }
  }

  // 6. 밤
  if (hour >= 21 || (hour >= 5 && today.length > 0 && endedToday.length === today.length && minutesOfDay(now) >= hm('16:00'))) {
    const n = nextAny
    const isTomorrow = n ? ddayOf(now, n.start) === 1 : false
    return {
      ...base,
      key: 'night',
      title: '오늘의 별',
      meta: n ? `${isTomorrow ? '내일' : weekdayKo(n.start)} ${n.slot.start} ${nm(n.slot.subjectId)}` : '다음 수업 없음',
      primary: { label: '25분 집중', action: focus25 },
      quiet: null,
      peri: line(pTask(), pReview(), pExam()),
      mood: { speed: 0.6, knotStrength: 1.0 },
    }
  }

  // 7. 아침
  if (hour >= 5 && hour < 12 && startedToday.length === 0) {
    const f = today[0]
    return {
      ...base,
      key: 'morning',
      title: weekdayKo(now),
      meta: f ? `${f.slot.start} ${nm(f.slot.subjectId)} · 수업 ${today.length}` : '수업 없음',
      primary: { label: '복습', action: review },
      quiet: null,
      peri: line(pExam()),
      mood: { speed: 0.9, knotStrength: 0.8 },
    }
  }

  // 8. 새벽
  if (hour < 5) {
    return {
      ...base,
      key: 'late',
      title: '새벽',
      meta: nextAny ? `다음 ${nextAny.slot.start} ${nm(nextAny.slot.subjectId)}` : '다음 수업 없음',
      primary: null,
      quiet: null,
      peri: [],
      mood: { speed: 0.3, knotStrength: 0.6 },
    }
  }

  // 그 밖: 수업 없는 날 · 첫 수업 전 낮
  if (nextToday) {
    return {
      ...base,
      key: 'free',
      title: nm(nextToday.slot.subjectId),
      meta: `${nextToday.slot.start} · ${nextToday.slot.room}`,
      primary: rev ? { label: '복습', action: review } : { label: '25분', action: focus25 },
      quiet: rev ? { label: '25분', action: focus25 } : null,
      peri: line(pTask()),
      mood: { speed: 1.0, knotStrength: 0.9 },
      tintSubject: nextToday.slot.subjectId,
    }
  }
  return {
    ...base,
    key: 'free',
    title: '수업 없는 날',
    meta: rev ? `복습 ${rev}장 · ${revMin}분` : '복습 없음',
    primary: rev ? { label: '복습', action: review } : { label: '25분', action: focus25 },
    quiet: rev ? { label: '25분', action: focus25 } : null,
    peri: line(pTask()),
    mood: { speed: 1.0, knotStrength: 0.9 },
  }
}
