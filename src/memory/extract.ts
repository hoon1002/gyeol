/**
 * 카드 후보 자동 추출 (M4 · 앱 B) — AI 없이 규칙 8개. 노트를 저장하면 앱 A가 syncCandidates(noteId)를 부른다.
 *
 *   extractCandidates(doc, text, noteId) → { rule, front, back, anchor }[]   (순수 함수, 노드에서 시험)
 *   mergeCandidates(existing, fresh, noteId, now) → { add, remove }          (순수: 받음·버림 anchor는 다시 만들지 않음, 사라진 '새' 후보는 정리)
 *   syncCandidates(noteId) → { added, removed }                                (DB: noteBodies → cardCandidates)
 *
 * 규칙: qa(`질문 :: 답`) · cloze(`{{빈칸}}`) · term(`용어 — 설명`) · bold(굵은 글씨, 앞뒤 문장) · table(2열 표) ·
 *       list(제목 + 목록) · qline(`Q:` / `A:`) · ask(`?`로 끝나는 줄, 다음 줄이 답)
 * anchor = 규칙 + 앞면 정규화 글의 해시(+ 같은 줄 안 순번). 같은 노트를 다시 저장해도 같은 후보는 같은 anchor다.
 */
import type { CardCandidate } from '@/db/schema'

export type Rule = 'qa' | 'cloze' | 'term' | 'bold' | 'table' | 'list' | 'qline' | 'ask'

export interface Extracted {
  rule: Rule
  front: string
  back: string
  anchor: string
}

type PM = { type: string; text?: string; content?: PM[]; marks?: Array<{ type: string }>; attrs?: Record<string, unknown> }

/** 블록 하나: 문단·제목·목록 항목·표 */
interface Block {
  kind: 'p' | 'h' | 'li' | 'table'
  text: string
  /** 굵은 글씨 조각 */
  bold: string[]
  /** 2열 표의 행 [앞, 뒤], 첫 행이 머리면 뺀다 */
  rows?: Array<[string, string]>
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim()

/** 짧고 결정적인 해시 (FNV-1a 32bit → base36) */
export function hashText(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

/* ---------- doc → 블록 ---------- */

function inline(n: PM | undefined, bold: string[]): string {
  if (!n) return ''
  if (n.type === 'text') {
    const t = n.text ?? ''
    if (n.marks?.some((m) => m.type === 'bold' || m.type === 'strong')) bold.push(t)
    return t
  }
  if (n.type === 'hardBreak') return '\n'
  return (n.content ?? []).map((c) => inline(c, bold)).join('')
}

function walk(n: PM, out: Block[]): void {
  const t = n.type
  if (t === 'paragraph' || t === 'heading' || t === 'codeBlock') {
    const bold: string[] = []
    const text = inline(n, bold)
    // 한 문단 안의 줄바꿈(hardBreak)은 줄로 나눈다(Q:/A:, ? 다음 줄 규칙)
    text.split('\n').forEach((line, i) => out.push({ kind: t === 'heading' ? 'h' : 'p', text: line, bold: i === 0 ? bold : [] }))
    return
  }
  if (t === 'listItem' || t === 'taskItem') {
    const bold: string[] = []
    const text = (n.content ?? []).filter((c) => c.type === 'paragraph').map((c) => inline(c, bold)).join(' ')
    out.push({ kind: 'li', text, bold })
    ;(n.content ?? []).filter((c) => c.type !== 'paragraph').forEach((c) => walk(c, out))
    return
  }
  if (t === 'table') {
    const rows: Array<[string, string]> = []
    let header = false
    let cols2 = true
    ;(n.content ?? []).forEach((row, i) => {
      const cells = (row.content ?? []).map((c) => norm(inline(c, [])))
      if ((row.content ?? []).some((c) => c.type === 'tableHeader') && i === 0) header = true
      if (cells.length !== 2) cols2 = false
      else rows.push([cells[0]!, cells[1]!])
    })
    out.push({ kind: 'table', text: '', bold: [], rows: cols2 ? (header ? rows.slice(1) : rows) : [] })
    return
  }
  ;(n.content ?? []).forEach((c) => walk(c, out))
}

/** 평문(마크다운 비슷한 줄) → 블록: '# 제목', '- 항목', '| a | b |', '**굵게**' */
function fromText(text: string): Block[] {
  const out: Block[] = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!
    const line = raw.trim()
    if (/^\|.*\|$/.test(line)) {
      const rows: Array<[string, string]> = []
      let cols2 = true
      let j = i
      for (; j < lines.length && /^\|.*\|$/.test(lines[j]!.trim()); j++) {
        const cells = lines[j]!.trim().slice(1, -1).split('|').map(norm)
        if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue
        if (cells.length !== 2) cols2 = false
        else rows.push([cells[0]!, cells[1]!])
      }
      // 구분선(|---|---|)이 있으면 첫 행은 머리
      const hasSep = lines.slice(i, j).some((l) => /^\|\s*:?-{2,}/.test(l.trim()))
      out.push({ kind: 'table', text: '', bold: [], rows: cols2 ? (hasSep ? rows.slice(1) : rows) : [] })
      i = j - 1
      continue
    }
    const bold = [...line.matchAll(/\*\*([^*]+)\*\*/g)].map((m) => m[1]!)
    const clean = line.replace(/\*\*([^*]+)\*\*/g, '$1')
    if (/^#{1,6}\s/.test(clean)) out.push({ kind: 'h', text: clean.replace(/^#{1,6}\s+/, ''), bold })
    else if (/^([-*•]|\d+[.)])\s+/.test(clean)) out.push({ kind: 'li', text: clean.replace(/^([-*•]|\d+[.)])\s+/, '').replace(/^\[( |x|X)\]\s*/, ''), bold })
    else out.push({ kind: 'p', text: clean, bold })
  }
  return out
}

/* ---------- 규칙 ---------- */

const SENT = /[^.!?。？！\n]*[.!?。？！]?/g

export function extractCandidates(doc: unknown, text: string, noteId: string): Extracted[] {
  void noteId
  const blocks: Block[] = []
  if (doc && typeof doc === 'object' && (doc as PM).type) walk(doc as PM, blocks)
  else blocks.push(...fromText(text ?? ''))
  const out: Extracted[] = []
  const seen = new Set<string>()
  const add = (rule: Rule, front: string, back: string, salt = '') => {
    const f = norm(front)
    // 목록 답은 줄을 지킨다(항목마다 한 줄)
    const b = back.split('\n').map(norm).filter(Boolean).join('\n')
    if (!f || !b || f === b) return
    const anchor = `${rule}:${hashText(f + '|' + salt)}`
    if (seen.has(anchor)) return
    seen.add(anchor)
    out.push({ rule, front: f, back: b, anchor })
  }

  for (let i = 0; i < blocks.length; i++) {
    const bk = blocks[i]!
    const line = norm(bk.text)

    if (bk.kind === 'table') {
      bk.rows?.forEach(([a, b]) => add('table', a, b))
      continue
    }
    // 7. Q: / A:
    const q = line.match(/^(?:Q|질문)\s*(?:[:：](?!:)|\.)\s*(.+)$/i)
    if (q) {
      const nx = blocks[i + 1] ? norm(blocks[i + 1]!.text) : ''
      const a = nx.match(/^(?:A|답)\s*(?:[:：](?!:)|\.)\s*(.+)$/i)
      if (a) {
        add('qline', q[1]!, a[1]!)
        i++
        continue
      }
    }
    if (/^(?:A|답)\s*(?:[:：](?!:)|\.\s)/i.test(line)) continue
    // 1. 질문 :: 답
    if (line.includes('::')) {
      const [f, ...rest] = line.split('::')
      add('qa', f!, rest.join('::'))
      continue
    }
    // 2. {{빈칸}} — 빈칸마다 한 장(다른 빈칸은 드러냄)
    const clozes = [...line.matchAll(/\{\{([^}]+)\}\}/g)]
    if (clozes.length) {
      clozes.forEach((m, k) => {
        let n = -1
        const front = line.replace(/\{\{([^}]+)\}\}/g, (_x, inner: string) => (++n === k ? '[…]' : inner))
        add('cloze', front, m[1]!, String(k))
      })
      continue
    }
    // 3. 용어 — 설명 (긴 줄표·짧은 줄표, 앞뒤 띄어쓰기)
    const term = line.match(/^(.{1,40}?)\s+[—–]\s+(.+)$/)
    if (term && bk.kind !== 'h') {
      add('term', term[1]!, term[2]!)
      continue
    }
    // 6. 제목 + 목록
    if (bk.kind === 'h') {
      const items: string[] = []
      for (let j = i + 1; j < blocks.length && blocks[j]!.kind === 'li'; j++) items.push(norm(blocks[j]!.text))
      if (items.length) {
        add('list', line, items.join('\n'))
        continue
      }
    }
    // 8. ?로 끝나는 줄 → 다음 줄이 답
    if (/[?？]$/.test(line) && blocks[i + 1] && blocks[i + 1]!.kind !== 'h' && blocks[i + 1]!.kind !== 'table') {
      const nx = norm(blocks[i + 1]!.text)
      if (nx && !/[?？]$/.test(nx)) {
        add('ask', line, nx)
        i++
        continue
      }
    }
    // 4. 굵은 글씨: 그 문장에서 굵은 낱말을 가린다(앞뒤 문장 = 그 굵은 글씨가 든 문장)
    if (bk.bold.length) {
      const sents = line.match(SENT)?.map(norm).filter(Boolean) ?? [line]
      bk.bold.map(norm).filter(Boolean).forEach((b, k) => {
        const s = sents.find((x) => x.includes(b)) ?? line
        add('bold', s.replace(b, '[…]'), b, String(k))
      })
    }
  }
  return out
}

/* ---------- 병합 (순수) ---------- */

export function mergeCandidates(existing: CardCandidate[], fresh: Extracted[], noteId: string, now: number, mkId: () => string): { add: CardCandidate[]; remove: string[] } {
  const byAnchor = new Map(existing.map((c) => [c.anchor ?? '', c]))
  const freshAnchors = new Set(fresh.map((f) => f.anchor))
  const add: CardCandidate[] = []
  for (const f of fresh) {
    if (byAnchor.has(f.anchor)) continue // 새·받음·버림 모두: 다시 묻지 않는다
    add.push({ id: mkId(), noteId, rule: f.rule, front: f.front, back: f.back, anchor: f.anchor, status: 'new', cardId: null, createdAt: now, updatedAt: now })
  }
  // 노트에서 사라진 '새' 후보만 정리(받음·버림은 기록으로 남겨 다시 묻지 않게)
  const remove = existing.filter((c) => c.status === 'new' && !freshAnchors.has(c.anchor ?? '')).map((c) => c.id)
  return { add, remove }
}

/* ---------- DB ---------- */

export async function syncCandidates(noteId: string): Promise<{ added: number; removed: number }> {
  const { db, uid } = await import('@/db/schema')
  const body = await db.noteBodies.get(noteId)
  const fresh = extractCandidates(body?.doc ?? null, body?.text ?? '', noteId)
  const existing = await db.cardCandidates.where('noteId').equals(noteId).toArray()
  const { add, remove } = mergeCandidates(existing, fresh, noteId, Date.now(), () => uid('cand-'))
  if (!add.length && !remove.length) return { added: 0, removed: 0 }
  await db.transaction('rw', db.cardCandidates, async () => {
    if (remove.length) await db.cardCandidates.bulkDelete(remove)
    if (add.length) await db.cardCandidates.bulkAdd(add)
  })
  return { added: add.length, removed: remove.length }
}
