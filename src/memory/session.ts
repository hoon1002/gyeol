/**
 * 복습 세션 (design-m4 1장 · 결정 3). 보이는 수는 오늘 몫만: min(오늘 할 카드, 하루 상한 남은 수). 새 카드는 하루 newPerDay까지.
 * 섞기: 같은 과목 연속 3장 이하(interleave). 모드: 섞어서 · 과목 하나 · 시험 범위 · 노트(R 낮은 순 최대 10장 — 흐려진 별).
 * 새 출발: 주 · 학기 경계이면서 상한을 넘는 날이 3일 이상일 때만 보이고, 넘친 카드를 7 · 14 · 28일에 고르게 다시 놓는다.
 */
import { db, type Card } from '@/db/schema'
import { addDays, DAY, HOUR, studyDayRange, studyDayStart } from '@/lib/time'
import { retrievability } from './fsrs'
import { maxPerDay, newPerDay } from './prefs'
import { scopeCards } from './plan'

export type SessionMode =
  | { kind: 'mix' }
  | { kind: 'subject'; subjectId: string }
  | { kind: 'exam'; examId: string }
  /** 흐려진 별: 그 노트 카드 R 낮은 순(기본 10장) */
  | { kind: 'note'; noteId: string; limit?: number }
  /** 카드 몇 장 바로 (별 정보 '이 카드 복습') */
  | { kind: 'cards'; cardIds: string[] }

const live = (c: Card) => !c.suspended
const noteOf = (c: Card) => c.noteId ?? c.source?.noteId ?? null

/** 남은 카드로 같은 과목 maxRun장 이하가 아직 가능한가 (끝에 subj가 run장 이어진 상태에서) */
function feasible(count: Map<string, number>, total: number, subj: string | null, run: number, k: number): boolean {
  for (const [s, c] of count) {
    if (!c) continue
    const others = total - c
    if (c > (s === subj ? Math.max(0, k - run) : k) + k * others) return false
  }
  return true
}

/** 같은 과목이 maxRun장 넘게 이어지지 않게, 원래 순서(급한 것 먼저)는 되도록 지키며 고른다 */
/** st: 세션 동안 이어지는 한도(한 번 늘면 줄이지 않는다 — 3과 4를 오가면 끝에 긴 연속이 남는다) */
export function interleave<T extends { subjectId: string }>(list: T[], maxRun = 3, prefix: string[] = [], st?: { k: number }): T[] {
  const rest = [...list]
  const out: T[] = []
  const count = new Map<string, number>()
  rest.forEach((c) => count.set(c.subjectId, (count.get(c.subjectId) ?? 0) + 1))
  // 이미 본 카드의 끝 과목 · 연속 수에서 이어 간다(↺로 다시 넣을 때)
  let subj: string | null = prefix.length ? prefix[prefix.length - 1]! : null
  let run = 0
  for (let k = prefix.length - 1; k >= 0 && prefix[k] === subj; k--) run++
  // 연속 한도: 가능하면 maxRun(3). ↺로 한 과목이 너무 많아져 3이 불가능할 때만, 가능한 가장 작은 값으로 1씩 늘린다
  let k = Math.max(maxRun, st?.k ?? 0)
  while (k <= rest.length && !feasible(count, rest.length, subj, run, k)) k++
  if (st) st.k = k
  while (rest.length) {
    // 되는 후보 중 남은 수가 가장 많은 과목(같으면 앞선 것) — 다른 과목 카드를 사이 칸으로 아껴 두어, ↺로 다시 넣어도 연속이 길어지지 않게
    let pick = -1
    let loose = -1
    let best = -1
    const tried = new Set<string>()
    for (let i = 0; i < rest.length; i++) {
      const s = rest[i]!.subjectId
      if (tried.has(s)) continue
      tried.add(s)
      const r = s === subj ? run + 1 : 1
      if (r > k) continue
      if (loose < 0) loose = i
      const n = count.get(s)!
      count.set(s, n - 1)
      const fine = feasible(count, rest.length - 1, s, r, k)
      count.set(s, n)
      if (fine && n > best) {
        pick = i
        best = n
      }
    }
    if (pick < 0) pick = loose >= 0 ? loose : 0
    const c = rest.splice(pick, 1)[0]!
    count.set(c.subjectId, count.get(c.subjectId)! - 1)
    run = c.subjectId === subj ? run + 1 : 1
    subj = c.subjectId
    out.push(c)
  }
  return out
}

/** 과목이 고르게 섞이도록 과목별로 돌려 담는다(같은 과목 안 순서는 유지) */
function roundRobin(list: Card[]): Card[] {
  const by = new Map<string, Card[]>()
  list.forEach((c) => (by.get(c.subjectId) ?? by.set(c.subjectId, []).get(c.subjectId)!).push(c))
  const qs = [...by.values()]
  const out: Card[] = []
  for (let k = 0; out.length < list.length; k++) qs.forEach((q) => q[k] && out.push(q[k]!))
  return out
}

export interface Quota {
  /** 오늘 몫(보이는 수) */
  total: number
  due: number
  fresh: number
  minutes: number
  /** 내일 몫(끝 화면 툴팁) */
  tomorrow: number
  /** 오늘 본 학습 단계 카드 중 오늘 안에 곧 다시 볼 수(끝 ✓ 툴팁 '곧 n') */
  soon: number
  /** 오늘 이미 본 카드 수(끝 ✓를 남길지) */
  doneToday: number
  /** 카드가 하나라도 있나(첫 회 그림) */
  anyCards: boolean
}

async function todayDone(now: number): Promise<{ all: number; fresh: number }> {
  const [a, b] = studyDayRange(now)
  const logs = await db.reviewLogs.where('reviewedAt').between(a, b).toArray()
  const cards = new Set<string>()
  const fresh = new Set<string>()
  logs.forEach((l) => {
    cards.add(l.cardId)
    if (l.state === 'new') fresh.add(l.cardId)
  })
  return { all: cards.size, fresh: fresh.size }
}

/** due = 오늘 몫(오늘 아직 안 본 카드 + 오늘 본 학습 단계 카드 중 지금 때가 된 것) · soon = 오늘 본 학습 단계 카드 중 곧 다시 볼 것 */
async function pools(now: number): Promise<{ due: Card[]; fresh: Card[]; soon: Card[] }> {
  const [a, b] = studyDayRange(now)
  const [all, fresh] = await Promise.all([
    db.cards.where('due').below(b).filter((c) => live(c) && c.state !== 'new').toArray(),
    db.cards.where('state').equals('new').filter(live).toArray(),
  ])
  const due: Card[] = []
  const soon: Card[] = []
  for (const c of all) {
    const seen = (c.lastReview ?? 0) >= a
    if (!seen || c.due <= now) due.push(c)
    else soon.push(c)
  }
  due.sort((x, y) => x.due - y.due)
  fresh.sort((x, y) => x.createdAt - y.createdAt)
  return { due, fresh, soon }
}

export async function todayQuota(now = Date.now()): Promise<Quota> {
  const [{ due, fresh, soon }, done] = await Promise.all([pools(now), todayDone(now)])
  const left = Math.max(0, maxPerDay() - done.all)
  const d = Math.min(due.length, left)
  const f = Math.min(fresh.length, Math.max(0, newPerDay() - done.fresh), left - d)
  const [, b] = studyDayRange(now)
  const [tmr, any] = await Promise.all([db.cards.where('due').between(b, b + DAY).filter((c) => live(c) && c.state !== 'new').count(), db.cards.count()])
  return { total: d + f, due: d, fresh: f, minutes: Math.max(1, Math.round((d + f) * 0.5)), tomorrow: Math.min(maxPerDay(), tmr), soon: soon.length, doneToday: done.all, anyCards: any > 0 }
}

const byLowR = (now: number) => (x: Card, y: Card) => (retrievability(x, now) ?? 0) - (retrievability(y, now) ?? 0)

/** 오늘 세션 카드(순서 포함) */
export async function buildSession(mode: SessionMode = { kind: 'mix' }, now = Date.now()): Promise<Card[]> {
  if (mode.kind === 'cards') {
    const got = await db.cards.bulkGet(mode.cardIds)
    return got.filter((c): c is Card => !!c && live(c))
  }
  if (mode.kind === 'note') {
    const all = await db.cards.filter((c) => live(c) && noteOf(c) === mode.noteId && !(c.state === 'new' && !c.lastReview)).toArray()
    return all.sort(byLowR(now)).slice(0, mode.limit ?? 10)
  }
  const q = await todayQuota(now)
  const { due, fresh } = await pools(now)
  if (mode.kind === 'subject') {
    const d = due.filter((c) => c.subjectId === mode.subjectId).slice(0, q.due)
    const f = fresh.filter((c) => c.subjectId === mode.subjectId).slice(0, q.fresh)
    return [...d, ...f]
  }
  if (mode.kind === 'exam') {
    const exam = await db.tasks.get(mode.examId)
    if (exam) {
      // 시험 범위 카드부터(오늘 할 것 · 새 것 중, 기억 낮은 순), 남는 자리는 다른 오늘 카드
      const inExam = new Set(scopeCards(exam, [...due, ...fresh]).map((c) => c.id))
      const scoped = [...due, ...fresh.slice(0, q.fresh)].filter((c) => inExam.has(c.id)).sort(byLowR(now))
      const others = due.filter((c) => !inExam.has(c.id))
      // 오늘 몫을 이미 끝냈으면 범위 카드만 최대 20장
      return q.total ? [...scoped, ...others].slice(0, q.total) : scoped.slice(0, 20)
    }
  }
  const pick = [...roundRobin(due.slice(0, q.due)), ...fresh.slice(0, q.fresh)]
  // 새 카드는 사이사이에(앞에 몰리지 않게) — 그다음 같은 과목 연속 3장 이하
  const mixed: Card[] = []
  const nd = q.due
  const nf = q.fresh
  let i = 0
  let j = 0
  while (i < nd || j < nf) {
    if (j < nf && (i >= nd || (j + 1) / (nf + 1) <= (i + 1) / (nd + 1))) mixed.push(pick[nd + j++]!)
    else mixed.push(pick[i++]!)
  }
  return interleave(mixed)
}

/* ---------- 새 출발 ---------- */

/** 보일 조건(결정 3): 주 경계(월요일)나 학기 시작 주이고, 지금 밀린 카드로 상한을 넘는 날이 3일 이상 */
export async function freshStartVisible(now = Date.now()): Promise<boolean> {
  const sd = studyDayStart(now)
  const term = ((await db.meta.get('term'))?.value as { start?: number } | undefined)?.start
  const termEdge = term != null && Math.abs(sd.getTime() - term) < 7 * DAY
  if (sd.getDay() !== 1 && !termEdge) return false
  const { due } = await pools(now)
  return Math.ceil(due.length / maxPerDay()) >= 3
}

/** 넘친 카드(오늘 몫 밖)를 days일에 고르게 다시 놓는다. 기억 낮은 것이 먼저. 시험 범위 카드는 그대로. 되돌리기를 돌려준다 */
export async function freshStart(days: 7 | 14 | 28, now = Date.now()): Promise<{ moved: number; undo: () => Promise<void> }> {
  const { due } = await pools(now)
  const q = await todayQuota(now)
  const over = due.slice(q.due).filter((c) => !c.examId).sort(byLowR(now))
  const prev = over.map((c) => [c.id, c.due] as const)
  const base = studyDayStart(now)
  const t = Date.now()
  await db.transaction('rw', db.cards, async () => {
    for (let k = 0; k < over.length; k++) {
      const day = addDays(base, 1 + Math.floor((k * days) / over.length)).getTime() + 6 * HOUR
      await db.cards.update(over[k]!.id, { due: day, updatedAt: t })
    }
  })
  return {
    moved: over.length,
    undo: async () => {
      await db.transaction('rw', db.cards, async () => {
        for (const [id, d] of prev) await db.cards.update(id, { due: d, updatedAt: Date.now() })
      })
    },
  }
}
