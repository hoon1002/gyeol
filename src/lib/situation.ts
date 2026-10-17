/**
 * 오늘 화면 상황 엔진 — M3 '조용한 화면'(design-quiet 1-2 · 리더 결정 3).
 * 한 줄 규칙: 수업 중이면 과목 이름, 아니면 숫자 하나(`09:00` + 과목 점 · `D-3` + 인주 점) 또는 없음.
 * 동작은 금빛 원 아이콘 하나(+ 숫자 뱃지). 이름·강의실·범위는 툴팁(길게)과 스크린리더 문장으로만.
 * 1분마다, 그리고 앱이 다시 보일 때 재평가(useNow).
 */
import type { CourseSlot, FocusSession, Note, Subject, Task } from '@/db/schema'
import { addDays, atTime, clamp, ddayOf, fmtDday, hm, minutesOfDay, MIN, weekdayShort } from './time'

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
  | { kind: 'go'; to: '/' | '/notes' | '/map' | '/review' | '/plan' | '/focus' }
  | { kind: 'focus'; minutes: number; subjectId: string | null }
  | { kind: 'review' }
  | { kind: 'note'; noteId: string | null; record?: boolean }
  | { kind: 'scroll'; id: string }
  | { kind: 'seed' }

export type SitIcon = 'note' | 'focus' | 'review' | 'grid'

/** 늘 보이는 한 줄(없을 수 있음) */
export interface SitLine {
  text: string
  /** 숫자(모노)인가, 데이터 글(과목 이름)인가 */
  num: boolean
  /** 앞 점 색(과목 · 인주). 없으면 점 없음 */
  dot: string | null
  /** 툴팁(길게) — 강의실·과목 이름·범위 */
  tip: string
  /** 스크린리더 문장 */
  sr: string
}

export interface Situation {
  key: SitKey
  line: SitLine | null
  /** 수업 진행선 (남은 시간은 글 대신 선) */
  progress: { value: number; label: string } | null
  /** 금빛 원 하나: 아이콘 + 숫자 뱃지(0이면 없음). label = aria-label = 툴팁 */
  primary: { icon: SitIcon; label: string; badge: number | null; action: SitAction } | null
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
  const nearestExam = openTasks.find((x) => x.kind === 'exam') ?? null
  const examD = nearestExam ? ddayOf(now, nearestExam.dueAt) : 99
  const rev = m.reviewDue.total
  const sets = m.focusToday.sets
  const load = clamp(rev / 40, 0, 1)
  const pressure = examD <= 3 ? 1 : clamp((14 - examD) / 14, 0, 1)
  const exam = nearestExam && examD >= 0 && examD <= 14 ? { id: nearestExam.id, dday: examD } : null
  const lastNote = (subjectId: string | null | undefined) => m.notes.find((n) => n.subjectId === subjectId) ?? null
  const base = { load, pressure, rings: sets, tintSubject: null as string | null, exam, progress: null as Situation['progress'] }

  /** 다음 수업 한 줄: `09:00` + 과목 점, 오늘이 아니면 `월 09:00` */
  const slotLine = (n: SlotAt | null): SitLine | null => {
    if (!n) return null
    const sameDay = ddayOf(now, n.start) === 0
    const when = `${sameDay ? '' : weekdayShort(n.start.getDay()) + ' '}${n.slot.start}`
    const name = nm(n.slot.subjectId)
    return { text: when, num: true, dot: subjectColor(n.slot.subjectId, subjects), tip: [name, n.slot.room].filter(Boolean).join(' · '), sr: `다음 수업 ${sameDay ? '' : weekdayShort(n.start.getDay()) + '요일 '}${n.slot.start} ${name}` }
  }
  const reviewBtn = (): Situation['primary'] => (rev > 0 ? { icon: 'review', label: '복습', badge: rev, action: { kind: 'review' } } : null)
  const focusBtn: NonNullable<Situation['primary']> = { icon: 'focus', label: '25분 집중', badge: null, action: { kind: 'focus', minutes: 25, subjectId: null } }

  // 1. 빈 상태: 시간표 그리기 아이콘 하나
  if (m.forceEmpty || m.slots.length === 0) {
    return { ...base, key: 'empty', line: null, primary: { icon: 'grid', label: '시간표 만들기', badge: null, action: { kind: 'go', to: '/plan' } }, mood: { speed: 0.7, knotStrength: 0.5 }, rings: 0, load: 0.1, pressure: 0, exam: null }
  }

  // 2. 수업 중: 한 줄 = 과목 이름(데이터)
  if (current) {
    const left = Math.max(1, Math.ceil((current.end.getTime() - t) / MIN))
    const total = (current.end.getTime() - current.start.getTime()) / MIN
    const name = nm(current.slot.subjectId)
    const note = lastNote(current.slot.subjectId)
    return {
      ...base,
      key: 'class',
      line: { text: name, num: false, dot: null, tip: [`${current.slot.start}–${current.slot.end}`, current.slot.room].filter(Boolean).join(' · '), sr: `${name} 수업 중, ${left}분 남음` },
      progress: { value: clamp(1 - left / total, 0, 1), label: `${name} 수업, ${left}분 남음` },
      primary: { icon: 'note', label: '노트 열기', badge: null, action: { kind: 'note', noteId: note?.id ?? null } },
      mood: { speed: 0.8, knotStrength: 0.95 },
      tintSubject: current.slot.subjectId,
    }
  }

  // 3. 시험 직전 (D-3 이하): 한 줄 = `D-3` + 인주 점, 범위는 길게
  if (nearestExam && examD <= 3 && examD >= 0) {
    const scope = m.examScope[nearestExam.id] ?? { total: 0, left: 0 }
    return {
      ...base,
      key: 'exam',
      line: { text: fmtDday(examD), num: true, dot: 'var(--seal)', tip: `${nearestExam.title} · 범위 ${scope.left}/${scope.total}`, sr: `${nearestExam.title}까지 ${examD}일, 범위 ${scope.total}장 중 ${scope.left}장 남음` },
      primary: { icon: 'review', label: '시험 복습', badge: scope.left || rev || null, action: { kind: 'review' } },
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
      line: slotLine(nextToday),
      primary: { icon: 'note', label: '지난 노트', badge: null, action: { kind: 'note', noteId: note?.id ?? null } },
      mood: { speed: 1.1, knotStrength: 0.9 },
      tintSubject: nextToday.slot.subjectId,
    }
  }

  // 5. 공강
  if (hour >= 5 && endedToday.length > 0 && nextToday) {
    return { ...base, key: 'gap', line: slotLine(nextToday), primary: reviewBtn() ?? focusBtn, mood: { speed: 1.0, knotStrength: 0.9 } }
  }

  // 6. 밤: 하늘(오늘의 별자리)이 말한다. 한 줄 = 다음 수업
  if (hour >= 21 || (hour >= 5 && today.length > 0 && endedToday.length === today.length && minutesOfDay(now) >= hm('16:00'))) {
    return { ...base, key: 'night', line: slotLine(nextAny), primary: focusBtn, mood: { speed: 0.6, knotStrength: 1.0 } }
  }

  // 7. 아침
  if (hour >= 5 && hour < 12 && startedToday.length === 0) {
    return { ...base, key: 'morning', line: slotLine(today[0] ?? null), primary: reviewBtn() ?? focusBtn, mood: { speed: 0.9, knotStrength: 0.8 } }
  }

  // 8. 새벽: 글 없음(다음 수업 숫자만)
  if (hour < 5) {
    return { ...base, key: 'late', line: slotLine(nextAny), primary: null, mood: { speed: 0.3, knotStrength: 0.6 } }
  }

  // 그 밖: 첫 수업 전 낮 · 수업 없는 날
  return {
    ...base,
    key: 'free',
    line: slotLine(nextToday),
    primary: reviewBtn() ?? focusBtn,
    mood: { speed: 1.0, knotStrength: 0.9 },
    tintSubject: nextToday?.slot.subjectId ?? null,
  }
}
