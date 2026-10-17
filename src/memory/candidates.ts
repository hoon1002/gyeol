/**
 * 후보 → 카드 (앱 A · design-m4 2장). 후보함과 떠올리기가 같이 쓴다.
 *   syncNoteCandidates(noteId) — 노트 저장 뒤: 앱 B의 규칙 추출(extract.ts의 순수 함수)로 cardCandidates를 맞춘다.
 *     앱 B의 syncCandidates와 같은 일을 하되, 규칙 8개가 만든 후보만 정리한다(떠올리기 · 테이프 · 메모 후보는 건드리지 않는다).
 *   acceptCandidates · dismissCandidates · restoreCandidates(되돌리기) · addRecallCandidates
 * 순서(2-1): 헷갈림 테이프 → 테이프 → 떠올리기 → 규칙(노트 최근 저장 순) → 메모
 */
import { db, uid, type Card, type CardCandidate } from '@/db/schema'
import { NO_SUBJECT } from '@/db/notes'
import { extractCandidates, mergeCandidates } from './extract'

export type Cand = CardCandidate & { sort?: number }

/** 규칙 추출이 만드는 후보 이름 (extract.ts Rule) */
export const EXTRACT_RULES = new Set(['qa', 'cloze', 'term', 'bold', 'table', 'list', 'qline', 'ask'])

/** 노트 저장 뒤 후보 맞추기 → 새로 생긴 수 */
export async function syncNoteCandidates(noteId: string): Promise<number> {
  const body = await db.noteBodies.get(noteId)
  const fresh = extractCandidates(body?.doc ?? null, body?.text ?? '', noteId)
  const all = await db.cardCandidates.where('noteId').equals(noteId).toArray()
  const existing = all.filter((c) => EXTRACT_RULES.has(c.rule))
  const { add, remove } = mergeCandidates(existing, fresh, noteId, Date.now(), () => uid('cand-'))
  if (!add.length && !remove.length) return 0
  await db.transaction('rw', db.cardCandidates, async () => {
    if (remove.length) await db.cardCandidates.bulkDelete(remove)
    if (add.length) await db.cardCandidates.bulkAdd(add)
  })
  return add.length
}

/** 정렬 무리: 0 헷갈림 테이프 · 1 테이프 · 2 떠올리기 · 3 규칙 · 4 메모 */
export function candGroup(c: Cand): number {
  if (c.rule === 'tape') return c.sort === 0 ? 0 : 1
  if (c.rule === 'recall') return 2
  if (c.rule === 'memo') return 4
  return 3
}

export function sortCands(list: Cand[], noteUpdated: (noteId: string) => number): Cand[] {
  return [...list].sort((a, b) => candGroup(a) - candGroup(b) || (candGroup(a) === 3 ? noteUpdated(b.noteId) - noteUpdated(a.noteId) : 0) || (a.sort ?? 1) - (b.sort ?? 1) || a.createdAt - b.createdAt)
}

/** 'region:<pageId>:<x0>,<y0>,<x1>,<y1>' (필기 떠올리기에서 고른 영역) */
export function parseRegion(anchor: string | null | undefined): { pageId: string; rect: [number, number, number, number] } | null {
  const m = /^region:([^:]+):([-\d.]+),([-\d.]+),([-\d.]+),([-\d.]+)$/.exec(anchor ?? '')
  return m ? { pageId: m[1]!, rect: [Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])] } : null
}

/** 받기: 후보마다 Card 하나(새 카드, 오늘부터). 고친 글은 edits로. 만든 카드 id를 돌려준다 */
export async function acceptCandidates(list: Cand[], edits: Record<string, { front: string; back: string }> = {}): Promise<string[]> {
  if (!list.length) return []
  const now = Date.now()
  const notes = await db.notes.bulkGet([...new Set(list.map((c) => c.noteId))])
  const subj = new Map(notes.filter((n) => !!n).map((n) => [n!.id, n!.subjectId ?? NO_SUBJECT]))
  const cards: Card[] = []
  for (const c of list) {
    let source: Card['source'] = { kind: c.rule === 'memo' ? 'memo' : 'rule', noteId: c.noteId, rule: c.rule }
    if (c.rule === 'tape' && c.anchor) {
      // 쪽 · 가린 영역은 손글씨 엔진 그림에서 (지연 조각)
      const ink = await import('@/ink')
      const img = await ink.renderTapeRegion(c.anchor, { covered: true, scale: 1 }).catch(() => null)
      source = { kind: 'tape', noteId: c.noteId, pageId: img?.pageId ?? null, rect: img?.rect ?? null, itemId: c.anchor }
    } else {
      const r = parseRegion(c.anchor)
      if (r) source = { kind: 'tape', noteId: c.noteId, rule: 'recall', pageId: r.pageId, rect: r.rect, itemId: null }
    }
    const e = edits[c.id]
    cards.push({
      id: uid('card-'),
      subjectId: subj.get(c.noteId) ?? NO_SUBJECT,
      noteId: c.noteId,
      front: (e?.front ?? c.front).trim(),
      back: (e?.back ?? c.back).trim(),
      due: now,
      state: 'new',
      reps: 0,
      lapses: 0,
      lastReview: null,
      source,
      createdAt: now,
      updatedAt: now,
    })
  }
  await db.transaction('rw', db.cards, db.cardCandidates, async () => {
    await db.cards.bulkAdd(cards)
    for (let k = 0; k < list.length; k++) {
      const e = edits[list[k]!.id]
      await db.cardCandidates.update(list[k]!.id, { status: 'accepted', cardId: cards[k]!.id, updatedAt: now, ...(e ? { front: e.front, back: e.back } : {}) })
    }
  })
  return cards.map((c) => c.id)
}

export async function dismissCandidates(list: Cand[]): Promise<void> {
  const now = Date.now()
  await db.transaction('rw', db.cardCandidates, async () => {
    for (const c of list) await db.cardCandidates.update(c.id, { status: 'dismissed', updatedAt: now })
  })
}

/** 되돌리기(5초): 후보를 '새'로 되돌리고, 받기로 만든 카드는 지운다(아직 복습하지 않은 새 카드뿐) */
export async function restoreCandidates(prev: Cand[], cardIds: string[]): Promise<void> {
  await db.transaction('rw', db.cards, db.cardCandidates, async () => {
    if (cardIds.length) await db.cards.bulkDelete(cardIds)
    await db.cardCandidates.bulkPut(prev.map((c) => ({ ...c, status: 'new' as const, cardId: null })))
  })
}

/** 떠올리기에서 고른 빠진 곳 → 후보(규칙 'recall'). 같은 anchor는 다시 만들지 않는다 → 새로 생긴 수 */
export async function addRecallCandidates(noteId: string, items: Array<{ front: string; back: string; anchor: string }>): Promise<number> {
  const have = new Set((await db.cardCandidates.where('noteId').equals(noteId).toArray()).map((c) => c.anchor ?? ''))
  const now = Date.now()
  const add: Cand[] = items
    .filter((it) => !have.has(it.anchor))
    .map((it, k) => ({ id: uid('cand-'), noteId, rule: 'recall', front: it.front, back: it.back, anchor: it.anchor, status: 'new', cardId: null, createdAt: now + k, updatedAt: now }))
  if (add.length) await db.cardCandidates.bulkAdd(add)
  return add.length
}
