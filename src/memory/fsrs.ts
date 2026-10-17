/**
 * FSRS 스케줄러 (ts-fsrs 5 · M4 brief 1). 평가 한 번 = 카드의 다음 상태 + reviewLogs 한 행.
 *   rate(card, rating 1–4, now?) → { card, log }   (DB에 쓴다)
 *   nextState(card, rating, now) → 쓰지 않고 계산만 (시험용)
 *   retrievability(card, now) → 0–1 (복습한 적 없는 카드는 null)
 * 목표 기억률 = 설정 retention(기본 0.90). 퍼짐(fuzz)은 켠다(같은 날 몰림 방지).
 */
import { createEmptyCard, fsrs, generatorParameters, State, type Card as FCard, type Grade, type RecordLogItem } from 'ts-fsrs'
import { db, uid, type Card, type CardState, type ReviewLog } from '@/db/schema'
import { targetRetention } from './prefs'

const DAY = 86_400_000
const STATE_OF: CardState[] = ['new', 'learning', 'review', 'relearning']
const STATE_NUM: Record<CardState, State> = { new: State.New, learning: State.Learning, review: State.Review, relearning: State.Relearning }

let cached: { r: number; fuzz: boolean; f: ReturnType<typeof fsrs> } | null = null
/** 목표 기억률별 스케줄러(같으면 재사용) */
export function scheduler(r = targetRetention(), fuzz = true): ReturnType<typeof fsrs> {
  if (!cached || cached.r !== r || cached.fuzz !== fuzz) cached = { r, fuzz, f: fsrs(generatorParameters({ request_retention: r, enable_fuzz: fuzz })) }
  return cached.f
}

/** 앱 카드 → ts-fsrs 카드. FSRS 값이 없는 옛 카드(M0–M3)는 마지막 간격을 안정도로 어림한다 */
export function toFsrs(c: Card, now: Date): FCard {
  if (c.stability == null) {
    const e = createEmptyCard(now)
    if (c.state !== 'new' && c.lastReview) {
      const s = Math.max(0.5, (c.due - c.lastReview) / DAY)
      return { ...e, state: State.Review, stability: s, difficulty: 5, reps: c.reps, lapses: c.lapses, last_review: new Date(c.lastReview), due: new Date(c.due), scheduled_days: Math.round(s), elapsed_days: 0 }
    }
    return e
  }
  return {
    due: new Date(c.due),
    stability: c.stability,
    difficulty: c.difficulty ?? 5,
    elapsed_days: c.elapsedDays ?? 0,
    scheduled_days: c.scheduledDays ?? 0,
    learning_steps: c.learningSteps ?? 0,
    reps: c.reps,
    lapses: c.lapses,
    state: STATE_NUM[c.state],
    last_review: c.lastReview ? new Date(c.lastReview) : undefined,
  }
}

function apply(c: Card, r: RecordLogItem, now: number): Card {
  const f = r.card
  return {
    ...c,
    due: f.due.getTime(),
    stability: f.stability,
    difficulty: f.difficulty,
    elapsedDays: f.elapsed_days,
    scheduledDays: f.scheduled_days,
    learningSteps: f.learning_steps,
    reps: f.reps,
    lapses: f.lapses,
    state: STATE_OF[f.state] ?? 'review',
    lastReview: now,
    updatedAt: now,
  }
}

/** 계산만 (DB 쓰기 없음) */
export function nextState(c: Card, rating: 1 | 2 | 3 | 4, now = Date.now(), r = targetRetention(), fuzz = true): { card: Card; log: ReviewLog } {
  const d = new Date(now)
  const rec = scheduler(r, fuzz).next(toFsrs(c, d), d, rating as Grade)
  const card = apply(c, rec, now)
  const log: ReviewLog = {
    id: uid('rl-'),
    cardId: c.id,
    rating,
    state: STATE_OF[rec.log.state] ?? 'new',
    due: card.due,
    stability: rec.log.stability,
    difficulty: rec.log.difficulty,
    elapsedDays: rec.log.elapsed_days,
    scheduledDays: rec.log.scheduled_days,
    reviewedAt: now,
  }
  return { card, log }
}

/** 평가 한 번: 카드 다음 상태 저장 + reviewLogs 한 행 */
export async function rate(c: Card, rating: 1 | 2 | 3 | 4, now = Date.now(), durationMs?: number): Promise<{ card: Card; log: ReviewLog }> {
  const out = nextState(c, rating, now)
  if (durationMs != null) out.log.durationMs = Math.round(durationMs)
  await db.transaction('rw', db.cards, db.reviewLogs, async () => {
    await db.cards.put(out.card)
    await db.reviewLogs.add(out.log)
  })
  return out
}

/** 지금 기억하고 있을 확률(0–1). 한 번도 복습하지 않은 카드는 null */
export function retrievability(c: Card, now = Date.now()): number | null {
  if (c.state === 'new' && !c.lastReview) return null
  const r = scheduler().get_retrievability(toFsrs(c, new Date(now)), new Date(now), false)
  return Number.isFinite(r) ? Math.max(0, Math.min(1, r)) : null
}
