/**
 * 시험 역산 계획 (M4 · 앱 B, 리더 결정 7: planDay · planRange). 저장하지 않고 늘 계산한다(카드 2,000장 1초 이하).
 *
 *   computePlan(input)      순수 계산 — 시험마다 범위 카드가 시험 전 3회 이상 떠올려지게 공부 날에 고르게 나눈다.
 *                           마지막 날(시험 전날)은 여유로 비우고, 쉬는 요일·쉬는 날은 피하고, 하루 상한을 넘지 않는다.
 *                           FSRS 예정일(card.due)이 창 안이면 그날을 한 번으로 먼저 쓴다.
 *   planRange(from, to)     DB에서 읽어 날마다 { kind, cards, recall, … }
 *   planDay(date)           하루치(오늘 화면 한 줄 · 계획 띠)
 *   examSky()               하늘용 요약: 시험마다 { examId, dday, studyDays, doneDays, cardIds } (모션 · 순간 ④)
 */
import type { Card, Task } from '@/db/schema'

export const REVIEWS_PER_CARD = 3
const DAY_MS = 86_400_000

export type DayKind = 'study' | 'rest' | 'slack' | 'exam' | 'free'

export interface PlanDay {
  day: string
  kind: DayKind
  /** 그날 떠올릴 범위 카드 수(▤) */
  cards: number
  /** 그날 떠올리기 노트 수(✎) */
  recall: number
  cardIds: string[]
  noteIds: string[]
  /** 그날이 시험 날인 시험 id */
  exams: string[]
}

export interface PlanExam {
  id: string
  dueDay: string
  cardIds: string[]
  noteIds: string[]
}

export interface PlanInput {
  /** 계산 시작 날(오늘, 'YYYY-MM-DD') */
  from: string
  to: string
  exams: PlanExam[]
  /** 카드 id → FSRS 예정 날 */
  due: Map<string, string>
  restDays: number[]
  restDates: Set<string>
  maxPerDay: number
}

/* ---------- 날짜 (현지 날 'YYYY-MM-DD') ---------- */

export function keyOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
export function dateOf(k: string): Date {
  const [y, m, d] = k.split('-').map(Number)
  return new Date(y!, (m ?? 1) - 1, d ?? 1)
}
export function addDay(k: string, n: number): string {
  const d = dateOf(k)
  d.setDate(d.getDate() + n)
  return keyOf(d)
}
export function daysBetween(a: string, b: string): number {
  return Math.round((dateOf(b).getTime() - dateOf(a).getTime()) / DAY_MS)
}

/* ---------- 순수 계산 ---------- */

export function computePlan(inp: PlanInput): PlanDay[] {
  const last = inp.exams.reduce((m, e) => (e.dueDay > m ? e.dueDay : m), inp.to)
  const span = Math.max(0, daysBetween(inp.from, last)) + 1
  const keys = Array.from({ length: span }, (_, i) => addDay(inp.from, i))
  const idx = new Map(keys.map((k, i) => [k, i]))
  const isRest = (k: string) => inp.restDays.includes(dateOf(k).getDay()) || inp.restDates.has(k)
  const load = new Array<number>(span).fill(0)
  const cardsOn: Array<Set<string>> = keys.map(() => new Set())
  const notesOn: Array<Set<string>> = keys.map(() => new Set())
  const examOn: string[][] = keys.map(() => [])
  const slack = new Set<number>()

  // 가까운 시험부터(하루 상한을 먼저 쓴다)
  const exams = [...inp.exams].filter((e) => e.dueDay >= inp.from).sort((a, b) => (a.dueDay < b.dueDay ? -1 : 1))
  for (const ex of exams) {
    const ei = idx.get(ex.dueDay)!
    examOn[ei]!.push(ex.id)
    if (ei >= 1) slack.add(ei - 1)
    // 공부 날 = 오늘 … 시험 전전날, 쉬는 날 · 여유 날 · 다른 시험 날 제외
    const win: number[] = []
    for (let i = 0; i < ei - 1; i++) if (!isRest(keys[i]!) && !slack.has(i) && !examOn[i]!.length) win.push(i)
    if (!win.length) continue
    const W = win.length
    const pos = new Map(win.map((d, j) => [d, j]))
    const place = (cid: string, want: number, taken: Set<number>): boolean => {
      // want(창 안 순번)에서 가까운 쪽으로, 상한이 남고 이 카드가 아직 없는 날
      for (let k = 0; k < W; k++) {
        for (const dir of k ? [1, -1] : [1]) {
          const j = want + dir * k
          if (j < 0 || j >= W) continue
          const d = win[j]!
          if (taken.has(d) || load[d]! >= inp.maxPerDay) continue
          taken.add(d)
          cardsOn[d]!.add(cid)
          load[d]!++
          return true
        }
      }
      return false
    }
    ex.cardIds.forEach((cid, i) => {
      const taken = new Set<number>()
      let need = Math.min(REVIEWS_PER_CARD, W)
      // FSRS 예정일이 창 안이면 그날을 먼저(한 번으로 센다)
      const dk = inp.due.get(cid)
      const dd = dk !== undefined ? idx.get(dk < inp.from ? inp.from : dk) : undefined
      if (dd !== undefined && pos.has(dd) && load[dd]! < inp.maxPerDay) {
        taken.add(dd)
        cardsOn[dd]!.add(cid)
        load[dd]!++
        need--
      }
      // 나머지는 창을 고르게 나눈 자리 + 카드마다 엇갈림(황금비)으로 날마다 고르게
      const frac = (i * 0.6180339887) % 1
      for (let r = 0; r < need; r++) {
        const want = Math.min(W - 1, Math.floor(((r + frac) / Math.max(1, need)) * W))
        place(cid, want, taken)
      }
    })
    // 떠올리기: 범위 노트마다 한 번, 창에 고르게
    ex.noteIds.forEach((nid, i) => {
      const d = win[Math.min(W - 1, Math.floor(((i + 0.5) / ex.noteIds.length) * W))]!
      notesOn[d]!.add(nid)
    })
  }

  const out: PlanDay[] = []
  for (let i = 0; i < span; i++) {
    const k = keys[i]!
    if (k > inp.to) break
    const kind: DayKind = examOn[i]!.length ? 'exam' : slack.has(i) ? 'slack' : isRest(k) ? 'rest' : cardsOn[i]!.size || notesOn[i]!.size ? 'study' : 'free'
    out.push({ day: k, kind, cards: cardsOn[i]!.size, recall: notesOn[i]!.size, cardIds: [...cardsOn[i]!], noteIds: [...notesOn[i]!], exams: examOn[i]! })
  }
  return out
}

/* ---------- DB ---------- */

/** 시험 범위 카드: scope.cardIds ∪ 범위 노트의 카드 ∪ 범위 과목의 카드 ∪ examId가 이 시험인 카드(정지 카드 제외) */
export function scopeCards(exam: Task, cards: Card[]): Card[] {
  const sc = exam.scope ?? {}
  const ids = new Set(sc.cardIds ?? [])
  const notes = new Set(sc.noteIds ?? [])
  const subs = new Set(sc.subjectIds ?? [])
  return cards.filter((c) => !c.suspended && (ids.has(c.id) || (c.noteId && notes.has(c.noteId)) || subs.has(c.subjectId) || c.examId === exam.id))
}

const cache = new Map<string, PlanDay[]>()

async function load(from: string, to: string) {
  const [{ db }, { useSettings }] = await Promise.all([import('@/db/schema'), import('@/stores/settings')])
  const st = useSettings.getState()
  const exams = (await db.tasks.where('kind').equals('exam').toArray()).filter((t) => !t.done && keyOf(new Date(t.dueAt)) >= from)
  const cards = exams.length ? await db.cards.toArray() : []
  const fp = [from, to, st.restDays.join(), st.restDates.join(), st.maxPerDay, exams.map((e) => `${e.id}${e.dueAt}${e.updatedAt}`).join(), cards.length, cards.reduce((m, c) => Math.max(m, c.updatedAt), 0)].join('|')
  return { db, exams, cards, st, fp }
}

export async function planRange(from: Date, to: Date): Promise<PlanDay[]> {
  const f = keyOf(from)
  const t = keyOf(to)
  const { exams, cards, st, fp } = await load(f, t)
  const hit = cache.get(fp)
  if (hit) return hit
  const due = new Map(cards.map((c) => [c.id, keyOf(new Date(c.due))]))
  const pe: PlanExam[] = exams.map((e) => {
    const sc = scopeCards(e, cards)
    return { id: e.id, dueDay: keyOf(new Date(e.dueAt)), cardIds: sc.map((c) => c.id), noteIds: [...new Set([...(e.scope?.noteIds ?? []), ...sc.map((c) => c.noteId).filter((x): x is string => !!x)])] }
  })
  const res = computePlan({ from: f, to: t, exams: pe, due, restDays: st.restDays, restDates: new Set(st.restDates), maxPerDay: st.maxPerDay })
  if (cache.size > 24) cache.clear()
  cache.set(fp, res)
  return res
}

export interface PlanToday extends PlanDay {
  /** 가장 가까운 시험(없으면 null) */
  exam: { id: string; title: string; dday: number } | null
  /** 오늘 떠올린 범위 카드 수 */
  done: number
}

export async function planDay(date: Date): Promise<PlanToday> {
  const k = keyOf(date)
  const [d] = await planRange(date, date)
  const { db, exams } = await load(k, k)
  const near = exams.sort((a, b) => a.dueAt - b.dueAt)[0]
  const day = d ?? { day: k, kind: 'free' as const, cards: 0, recall: 0, cardIds: [], noteIds: [], exams: [] }
  let done = 0
  if (day.cardIds.length) {
    const start = dateOf(k).getTime()
    const logs = await db.reviewLogs.where('reviewedAt').between(start, start + DAY_MS).toArray()
    const set = new Set(day.cardIds)
    done = new Set(logs.filter((l) => set.has(l.cardId)).map((l) => l.cardId)).size
  }
  return { ...day, exam: near ? { id: near.id, title: near.title, dday: daysBetween(k, keyOf(new Date(near.dueAt))) } : null, done }
}

/** 하늘용 요약 (모션 · 시험 별자리 순간 ④): 공부 날 수 · 오늘까지 끝낸 날 수 · 범위 카드 id */
export async function examSky(now = new Date()): Promise<Array<{ examId: string; dday: number; studyDays: number; doneDays: number; cardIds: string[]; noteIds: string[] }>> {
  const k = keyOf(now)
  const { db, exams, cards } = await load(k, k)
  const out = []
  for (const e of exams) {
    const sc = scopeCards(e, cards)
    const ids = sc.map((c) => c.id)
    // 범위 노트: scope.noteIds ∪ 범위 카드의 노트, 카드가 많은 순 (하늘이 시험 별자리 선을 이 노트 별 사이에 긋는다)
    const per = new Map<string, number>((e.scope?.noteIds ?? []).map((n) => [n, 0]))
    sc.forEach((c) => c.noteId && per.set(c.noteId, (per.get(c.noteId) ?? 0) + 1))
    const noteIds = [...per.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n)
    const dueK = keyOf(new Date(e.dueAt))
    const startK = keyOf(new Date(e.createdAt))
    const plan = await planRange(dateOf(startK < k ? k : startK), dateOf(addDay(dueK, -1)))
    const set = new Set(ids)
    const logs = await db.reviewLogs.where('reviewedAt').between(dateOf(startK).getTime(), dateOf(k).getTime()).toArray()
    const doneDays = new Set(logs.filter((l) => set.has(l.cardId)).map((l) => keyOf(new Date(l.reviewedAt)))).size
    out.push({ examId: e.id, dday: daysBetween(k, dueK), studyDays: plan.filter((p) => p.kind === 'study').length + doneDays, doneDays, cardIds: ids, noteIds })
  }
  return out
}
