/**
 * 첫 실행 샘플 시드 (team/design-v2.md 4-1 '샘플 데이터'): 2학기 7주차, 사용자 '도윤'.
 * 기준일(anchor) = 시드를 넣는 날. 시간표·시험·집중 기록은 모두 이 날을 기준으로 놓는다.
 * 설정 > 개발용 '시각 고정'은 이 기준일의 특정 시각으로 시계를 옮긴다.
 */
import type Dexie from 'dexie'
import { db, type Card, type CourseSlot, type DailyStat, type FocusSession, type Memo, type Note, type NoteBody, type NoteLink, type Subject, type Task } from './schema'
import { addDays, atTime, dayKey, startOfDay, startOfWeek, MIN, HOUR, DAY } from '@/lib/time'

export const SEED_VERSION = 2

const SUBJECTS: Array<Omit<Subject, 'createdAt' | 'updatedAt'>> = [
  { id: 'seed-phys', name: '일반물리', short: '물리', color: 'phys', aliases: ['일반물리', '열역학', '물리', '역학', 'physics', 'phys'], order: 0 },
  { id: 'seed-math', name: '공업수학', short: '공수', color: 'math', aliases: ['공업수학', '공수', '수학', '라플라스', 'math'], order: 1 },
  { id: 'seed-chem', name: '일반화학', short: '화학', color: 'chem', aliases: ['일반화학', '화학', '화실', 'chem'], order: 2 },
  { id: 'seed-econ', name: '경제학원론', short: '경제', color: 'econ', aliases: ['경제학원론', '경제학', '경제', '경원', 'econ'], order: 3 },
  { id: 'seed-writing', name: '글쓰기', short: '글쓰기', color: 'writing', aliases: ['글쓰기', '작문', '국어', 'writing'], order: 4 },
  { id: 'seed-eng', name: '영어', short: '영어', color: 'eng', aliases: ['영어', '영작', '토익', 'english', 'eng'], order: 5 },
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

/** (M2부터 첫 실행은 온보딩이 맡는다 — 자동 시드 안 함) 이미 있으면 아무것도 하지 않는다. */
export async function ensureSeed(): Promise<void> {
  if (await isSeeded()) return
  await seedSample()
}

/** 샘플을 넣는다(이전 샘플 행만 바꾸고 사용자 데이터는 그대로). 첫 실행 '샘플로 시작' · 설정 > 개발용 */
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
    [wd, 'seed-phys', '09:00', '10:15', '공학관 302'],
    [wd, 'seed-math', '13:00', '14:15', '공학관 412'],
    [wd, 'seed-chem', '15:00', '17:00', '실험동 1층', 'lab'],
    [ordered[0] ?? 1, 'seed-econ', '09:00', '10:15', '사회관 105'],
    [ordered[0] ?? 1, 'seed-writing', '11:00', '12:15', '인문관 210'],
    [ordered[1] ?? 2, 'seed-phys', '10:30', '11:45', '공학관 302'],
    [ordered[1] ?? 2, 'seed-eng', '14:00', '15:15', '어학관 403'],
    [ordered[2] ?? 3, 'seed-math', '10:30', '11:45', '공학관 412'],
    [ordered[2] ?? 3, 'seed-econ', '15:00', '16:15', '사회관 105'],
  ]
  const slots: CourseSlot[] = slotDefs.map(([weekday, subjectId, start, end, room, kind], i) => ({
    id: `seed-slot-${i}`,
    subjectId,
    weekday,
    start,
    end,
    room,
    kind: kind ?? 'lecture',
    ...stamp,
  }))

  // ---- 시험 · 마감 ----
  const midterm: Task = { id: 'seed-task-midterm', subjectId: 'seed-phys', kind: 'exam', title: '일반물리 중간고사', dueAt: atTime(addDays(A, 6), '10:00').getTime(), done: 0, ...stamp }
  const tasks: Task[] = [
    midterm,
    { id: 'seed-task-hw3', subjectId: 'seed-math', kind: 'assignment', title: '공업수학 과제 3', dueAt: atTime(addDays(A, 1), '23:59').getTime(), done: 0, ...stamp },
    { id: 'seed-task-quiz', subjectId: 'seed-econ', kind: 'quiz', title: '경제학원론 퀴즈', dueAt: atTime(addDays(A, 9), '10:30').getTime(), done: 0, ...stamp },
  ]

  // ---- 노트 (메타) ----
  const lastMonday = (() => {
    const back = ((wd + 6) % 7) || 7
    return addDays(A, -back).getTime() + 20 * HOUR
  })()
  const notes: Note[] = [
    { id: 'seed-note-entropy', title: '엔트로피와 열역학 제2법칙', subjectId: 'seed-phys', kind: 'ink', pages: 4, page: 4, excerpt: 'ΔS ≥ Q/T', createdAt: A - 6 * DAY, updatedAt: now - 2 * MIN },
    { id: 'seed-note-carnot', title: '카르노 기관과 효율', subjectId: 'seed-phys', kind: 'doc', createdAt: A - 8 * DAY, updatedAt: A - DAY + 21 * HOUR },
    { id: 'seed-note-laplace', title: '라플라스 변환 정리', subjectId: 'seed-math', kind: 'doc', createdAt: A - 9 * DAY, updatedAt: A - DAY + 22 * HOUR },
    { id: 'seed-note-equil', title: '화학 평형과 르샤틀리에', subjectId: 'seed-chem', kind: 'pdf', page: 12, pages: 40, createdAt: A - 12 * DAY, updatedAt: lastMonday },
    { id: 'seed-note-pitch', title: '발표 표현 50선', subjectId: 'seed-eng', kind: 'deck', createdAt: A - 20 * DAY, updatedAt: A + 7 * HOUR },
    { id: 'seed-note-ode', title: '미분방정식 연습 2주차', subjectId: 'seed-math', kind: 'ink', pages: 6, createdAt: A - 14 * DAY, updatedAt: A - 3 * DAY + 19 * HOUR },
    { id: 'seed-note-elastic', title: '수요와 공급의 탄력성', subjectId: 'seed-econ', kind: 'doc', createdAt: A - 10 * DAY, updatedAt: A - 2 * DAY + 15 * HOUR },
    { id: 'seed-note-essay', title: '논증적 글쓰기 초안', subjectId: 'seed-writing', kind: 'doc', createdAt: A - 5 * DAY, updatedAt: A - 4 * DAY + 23 * HOUR },
  ]

  // ---- 카드: 오늘 13장(물리 6 · 공수 4 · 영어 3), 내일 2장, 시험 범위 42장 중 18장 미학습 ----
  const cards: Card[] = []
  const dueToday = A + 4 * HOUR + 30 * MIN
  const tomorrow = A + DAY + 6 * HOUR
  const mk = (subjectId: string, i: number, pair: [string, string], due: number, extra: Partial<Card> = {}): Card => ({
    id: `seed-card-${subjectId.slice(5)}-${i}`,
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
      cards.push(mk('seed-phys', i, label, due, { examId: midterm.id, noteId: i % 2 ? 'seed-note-carnot' : 'seed-note-entropy' }))
    } else {
      cards.push(mk('seed-phys', i, label, A + (3 + (i % 3)) * DAY, { examId: midterm.id, state: 'new', reps: 0, lapses: 0, lastReview: null, noteId: 'seed-note-entropy' }))
    }
  }
  for (let i = 0; i < 12; i++) {
    const due = i < 4 ? dueToday : i === 4 ? tomorrow : A + (2 + (i % 9)) * DAY
    cards.push(mk('seed-math', i, MATH_CARDS[i % MATH_CARDS.length]!, due, { noteId: 'seed-note-laplace' }))
  }
  for (let i = 0; i < 15; i++) {
    const due = i < 3 ? dueToday : A + (2 + (i % 7)) * DAY
    cards.push(mk('seed-eng', i, ENG_CARDS[i % ENG_CARDS.length]!, due, { noteId: 'seed-note-pitch' }))
  }

  // ---- 집중: 기준일 5세트 2시간 10분 ----
  const sess = (i: number, subjectId: string, start: string, min: number): FocusSession => {
    const s = atTime(A, start).getTime()
    return { id: `seed-focus-${i}`, subjectId, plannedMs: min * MIN, startedAt: s, endedAt: s + min * MIN, completed: true, createdAt: now }
  }
  const sessions: FocusSession[] = [
    sess(0, 'seed-phys', '06:50', 25),
    sess(1, 'seed-eng', '07:20', 25),
    sess(2, 'seed-phys', '10:30', 25),
    sess(3, 'seed-math', '11:05', 25),
    sess(4, 'seed-phys', '19:00', 30),
  ]

  // ---- 일별 기록: 지난 7주. 이번 주(어제까지) + 오늘 = 11시간 40분, 지난주 같은 구간 대비 +18% ----
  const stats: DailyStat[] = []
  const weekStart = startOfWeek(anchor).getTime()
  const spanDays = Math.round((A - weekStart) / DAY) // 이번 주 오늘 이전 일수
  const TODAY_MIN = 130
  const THIS_WEEK = 700
  const restThis = Math.max(0, THIS_WEEK - TODAY_MIN)
  const lastSpanTotal = Math.round(THIS_WEEK / 1.18)
  const topOf = () => (['seed-phys', 'seed-math', 'seed-phys', 'seed-eng', 'seed-chem', 'seed-econ', 'seed-phys'] as const)[Math.floor(rand() * 7)] ?? 'seed-phys'
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

  // ---- 글 노트 12개 더(합계 20) + 본문 + 링크 + 별가루 3 (design-m2 9장 '샘플로 시작') ----
  const DOCS: Array<[string, string, string, string[]]> = [
    ['heat-engine', 'seed-phys', '열기관의 순환 과정', ['카르노 순환은 등온 팽창 → 단열 팽창 → 등온 압축 → 단열 압축.', '[[카르노 기관과 효율]]과 [[엔트로피와 열역학 제2법칙]]을 같이 본다.']],
    ['ideal-gas', 'seed-phys', '이상기체 상태 방정식', ['PV = nRT. 등온·등압·등적 과정의 일을 구분한다.', '[[열기관의 순환 과정]]에서 쓰인다.']],
    ['first-law', 'seed-phys', '열역학 제1법칙', ['ΔU = Q − W. 부호 약속을 헷갈리지 말 것.', '[[이상기체 상태 방정식]]', '[[엔트로피와 열역학 제2법칙]]']],
    ['inverse-laplace', 'seed-math', '라플라스 역변환', ['부분분수로 쪼갠 뒤 표를 본다.', '[[라플라스 변환 정리]]']],
    ['convolution', 'seed-math', '합성곱 정리', ['L{f*g} = F(s)G(s).', '[[라플라스 변환 정리]] · [[라플라스 역변환]]']],
    ['le-chatelier', 'seed-chem', '르샤틀리에 원리 예제', ['압력을 올리면 기체 몰수가 적은 쪽으로.', '[[화학 평형과 르샤틀리에]]']],
    ['acid-base', 'seed-chem', '산·염기 평형', ['Ka · Kb · Kw = Ka × Kb.', '[[르샤틀리에 원리 예제]]']],
    ['market-eq', 'seed-econ', '시장 균형과 잉여', ['소비자 잉여 + 생산자 잉여 = 총잉여.', '[[수요와 공급의 탄력성]]']],
    ['tax-burden', 'seed-econ', '조세의 귀착', ['탄력성이 작은 쪽이 더 많이 부담한다.', '[[수요와 공급의 탄력성]] · [[시장 균형과 잉여]]']],
    ['claim-evidence', 'seed-writing', '주장과 근거', ['주장 → 근거 → 반론 → 재반박.', '[[논증적 글쓰기 초안]]']],
    ['signpost', 'seed-eng', '발표 연결 표현', ['Moving on to … / To sum up, …', '[[발표 표현 50선]]']],
    ['qna', 'seed-eng', '질의응답 표현', ['That is a great question. Let me get back to you on that.', '[[발표 연결 표현]]']],
  ]
  DOCS.forEach(([key, subjectId, title], i) => {
    notes.push({ id: `seed-note-${key}`, title, subjectId, kind: 'doc', createdAt: A - (15 - i) * DAY, updatedAt: A - (12 - i) * DAY + 20 * HOUR })
  })
  const byTitle = new Map(notes.map((n) => [n.title, n.id]))
  const bodies: NoteBody[] = []
  const links: NoteLink[] = []
  DOCS.forEach(([key, , , paras]) => {
    const noteId = `seed-note-${key}`
    const text = paras.map((x) => x.replace(/\[\[|\]\]/g, '')).join('\n')
    bodies.push({ noteId, doc: { type: 'doc', content: paras.map((x) => ({ type: 'paragraph', content: [{ type: 'text', text: x }] })) }, text, version: 1, updatedAt: now })
    let k = 0
    paras.join(' ').replace(/\[\[([^\]]+)\]\]/g, (_m, t: string) => {
      links.push({ id: `seed-link-${key}-${k++}`, from: noteId, to: byTitle.get(t) ?? null, toTitle: t, createdAt: now })
      return ''
    })
  })
  const memos: Memo[] = [
    { id: 'seed-memo-0', text: '물리 엔트로피 예제 3번 다시 풀기', subjectId: 'seed-phys', state: 'inbox', filedTo: null, createdAt: now - 3 * HOUR, updatedAt: now - 3 * HOUR },
    { id: 'seed-memo-1', text: '공수 과제 범위: 6.1–6.4', subjectId: 'seed-math', state: 'inbox', filedTo: null, createdAt: now - 2 * HOUR, updatedAt: now - 2 * HOUR },
    { id: 'seed-memo-2', text: '발표 때 그래프 설명 표현 찾아보기', subjectId: 'seed-eng', state: 'inbox', filedTo: null, createdAt: now - 40 * MIN, updatedAt: now - 40 * MIN },
  ]

  await removeSamples()
  await db.transaction('rw', [db.subjects, db.courseSlots, db.tasks, db.notes, db.cards, db.focusSessions, db.dailyStats, db.meta, db.noteBodies, db.links, db.memos], async () => {
    await db.subjects.bulkPut(subjects)
    await db.courseSlots.bulkPut(slots)
    await db.tasks.bulkPut(tasks)
    await db.notes.bulkPut(notes)
    await db.noteBodies.bulkPut(bodies)
    await db.links.bulkPut(links)
    await db.memos.bulkPut(memos)
    await db.cards.bulkPut(cards)
    await db.focusSessions.bulkPut(sessions)
    await db.dailyStats.bulkPut(stats)
    await db.meta.bulkPut([
      { key: 'seed', value: { version: SEED_VERSION, at: now } },
      { key: 'anchor', value: A },
      { key: 'profile', value: { name: '도윤', initial: '도' } },
      { key: 'term', value: { label: '2학기', start: termStart } },
      { key: 'goalMin', value: 240 },
      { key: 'retention', value: 0.91 },
      { key: 'onboarded', value: true },
    ])
  })
}

/** 샘플 행 표시 = id 접두어 (리더 결정 2: 스키마 그대로) */
export const SEED_PREFIX = 'seed-'

/** 샘플 지우기: 테이블마다 id가 'seed-'로 시작하는 행만. 사용자 데이터는 건드리지 않는다 */
export async function removeSamples(): Promise<number> {
  let n = 0
  await db.transaction('rw', [db.subjects, db.courseSlots, db.tasks, db.notes, db.cards, db.focusSessions, db.dailyStats, db.meta, db.noteBodies, db.links, db.memos, db.assets], async () => {
    for (const t of [db.subjects, db.courseSlots, db.tasks, db.notes, db.cards, db.focusSessions, db.links, db.memos, db.assets] as const) {
      n += await (t as unknown as Dexie.Table<{ id: string }, string>).where('id').startsWith(SEED_PREFIX).delete()
    }
    n += await db.noteBodies.where('noteId').startsWith(SEED_PREFIX).delete()
    // M1 샘플(v1, 접두어 없던 id): 알려진 id만 지운다
    if (((await db.meta.get('seed'))?.value as { version?: number } | undefined)?.version === 1) {
      const V1 = ['phys', 'math', 'chem', 'econ', 'writing', 'eng']
      n += await db.subjects.where('id').anyOf(V1).delete()
      n += await db.courseSlots.where('id').anyOf(Array.from({ length: 9 }, (_, i) => `slot-${i}`)).delete()
      n += await db.tasks.where('id').anyOf(['task-midterm', 'task-hw3', 'task-quiz']).delete()
      n += await db.notes.where('id').anyOf(['note-entropy', 'note-carnot', 'note-laplace', 'note-equil', 'note-pitch', 'note-ode', 'note-elastic', 'note-essay']).delete()
      n += await db.cards.filter((c) => /^card-(phys|math|eng)-\d+$/.test(c.id)).delete()
      n += await db.focusSessions.where('id').startsWith('focus-seed-').delete()
    }
    // 일별 기록은 샘플만 만든다(앱이 쓰는 곳 없음) → 함께 지운다
    if (await db.meta.get('seed')) await db.dailyStats.clear()
    await db.meta.bulkDelete(['seed', 'anchor', 'term', 'retention'])
  })
  return n
}

export async function hasSamples(): Promise<boolean> {
  return !!(await db.meta.get('seed')) || (await db.subjects.where('id').startsWith(SEED_PREFIX).count()) > 0
}
