/**
 * 검색 엔진 (패키지 없이, design-m2 5장 · m2-brief 5). 순수 자료구조 — DB를 모른다(src/search/index.ts가 잇는다).
 *
 * 색인: 한글·한자 연속 구간 = 글자 1-gram + 2-gram, 그 밖의 글자·숫자 연속 = 소문자 낱말(앞부분 일치).
 * 질의: 띄어쓰기로 나눈 낱말마다 후보 집합을 교집합 → 원문(소문자)에 그 낱말이 실제로 있는지 확인 → 점수.
 * 초성만 쓴 질의(ㅇㅌㄹㅍ)는 제목 초성을 훑는다(1,000개 제목은 1ms 이하).
 */
import { choseong, isChoseongQuery } from '@/lib/hangul'

export type DocKind = 'note' | 'memo'

export interface SearchInput {
  kind: DocKind
  id: string
  title: string
  body: string
  subjectId: string | null
  updatedAt: number
}

interface Entry extends SearchInput {
  key: string
  /** NFC 원문 · 소문자 (길이가 같을 때만 범위를 쓴다) */
  tn: string
  tl: string
  bn: string
  bl: string
  cho: string
  grams: string[]
  words: string[]
}

export interface Hit {
  kind: DocKind
  id: string
  title: string
  subjectId: string | null
  updatedAt: number
  score: number
  /** 모든 낱말이 제목에 있으면 title */
  field: 'title' | 'body'
  /** 제목 강조 범위(코드포인트) */
  titleRange: [number, number] | null
  /** 본문 일치: 앞뒤 16자 발췌 + 강조 범위(코드포인트) */
  snippet: { text: string; range: [number, number] } | null
}

const KR = 1
const WORD = 2

function cls(cp: number): number {
  if ((cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0x3131 && cp <= 0x318e) || (cp >= 0x1100 && cp <= 0x11ff) || (cp >= 0x4e00 && cp <= 0x9fff)) return KR
  const ch = String.fromCodePoint(cp)
  return /[\p{L}\p{N}]/u.test(ch) ? WORD : 0
}

const ASCII_WORD = /[a-z0-9]/

/** 글자 종류별 연속 구간으로 나눈다 */
function runs(s: string): Array<{ k: number; t: string }> {
  const out: Array<{ k: number; t: string }> = []
  let cur = ''
  let ck = 0
  for (const ch of s) {
    const cp = ch.codePointAt(0)!
    const k = cp < 128 ? (ASCII_WORD.test(ch) ? WORD : 0) : cls(cp)
    if (k !== ck) {
      if (cur && ck) out.push({ k: ck, t: cur })
      cur = ''
      ck = k
    }
    if (k) cur += ch
  }
  if (cur && ck) out.push({ k: ck, t: cur })
  return out
}

function tokenize(s: string, grams: Set<string>, words: Set<string>): void {
  for (const r of runs(s)) {
    if (r.k === WORD) {
      words.add(r.t)
      continue
    }
    const a = Array.from(r.t)
    for (let i = 0; i < a.length; i++) {
      grams.add(a[i]!)
      if (i + 1 < a.length) grams.add(a[i]! + a[i + 1]!)
    }
  }
}

const norm = (s: string) => s.normalize('NFC')

/** UTF-16 위치 → 코드포인트 위치 */
const cpIndex = (s: string, i: number) => Array.from(s.slice(0, i)).length

function intersect(a: Set<string>, b: Set<string>): Set<string> {
  const [small, big] = a.size <= b.size ? [a, b] : [b, a]
  const out = new Set<string>()
  for (const x of small) if (big.has(x)) out.add(x)
  return out
}

export class SearchIndex {
  private docs = new Map<string, Entry>()
  private gram = new Map<string, Set<string>>()
  private word = new Map<string, Set<string>>()

  get size(): number {
    return this.docs.size
  }

  has(kind: DocKind, id: string): boolean {
    return this.docs.has(kind + ':' + id)
  }

  clear(): void {
    this.docs.clear()
    this.gram.clear()
    this.word.clear()
  }

  remove(kind: DocKind, id: string): void {
    const key = kind + ':' + id
    const e = this.docs.get(key)
    if (!e) return
    for (const g of e.grams) {
      const s = this.gram.get(g)
      if (s) {
        s.delete(key)
        if (!s.size) this.gram.delete(g)
      }
    }
    for (const w of e.words) {
      const s = this.word.get(w)
      if (s) {
        s.delete(key)
        if (!s.size) this.word.delete(w)
      }
    }
    this.docs.delete(key)
  }

  upsert(d: SearchInput): void {
    this.remove(d.kind, d.id)
    const key = d.kind + ':' + d.id
    const tn = norm(d.title)
    const bn = norm(d.body)
    const tl = tn.toLowerCase()
    const bl = bn.toLowerCase()
    const g = new Set<string>()
    const w = new Set<string>()
    tokenize(tl, g, w)
    tokenize(bl, g, w)
    const e: Entry = { ...d, key, tn, tl, bn, bl, cho: choseong(tn.replace(/\s/g, '')), grams: [...g], words: [...w] }
    this.docs.set(key, e)
    for (const x of e.grams) {
      let s = this.gram.get(x)
      if (!s) this.gram.set(x, (s = new Set()))
      s.add(key)
    }
    for (const x of e.words) {
      let s = this.word.get(x)
      if (!s) this.word.set(x, (s = new Set()))
      s.add(key)
    }
  }

  /** 낱말 하나의 후보 집합 (null = 거를 수 없음 → 전부 확인) */
  private candidates(term: string, prefixCache: Map<string, Set<string>>): Set<string> | null {
    let acc: Set<string> | null = null
    for (const r of runs(term)) {
      let set: Set<string> | undefined
      if (r.k === WORD) {
        set = prefixCache.get(r.t)
        if (!set) {
          set = new Set()
          const exact = this.word.get(r.t)
          if (exact) exact.forEach((k) => set!.add(k))
          for (const [w, ks] of this.word) if (w.length > r.t.length && w.startsWith(r.t)) ks.forEach((k) => set!.add(k))
          prefixCache.set(r.t, set)
        }
        acc = acc ? intersect(acc, set) : set
      } else {
        const a = Array.from(r.t)
        const keys = a.length === 1 ? [a[0]!] : a.slice(0, -1).map((c, i) => c + a[i + 1]!)
        for (const k of keys) {
          set = this.gram.get(k)
          if (!set) return new Set()
          acc = acc ? intersect(acc, set) : set
        }
      }
      if (acc && !acc.size) return acc
    }
    return acc
  }

  query(q: string, opts: { kinds?: DocKind[]; limit?: number; now?: number } = {}): Hit[] {
    const limit = opts.limit ?? 50
    const now = opts.now ?? Date.now()
    const kinds = opts.kinds
    let qn = norm(q).toLowerCase().trim()
    if (!qn) return []
    // 초성 질의: 제목 초성
    if (isChoseongQuery(qn)) {
      const qq = qn.replace(/\s/g, '')
      const out: Hit[] = []
      for (const e of this.docs.values()) {
        if (kinds && !kinds.includes(e.kind)) continue
        const i = e.cho.indexOf(qq)
        if (i < 0) continue
        out.push(this.hit(e, 30 - Math.min(i, 10) + this.recency(e, now), 'title', null, null))
      }
      return this.sort(out).slice(0, limit)
    }
    // 조합 중인 끝의 낱자(ㅎ · ㅏ)는 뺀다 — '엔트ㄹ'도 '엔트'로 찾는다
    qn = qn.replace(/[ㄱ-ㆎ]+$/u, '').trim()
    if (!qn) return []
    const terms = [...new Set(qn.split(/\s+/).filter(Boolean))]
    const cache = new Map<string, Set<string>>()
    let cand: Set<string> | null = null
    for (const t of terms) {
      const c = this.candidates(t, cache)
      if (c) cand = cand ? intersect(cand, c) : c
      if (cand && !cand.size) return []
    }
    const pool: Iterable<string> = cand ?? this.docs.keys()
    const out: Hit[] = []
    for (const key of pool) {
      const e = this.docs.get(key)
      if (!e || (kinds && !kinds.includes(e.kind))) continue
      let score = 0
      let allTitle = true
      let ok = true
      for (const t of terms) {
        const ti = e.tl.indexOf(t)
        if (ti >= 0) {
          score += (e.tl === t ? 100 : ti === 0 ? 60 : 40) - Math.min(ti, 20) * 0.5
          continue
        }
        allTitle = false
        const bi = e.bl.indexOf(t)
        if (bi < 0) {
          ok = false
          break
        }
        let cnt = 1
        for (let j = e.bl.indexOf(t, bi + t.length); j >= 0 && cnt < 5; j = e.bl.indexOf(t, j + t.length)) cnt++
        score += 10 + cnt * 2
      }
      if (!ok) continue
      score += this.recency(e, now)
      const first = terms[0]!
      const ti = e.tl.indexOf(first)
      const titleRange: [number, number] | null = ti >= 0 && e.tl.length === e.tn.length ? [cpIndex(e.tn, ti), cpIndex(e.tn, ti) + Array.from(first).length] : null
      let snippet: Hit['snippet'] = null
      if (!allTitle) {
        const bt = terms.find((t) => e.tl.indexOf(t) < 0) ?? first
        snippet = this.snip(e, bt)
      }
      out.push(this.hit(e, score, allTitle ? 'title' : 'body', titleRange, snippet))
    }
    return this.sort(out).slice(0, limit)
  }

  private recency(e: Entry, now: number): number {
    return 5 * Math.exp(-Math.max(0, now - e.updatedAt) / (14 * 86_400_000))
  }

  private sort(list: Hit[]): Hit[] {
    return list.sort((a, b) => b.score - a.score || b.updatedAt - a.updatedAt)
  }

  private hit(e: Entry, score: number, field: Hit['field'], titleRange: Hit['titleRange'], snippet: Hit['snippet']): Hit {
    return { kind: e.kind, id: e.id, title: e.title, subjectId: e.subjectId, updatedAt: e.updatedAt, score, field, titleRange, snippet }
  }

  /** 본문에서 낱말 앞뒤 16자 (줄바꿈은 공백) */
  private snip(e: Entry, t: string): Hit['snippet'] {
    const i = e.bl.indexOf(t)
    if (i < 0) return null
    const src = e.bl.length === e.bn.length ? e.bn : e.bl
    const chars = Array.from(src)
    const a = cpIndex(src, i)
    const len = Array.from(t).length
    const s = Math.max(0, a - 16)
    const end = Math.min(chars.length, a + len + 16)
    const text = (s > 0 ? '…' : '') + chars.slice(s, end).join('').replace(/\s+/g, ' ') + (end < chars.length ? '…' : '')
    // 공백 접기로 위치가 바뀌지 않게, 앞부분도 같은 방식으로 센다
    const before = (s > 0 ? '…' : '') + chars.slice(s, a).join('').replace(/\s+/g, ' ')
    const r0 = Array.from(before).length
    return { text, range: [r0, r0 + len] }
  }
}
