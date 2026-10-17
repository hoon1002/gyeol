/**
 * 검색 색인 하나(앱 전체). 앱 시작 뒤 유휴 시간에 노트(제목 · 본문)와 메모로 만들고,
 * 이후에는 Dexie 훅(notes · noteBodies · memos)으로 바뀐 행만 부분 갱신한다 — 누가 쓰든(편집기 · 별가루 · 가져오기) 따라온다.
 *
 *   scheduleIndexBuild()   루트에서 한 번(⌘K 팔레트가 부른다)
 *   searchAll(q, opts)     동기 질의. 색인이 아직이면 제목만 훑는 대체 결과
 *   useSearchVersion()     색인이 바뀌면 다시 그리기
 *
 * 메모: inbox · archived만 넣는다(filed는 이미 노트·할 일 안에 있다).
 */
import { useSyncExternalStore } from 'react'
import type { CreatingHookContext, DeletingHookContext, UpdatingHookContext } from 'dexie'
import { db, type Memo, type Note } from '@/db/schema'
import { SearchIndex, type DocKind, type Hit, type SearchInput } from './engine'

export type { Hit, DocKind } from './engine'

export const searchIndex = new SearchIndex()

let state: 'idle' | 'scheduled' | 'building' | 'ready' = 'idle'
let buildPromise: Promise<void> | null = null
let version = 0
const listeners = new Set<() => void>()
/** 색인을 만드는 동안 바뀐 행 — 다 만든 뒤 다시 읽는다 */
const dirty = new Set<string>()

function bump() {
  version++
  listeners.forEach((fn) => fn())
}

export function isIndexReady(): boolean {
  return state === 'ready'
}

const memoTitle = (t: string) => {
  const line = (t.split('\n').find((l) => l.trim()) ?? '').trim()
  return line.length > 80 ? line.slice(0, 80) : line
}

function noteInput(n: Note, text: string): SearchInput {
  return { kind: 'note', id: n.id, title: n.title, body: text, subjectId: n.subjectId, updatedAt: n.updatedAt }
}

function memoInput(m: Memo): SearchInput {
  return { kind: 'memo', id: m.id, title: memoTitle(m.text) || '사진 메모', body: m.text, subjectId: m.subjectId ?? null, updatedAt: m.createdAt }
}

const memoSearchable = (m: Memo | undefined): m is Memo => !!m && m.state !== 'filed'

/** 필기 · PDF 노트의 찾을 글 = 글 상자(pageItems kind 'text')의 글 */
async function inkText(noteId: string): Promise<string> {
  const pages = await db.pages.where('noteId').equals(noteId).filter((p) => !p.deletedAt).primaryKeys()
  if (!pages.length) return ''
  const items = await db.pageItems.where('pageId').anyOf(pages).filter((it) => it.kind === 'text' && !it.deletedAt && !!it.text).toArray()
  return items.map((it) => it.text!.trim()).filter(Boolean).join('\n')
}

/* ---------- 부분 갱신 ---------- */

let flushT = 0
function queue(key: string) {
  dirty.add(key)
  if (state !== 'ready') return
  if (!flushT) flushT = window.setTimeout(flush, 30)
}

async function flush() {
  flushT = 0
  if (state !== 'ready' || !dirty.size) return
  const keys = [...dirty]
  dirty.clear()
  try {
    for (const key of keys) {
      const [kind, ...rest] = key.split(':')
      const id = rest.join(':')
      if (kind === 'page') {
        // 필기 글 상자가 바뀜 → 그 쪽의 노트를 다시
        const pg = await db.pages.get(id)
        if (pg && !pg.noteId.startsWith('memo:')) dirty.add('note:' + pg.noteId)
        continue
      }
      if (kind === 'note') {
        const n = await db.notes.get(id)
        if (!n || n.deletedAt) searchIndex.remove('note', id)
        else searchIndex.upsert(noteInput(n, n.kind === 'ink' || n.kind === 'pdf' ? await inkText(id) : ((await db.noteBodies.get(id))?.text ?? '')))
      } else {
        const m = await db.memos.get(id)
        if (memoSearchable(m)) searchIndex.upsert(memoInput(m))
        else searchIndex.remove('memo', id)
      }
    }
  } catch {
    /* 다음 변경 때 다시 */
  }
  if (dirty.size && !flushT) flushT = window.setTimeout(flush, 30)
  bump()
}

let hooked = false
function attachHooks() {
  if (hooked) return
  hooked = true
  const watch = (table: 'notes' | 'noteBodies' | 'memos', keyOf: (pk: string) => string) => {
    const t = db.table<Record<string, unknown>, string>(table)
    t.hook('creating', function (this: CreatingHookContext<Record<string, unknown>, string>, pk, obj) {
      const id = String(pk ?? obj.id ?? obj.noteId)
      this.onsuccess = () => queue(keyOf(id))
    })
    t.hook('updating', function (this: UpdatingHookContext<Record<string, unknown>, string>, _mods, pk) {
      this.onsuccess = () => queue(keyOf(String(pk)))
    })
    t.hook('deleting', function (this: DeletingHookContext<Record<string, unknown>, string>, pk) {
      this.onsuccess = () => queue(keyOf(String(pk)))
    })
  }
  watch('notes', (id) => 'note:' + id)
  watch('noteBodies', (id) => 'note:' + id)
  watch('memos', (id) => 'memo:' + id)
  // 필기 글 상자: 행에 pageId가 있으므로 그 쪽을 줄 세운다(지울 때도 obj에서)
  const items = db.table<Record<string, unknown>, string>('pageItems')
  const byPage = (obj: Record<string, unknown> | undefined) => (obj?.kind === 'text' && obj.pageId ? 'page:' + String(obj.pageId) : null)
  items.hook('creating', function (this: CreatingHookContext<Record<string, unknown>, string>, _pk, obj) {
    const k = byPage(obj)
    if (k) this.onsuccess = () => queue(k)
  })
  items.hook('updating', function (this: UpdatingHookContext<Record<string, unknown>, string>, _mods, _pk, obj) {
    const k = byPage(obj)
    if (k) this.onsuccess = () => queue(k)
  })
  items.hook('deleting', function (this: DeletingHookContext<Record<string, unknown>, string>, _pk, obj) {
    const k = byPage(obj)
    if (k) this.onsuccess = () => queue(k)
  })
}

/* ---------- 처음 만들기 (유휴 시간에 조각으로) ---------- */

type IdleCb = (d: { timeRemaining: () => number; didTimeout: boolean }) => void
const ric: (cb: IdleCb, o?: { timeout: number }) => number =
  typeof window !== 'undefined' && 'requestIdleCallback' in window
    ? (cb, o) => (window as unknown as { requestIdleCallback: (cb: IdleCb, o?: { timeout: number }) => number }).requestIdleCallback(cb, o)
    : (cb) => window.setTimeout(() => cb({ timeRemaining: () => 8, didTimeout: true }), 200)

async function build(): Promise<void> {
  state = 'building'
  dirty.clear()
  try {
    const [notes, bodies, memos, pages, items] = await Promise.all([
      db.notes.toArray(),
      db.noteBodies.toArray(),
      db.memos.toArray(),
      db.pages.toArray(),
      db.pageItems.filter((it) => it.kind === 'text' && !it.deletedAt && !!it.text).toArray(),
    ])
    const text = new Map(bodies.map((b) => [b.noteId, b.text]))
    // 필기 노트: 글 상자 글을 노트별로 모은다
    const noteOfPage = new Map(pages.filter((p) => !p.deletedAt).map((p) => [p.id, p.noteId]))
    const inkTexts = new Map<string, string[]>()
    for (const it of items) {
      const nid = noteOfPage.get(it.pageId)
      if (!nid) continue
      const a = inkTexts.get(nid) ?? []
      a.push(it.text!.trim())
      inkTexts.set(nid, a)
    }
    for (const n of notes) if ((n.kind === 'ink' || n.kind === 'pdf') && inkTexts.has(n.id)) text.set(n.id, inkTexts.get(n.id)!.join('\n'))
    const inputs: SearchInput[] = [
      ...notes.filter((n) => !n.deletedAt).map((n) => noteInput(n, text.get(n.id) ?? '')),
      ...memos.filter(memoSearchable).map(memoInput),
    ]
    searchIndex.clear()
    let i = 0
    await new Promise<void>((resolve) => {
      const step: IdleCb = (d) => {
        const until = performance.now() + Math.max(4, Math.min(12, d.timeRemaining()))
        while (i < inputs.length && (performance.now() < until || d.didTimeout)) {
          searchIndex.upsert(inputs[i++]!)
          if (d.didTimeout && i % 200 === 0) break
        }
        if (i < inputs.length) ric(step, { timeout: 500 })
        else resolve()
      }
      ric(step, { timeout: 500 })
    })
    state = 'ready'
  } catch {
    state = 'ready'
  }
  bump()
  if (dirty.size) void flush()
}

/** 앱 시작 때 한 번: 첫 화면이 뜬 뒤 유휴 시간에 색인을 만든다 */
export function scheduleIndexBuild(delayMs = 1200): void {
  attachHooks()
  if (state !== 'idle') return
  state = 'scheduled'
  window.setTimeout(() => ric(() => void ensureIndex(), { timeout: 3000 }), delayMs)
}

/** 지금 바로 필요할 때(⌘K를 일찍 연 경우) */
export function ensureIndex(): Promise<void> {
  attachHooks()
  if (state === 'ready') return Promise.resolve()
  if (!buildPromise) buildPromise = build()
  return buildPromise
}

/** 모두 다시 만들기 (백업 '바꾸기' 뒤 등) */
export function rebuildIndex(): Promise<void> {
  state = 'idle'
  buildPromise = build()
  return buildPromise
}

/* ---------- 질의 ---------- */

/** 동기 질의. 색인이 아직이면 빈 배열(부른 쪽이 제목 대체 검색을 쓴다) + 색인 만들기 시작 */
export function searchAll(q: string, opts: { kinds?: DocKind[]; limit?: number } = {}): Hit[] {
  if (state !== 'ready') {
    void ensureIndex()
    return []
  }
  return searchIndex.query(q, opts)
}

export function useSearchVersion(): number {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => version,
  )
}

/* ---------- 개발용: 1,000노트 합성 측정 (콘솔 __gyeolSearch.bench()) ---------- */
if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as Record<string, unknown>).__gyeolSearch = {
    index: searchIndex,
    query: (q: string) => searchIndex.query(q),
    bench: (n?: number) => import('./bench').then((m) => m.bench(n)),
  }
}
