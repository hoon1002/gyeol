/** 시간표 저장소 (계획 화면 = DB, 첫 실행 ?onboarding=1 = 메모리). 격자·.ics 미리보기는 이 모양만 안다 */
import { db, uid, type CourseSlot, type Subject, type SubjectColor } from '@/db/schema'
import type { IcsClass } from '@/lib/ics'

export const COLORS: SubjectColor[] = ['phys', 'math', 'chem', 'bio', 'econ', 'writing', 'eng', 'hist']

/** 과목 색의 한글 이름 (tokens.css --s-* 실제 색: #5CB8FF · #8F9BFF · #3ED6C0 · #8EDB6B · #F5C451 · #FF8DB5 · #C29BFF · #D9B38C) — 견본 aria-label·툴팁 */
export const COLOR_NAME: Record<SubjectColor, string> = {
  phys: '하늘색',
  math: '남보라',
  chem: '청록',
  bio: '연두',
  econ: '금색',
  writing: '분홍',
  eng: '보라',
  hist: '모래색',
}

export type SlotInput = Pick<CourseSlot, 'subjectId' | 'weekday' | 'start' | 'end' | 'room'> & { id?: string }

export interface TimetableStore {
  subjects: Subject[]
  slots: CourseSlot[]
  createSubject: (name: string, color: SubjectColor) => Promise<Subject>
  saveSlot: (s: SlotInput) => Promise<CourseSlot>
  deleteSlot: (id: string) => Promise<void>
  restoreSlot: (s: CourseSlot) => Promise<void>
}

export function nextColor(subjects: Subject[]): SubjectColor {
  const used = new Set(subjects.map((s) => s.color))
  return COLORS.find((c) => !used.has(c)) ?? COLORS[subjects.length % COLORS.length]!
}

export function makeSubject(name: string, color: SubjectColor, order: number): Subject {
  const n = name.trim()
  const now = Date.now()
  return { id: uid('subj-'), name: n, short: n.length > 4 ? n.slice(0, 4) : n, color, aliases: [n], order, createdAt: now, updatedAt: now }
}

export function makeSlot(s: SlotInput, prev?: CourseSlot): CourseSlot {
  const now = Date.now()
  return { id: s.id ?? uid('slot-'), subjectId: s.subjectId, weekday: s.weekday, start: s.start, end: s.end, room: s.room, kind: prev?.kind ?? 'lecture', createdAt: prev?.createdAt ?? now, updatedAt: now }
}

/** DB에 바로 쓰는 저장소 (계획 화면 · 첫 실행 실제 모드) */
export function dbStore(subjects: Subject[], slots: CourseSlot[]): TimetableStore {
  return {
    subjects,
    slots,
    createSubject: async (name, color) => {
      const order = (await db.subjects.count()) || 0
      const s = makeSubject(name, color, order)
      await db.subjects.add(s)
      return s
    },
    saveSlot: async (input) => {
      const prev = input.id ? await db.courseSlots.get(input.id) : undefined
      const slot = makeSlot(input, prev)
      await db.courseSlots.put(slot)
      return slot
    },
    deleteSlot: async (id) => {
      await db.courseSlots.delete(id)
    },
    restoreSlot: async (s) => {
      await db.courseSlots.put(s)
    },
  }
}

/** .ics 수업 → 과목(SUMMARY로 추정, 없으면 새로) + 칸. 넣은 칸 수 */
export async function importClasses(list: IcsClass[], store: TimetableStore): Promise<number> {
  const subjects = [...store.subjects]
  const bySummary = new Map<string, string>()
  let n = 0
  for (const c of list) {
    let sid = bySummary.get(c.summary)
    if (!sid) {
      // 수업 이름은 별칭 '포함'이 아니라 이름·별칭이 같거나 전체 이름을 품을 때만 같은 과목으로 본다('선형대수학' ≠ '공업수학'의 '수학')
      const t = c.summary.replace(/\s+/g, '').toLowerCase()
      const guess = subjects.find((s) => [s.name, s.short, ...s.aliases].some((a) => a.replace(/\s+/g, '').toLowerCase() === t)) ?? subjects.find((s) => t.includes(s.name.replace(/\s+/g, '').toLowerCase())) ?? null
      const subj = guess ?? (await store.createSubject(c.summary, nextColor(subjects)))
      if (!guess) subjects.push(subj)
      sid = subj.id
      bySummary.set(c.summary, sid)
    }
    const dup = store.slots.some((s) => s.subjectId === sid && s.weekday === c.weekday && s.start === c.start && s.end === c.end)
    if (dup) continue
    await store.saveSlot({ subjectId: sid, weekday: c.weekday, start: c.start, end: c.end, room: c.location })
    n++
  }
  return n
}
