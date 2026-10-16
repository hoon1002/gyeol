/**
 * 첫 실행 샘플 시드 (team/design-v2.md 4-1 '샘플 데이터'): 2학기 7주차, 사용자 '도윤'.
 * 기준일(anchor) = 시드를 넣는 날. 시간표·시험·집중 기록은 모두 이 날을 기준으로 놓는다.
 * 설정 > 개발용 '시각 고정'은 이 기준일의 특정 시각으로 시계를 옮긴다.
 */
import { db, type Card, type CourseSlot, type DailyStat, type FocusSession, type Note, type Subject, type Task } from './schema'
import { addDays, atTime, dayKey, startOfDay, startOfWeek, MIN, HOUR, DAY } from '@/lib/time'

export const SEED_VERSION = 1

const SUBJECTS: Array<Omit<Subject, 'createdAt' | 'updatedAt'>> = [
  { id: 'phys', name: '일반물리', short: '물리', color: 'phys', aliases: ['일반물리', '열역학', '물리', '역학', 'physics', 'phys'], order: 0 },
  { id: 'math', name: '공업수학', short: '공수', color: 'math', aliases: ['공업수학', '공수', '수학', '라플라스', 'math'], order: 1 },
  { id: 'chem', name: '일반화학', short: '화학', color: 'chem', aliases: ['일반화학', '화학', '화실', 'chem'], order: 2 },
  { id: 'econ', name: '경제학원론', short: '경제', color: 'econ', aliases: ['경제학원론', '경제학', '경제', '경원', 'econ'], order: 3 },
  { id: 'writing', name: '글쓰기', short: '글쓰기', color: 'writing', aliases: ['글쓰기', '작문', '국어', 'writing'], order: 4 },
  { id: 'eng', name: '영어', short: '영어', color: 'eng', aliases: ['영어', '영작', '토익', 'english', 'eng'], order: 5 },
]

const PHYS_CARDS: Array<[string, string]> = [
  ['열역학 제2법칙(클라우지우스)', '열은 저절로 차가운 곳에서 뜨거운 곳으로 흐르지 않는다'],
  ['엔트로피 변화 dS', 'δQ_rev / T'],
  ['카르노 효율', '1 − T_c / T_h'],
  ['고립계의 엔트로피', '줄어들지 않는다 (ΔS ≥ 0)'],
  ['이상기체 등온 팽창의 일', 'nRT ln(V₂/V₁)'],
  ['내부 에너지 변화', 'ΔU = Q − W'],
  ['비열비 γ', 'C_p / C_v'],
  ['단열 과정', 'PV^γ = 일정'],
]
const MATH_CARDS: Array<[string, string]> = [
  ['L{1}', '1/s'],
  ['L{e^{at}}', '1/(s − a)'],
  ['L{sin ωt}', 'ω/(s² + ω²)'],
  ['L{f′(t)}', 'sF(s) − f(0)'],
  ['제1이동정리', 'L{e^{at}f(t)} = F(s − a)'],
  ['합성곱 정리', 'L{f*g} = F(s)G(s)'],
]
const ENG_CARDS: Array<[string, string]> = [
  ['“이 그래프가 보여 주듯이”', 'As this graph illustrates, …'],
  ['“요점으로 돌아가면”', 'To get back to the main point, …'],
  ['“질문이 있으면 언제든”', 'Feel free to jump in with questions.'],
  ['“정리하자면”', 'To sum up, …'],
  ['“다음 장으로 넘어가서”', 'Moving on to the next slide, …'],
]

/** 결정적 의사난수 (같은 기준일 = 같은 시드) */
function rng(seed: number) {
  let s = seed % 2147483647
  if (s <= 0) s += 2147483646
  return () => (s = (s * 16807) % 2147483647) / 2147483647
}

export async function isSeeded(): Promise<boolean> {
  try {
    const m = await db.meta.get('seed')
    return !!m
  } catch {
    return true // DB를 못 열면 시드도 시도하지 않는다
  }
}

/** 첫 실행이면 샘플을 넣는다. 이미 있으면 아무것도 하지 않는다. */
export async function ensureSeed(): Promise<void> {
  if (await isSeeded()) return
  await seedSample()
}

/** 모든 표를 비우고 샘플을 다시 넣는다 (설정 > 개발용, 빈 상태 '샘플로 둘러보기') */
export async function seedSample(anchorInput: Date = new Date()): Promise<void> {
  const now = Date.now()
  // 새벽 4시 전이면 어제를 기준일로 (학습일 경계)
  const anchor = startOfDay(anchorInput.getHours() < 4 ? addDays(anchorInput, -1) : anchorInput)
  const A = anchor.getTime()
  const wd = anchor.getDay()
  const rand = rng(Math.floor(A / DAY))
  const stamp = { createdAt: now, updatedAt: now }

  const subjects: Subject[] = SUBJECTS.map((s) => ({ ...s, ...stamp }))

  // ---- 시간표: 기준일 3개 + 나머지 평일 6개 = 주 9개 ----
  const weekdays = [1, 2, 3, 4, 5]
  const others = weekdays.filter((d) => d !== wd)
  const after = others.filter((d) => d > wd)
  const before = others.filter((d) => d < wd)
  const ordered = [...after, ...before]
  const slotDefs: Array<[number, string, string, string, string, CourseSlot['kind']?]> = [
    [wd, 'phys', '09:00', '10:15', '공학관 302'],
    [wd, 'math', '13:00', '14:15', '공학관 412'],
    [wd, 'chem', '15:00', '17:00', '실험동 1층', 'lab'],
    [ordered[0] ?? 1, 'econ', '09:00', '10:15', '사회관 105'],
    [ordered[0] ?? 1, 'writing', '11:00', '12:15', '인문관 210'],
    [ordered[1] ?? 2, 'phys', '10:30', '11:45', '공학관 302'],
    [ordered[1] ?? 2, 'eng', '14:00', '15:15', '어학관 403'],
    [ordered[2] ?? 3, 'math', '10:30', '11:45', '공학관 412'],
    [ordered[2] ?? 3, 'econ', '15:00', '16:15', '사회관 105'],
  ]
  const slots: CourseSlot[] = slotDefs.map(([weekday, subjectId, start, end, room, kind], i) => ({
    id: `slot-${i}`,
    subjectId,
    weekday,
    start,
    end,
    room,
    kind: kind ?? 'lecture',
    ...stamp,
  }))

  // ---- 시험 · 마감 ----
  const midterm: Task = { id: 'task-midterm', subjectId: 'phys', kind: 'exam', title: '일반물리 중간고사', dueAt: atTime(addDays(A, 6), '10:00').getTime(), done: 0, ...stamp }
  const tasks: Task[] = [
    midterm,
    { id: 'task-hw3', subjectId: 'math', kind: 'assignment', title: '공업수학 과제 3', dueAt: atTime(addDays(A, 1), '23:59').getTime(), done: 0, ...stamp },
    { id: 'task-quiz', subjectId: 'econ', kind: 'quiz', title: '경제학원론 퀴즈', dueAt: atTime(addDays(A, 9), '10:30').getTime(), done: 0, ...stamp },
  ]

  // ---- 노트 (메타) ----
  const lastMonday = (() => {
    const back = ((wd + 6) % 7) || 7
    return addDays(A, -back).getTime() + 20 * HOUR
  })()
  const notes: Note[] = [
    { id: 'note-entropy', title: '엔트로피와 열역학 제2법칙', subjectId: 'phys', kind: 'ink', pages: 4, page: 4, excerpt: 'ΔS ≥ Q/T', createdAt: A - 6 * DAY, updatedAt: now - 2 * MIN },
    { id: 'note-carnot', title: '카르노 기관과 효율', subjectId: 'phys', kind: 'doc', createdAt: A - 8 * DAY, updatedAt: A - DAY + 21 * HOUR },
    { id: 'note-laplace', title: '라플라스 변환 정리', subjectId: 'math', kind: 'doc', createdAt: A - 9 * DAY, updatedAt: A - DAY + 22 * HOUR },
    { id: 'note-equil', title: '화학 평형과 르샤틀리에', subjectId: 'chem', kind: 'pdf', page: 12, pages: 40, createdAt: A - 12 * DAY, updatedAt: lastMonday },
    { id: 'note-pitch', title: '발표 표현 50선', subjectId: 'eng', kind: 'deck', createdAt: A - 20 * DAY, updatedAt: A + 7 * HOUR },
    { id: 'note-ode', title: '미분방정식 연습 2주차', subjectId: 'math', kind: 'ink', pages: 6, createdAt: A - 14 * DAY, updatedAt: A - 3 * DAY + 19 * HOUR },
    { id: 'note-elastic', title: '수요와 공급의 탄력성', subjectId: 'econ', kind: 'doc', createdAt: A - 10 * DAY, updatedAt: A - 2 * DAY + 15 * HOUR },
    { id: 'note-essay', title: '논증적 글쓰기 초안', subjectId: 'writing', kind: 'doc', createdAt: A - 5 * DAY, updatedAt: A - 4 * DAY + 23 * HOUR },
  ]

  // ---- 카드: 오늘 13장(물리 6 · 공수 4 · 영어 3), 내일 2장, 시험 범위 42장 중 18장 미학습 ----
  const cards: Card[] = []
  const dueToday = A + 4 * HOUR + 30 * MIN
  const tomorrow = A + DAY + 6 * HOUR
  const mk = (subjectId: string, i: number, pair: [string, string], due: number, extra: Partial<Card> = {}): Card => ({
    id: `card-${subjectId}-${i}`,
    subjectId,
    noteId: null,
    examId: null,
    front: pair[0],
    back: pair[1],
    due,
    state: 'review',
    reps: 2 + Math.floor(rand() * 5),
    lapses: rand() < 0.2 ? 1 : 0,
    lastReview: A - Math.floor(2 + rand() * 6) * DAY,
    ...stamp,
    ...extra,
  })
  // 물리: 시험 범위 42장 (학습 24 + 미학습 18). 학습한 것 중 6장 오늘, 1장 내일.
  for (let i = 0; i < 42; i++) {
    const pair = PHYS_CARDS[i % PHYS_CARDS.length]!
    const label: [string, string] = [i < PHYS_CARDS.length ? pair[0] : `${pair[0]} · ${Math.floor(i / PHYS_CARDS.length) + 1}`, pair[1]]
    if (i < 24) {
      const due = i < 6 ? dueToday : i === 6 ? tomorrow : A + (2 + (i % 8)) * DAY
      cards.push(mk('phys', i, label, due, { examId: midterm.id, noteId: i % 2 ? 'note-carnot' : 'note-entropy' }))
    } else {
      cards.push(mk('phys', i, label, A + (3 + (i % 3)) * DAY, { examId: midterm.id, state: 'new', reps: 0, lapses: 0, lastReview: null, noteId: 'note-entropy' }))
    }
  }
  for (let i = 0; i < 12; i++) {
    const due = i < 4 ? dueToday : i === 4 ? tomorrow : A + (2 + (i % 9)) * DAY
    cards.push(mk('math', i, MATH_CARDS[i % MATH_CARDS.length]!, due, { noteId: 'note-laplace' }))
  }
  for (let i = 0; i < 15; i++) {
    const due = i < 3 ? dueToday : A + (2 + (i % 7)) * DAY
    cards.push(mk('eng', i, ENG_CARDS[i % ENG_CARDS.length]!, due, { noteId: 'note-pitch' }))
  }

  // ---- 집중: 기준일 5세트 2시간 10분 ----
  const sess = (i: number, subjectId: string, start: string, min: number): FocusSession => {
    const s = atTime(A, start).getTime()
    return { id: `focus-seed-${i}`, subjectId, plannedMs: min * MIN, startedAt: s, endedAt: s + min * MIN, completed: true, createdAt: now }
  }
  const sessions: FocusSession[] = [
    sess(0, 'phys', '06:50', 25),
    sess(1, 'eng', '07:20', 25),
    sess(2, 'phys', '10:30', 25),
    sess(3, 'math', '11:05', 25),
    sess(4, 'phys', '19:00', 30),
  ]

  // ---- 일별 기록: 지난 7주. 이번 주(어제까지) + 오늘 = 11시간 40분, 지난주 같은 구간 대비 +18% ----
  const stats: DailyStat[] = []
  const weekStart = startOfWeek(anchor).getTime()
  const spanDays = Math.round((A - weekStart) / DAY) // 이번 주 오늘 이전 일수
  const TODAY_MIN = 130
  const THIS_WEEK = 700
  const restThis = Math.max(0, THIS_WEEK - TODAY_MIN)
  const lastSpanTotal = Math.round(THIS_WEEK / 1.18)
  const topOf = () => (['phys', 'math', 'phys', 'eng', 'chem', 'econ', 'phys'] as const)[Math.floor(rand() * 7)] ?? 'phys'
  const distribute = (total: number, n: number): number[] => {
    if (n <= 0) return []
    const w = Array.from({ length: n }, () => 0.7 + rand() * 0.8)
    const sum = w.reduce((a, b) => a + b, 0)
    const out = w.map((x) => Math.round((x / sum) * total))
    const diff = total - out.reduce((a, b) => a + b, 0)
    out[out.length - 1]! += diff
    return out
  }
  const thisWeek = distribute(restThis, spanDays)
  // 지난주 같은 요일 구간(월~기준 요일) 합 = lastSpanTotal, 나머지 요일은 자유
  const lastSpan = distribute(lastSpanTotal, spanDays + 1)
  for (let back = 48; back >= 1; back--) {
    const day = A - back * DAY
    const dayIdx = Math.round((day - weekStart) / DAY) // 이번 주 월=0
    let focusMin: number
    if (dayIdx >= 0) {
      focusMin = thisWeek[dayIdx] ?? 0
    } else if (dayIdx >= -7 && dayIdx - -7 <= spanDays) {
      focusMin = lastSpan[dayIdx + 7] ?? 0
    } else {
      const wdx = new Date(day).getDay()
      const weekend = wdx === 0 || wdx === 6
      focusMin = Math.round((weekend ? 30 : 70) + rand() * (weekend ? 90 : 140))
    }
    stats.push({ day: dayKey(day), focusMin, reviews: Math.round(focusMin / 9), topSubjectId: focusMin ? topOf() : null })
  }

  const termStart = addDays(startOfWeek(anchor), -42).getTime()

  await db.transaction('rw', [db.subjects, db.courseSlots, db.tasks, db.notes, db.cards, db.focusSessions, db.dailyStats, db.meta], async () => {
    await Promise.all([
      db.subjects.clear(), db.courseSlots.clear(), db.tasks.clear(), db.notes.clear(),
      db.cards.clear(), db.focusSessions.clear(), db.dailyStats.clear(), db.meta.clear(),
    ])
    await db.subjects.bulkAdd(subjects)
    await db.courseSlots.bulkAdd(slots)
    await db.tasks.bulkAdd(tasks)
    await db.notes.bulkAdd(notes)
    await db.cards.bulkAdd(cards)
    await db.focusSessions.bulkAdd(sessions)
    await db.dailyStats.bulkAdd(stats)
    await db.meta.bulkPut([
      { key: 'seed', value: { version: SEED_VERSION, at: now } },
      { key: 'anchor', value: A },
      { key: 'profile', value: { name: '도윤', initial: '도' } },
      { key: 'term', value: { label: '2학기', start: termStart } },
      { key: 'goalMin', value: 240 },
      { key: 'retention', value: 0.91 },
    ])
  })
}
