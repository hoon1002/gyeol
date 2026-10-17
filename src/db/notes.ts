/**
 * 노트 쓰기 API (앱 개발자 A 소유, design-m2 3·4·7장). 노트 · 본문 · 링크를 늘 한 트랜잭션으로 쓴다.
 * 검색 색인은 Dexie 훅으로 스스로 따라오므로(src/search) 여기서 부를 것이 없다.
 *
 * 다른 팀원이 쓰는 것:
 *   openOrCreateNote({ title?, subjectId?, template?, classKey?, body?, assetId? }) → { note, created }
 *     classKey가 있으면 그 수업 노트, 없으면 같은 제목 노트를 찾고, 있으면 body·사진을 끝에 붙인다. 없으면 만든다.
 *   fileMemoToNote(memo)  별가루 '노트로'(design-m2 2-2): 오늘 그 과목 수업 노트가 있으면 끝에 문단, 없으면 새 노트(제목 = 첫 줄 앞 40자)
 *   docToMarkdown(doc)    백업 notes/*.md 사본용
 *
 * 링크: 본문의 noteLink 노드(attrs { to, title }) = links 행 하나. 저장할 때 from 기준으로 지우고 다시 넣는다.
 * 없는 제목은 to = null(toTitle만). 그 제목의 노트가 생기거나 이름이 바뀌면 이어 준다.
 */
import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useRef } from 'react'
import { db, uid, type Memo, type Note, type NoteLink, type Subject } from './schema'
import { dayKey, fmtMD, studyDayStart } from '@/lib/time'
import { templateDoc, type PMNode, type TemplateName } from '@/editor/templates'

export type { PMNode } from '@/editor/templates'

const TABLES = [db.notes, db.noteBodies, db.links, db.assets, db.subjects]

/* ---------- 문서 JSON 도우미 (TipTap 없이) ---------- */

const TEXTBLOCKS = new Set(['paragraph', 'heading', 'codeBlock'])

function inlineText(n: PMNode): string {
  if (n.type === 'text') return n.text ?? ''
  if (n.type === 'noteLink') return String(n.attrs?.title ?? '')
  if (n.type === 'hardBreak') return '\n'
  return (n.content ?? []).map(inlineText).join('')
}

/** 검색·발췌용 평문: 블록마다 한 줄 */
export function docToText(doc: unknown): string {
  const lines: string[] = []
  const walk = (n: PMNode) => {
    if (TEXTBLOCKS.has(n.type)) lines.push(inlineText(n))
    else (n.content ?? []).forEach(walk)
  }
  if (doc && typeof doc === 'object') walk(doc as PMNode)
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** 문서 안의 [[링크]] (순서대로, 중복 포함) */
export function extractLinks(doc: unknown): Array<{ to: string | null; title: string }> {
  const out: Array<{ to: string | null; title: string }> = []
  const walk = (n: PMNode) => {
    if (n.type === 'noteLink') {
      const title = String(n.attrs?.title ?? '').trim()
      if (title) out.push({ to: (n.attrs?.to as string | null | undefined) ?? null, title })
    }
    n.content?.forEach(walk)
  }
  if (doc && typeof doc === 'object') walk(doc as PMNode)
  return out
}

/** 목록 발췌: 앞 90자(제목 줄은 뺀다) */
function excerptOf(text: string): string {
  const flat = text.split('\n').map((l) => l.trim()).filter(Boolean).join(' · ')
  return flat.length > 90 ? flat.slice(0, 90) + '…' : flat
}

function mdInline(nodes: PMNode[] | undefined): string {
  return (nodes ?? [])
    .map((n) => {
      if (n.type === 'noteLink') return `[[${String(n.attrs?.title ?? '')}]]`
      if (n.type === 'hardBreak') return '  \n'
      if (n.type !== 'text') return mdInline(n.content)
      let t = n.text ?? ''
      const marks = new Set((n.marks ?? []).map((m) => m.type))
      if (marks.has('code')) return '`' + t + '`'
      if (marks.has('bold')) t = `**${t}**`
      if (marks.has('italic')) t = `*${t}*`
      if (marks.has('strike')) t = `~~${t}~~`
      return t
    })
    .join('')
}

/** 마크다운 사본 (백업 notes/*.md). 그림은 assets/<id> */
export function docToMarkdown(doc: unknown, title?: string): string {
  const blocks: string[] = []
  const block = (n: PMNode, indent = ''): string => {
    switch (n.type) {
      case 'heading':
        return '#'.repeat(Number(n.attrs?.level ?? 1)) + ' ' + mdInline(n.content)
      case 'paragraph':
        return indent + mdInline(n.content)
      case 'codeBlock':
        return '```' + String(n.attrs?.language ?? '') + '\n' + mdInline(n.content) + '\n```'
      case 'horizontalRule':
        return '---'
      case 'blockquote':
        return (n.content ?? []).map((c) => block(c)).join('\n\n').split('\n').map((l) => '> ' + l).join('\n')
      case 'asset':
        return `![사진](assets/${String(n.attrs?.assetId ?? '')})`
      case 'bulletList':
      case 'orderedList':
      case 'taskList': {
        let i = Number(n.attrs?.start ?? 1)
        return (n.content ?? [])
          .map((item) => {
            const mark = n.type === 'orderedList' ? `${i++}. ` : n.type === 'taskList' ? (item.attrs?.checked ? '- [x] ' : '- [ ] ') : '- '
            const [first, ...rest] = item.content ?? []
            const head = indent + mark + (first ? block(first).trimStart() : '')
            const tail = rest.map((c) => block(c, indent + '  ')).filter(Boolean)
            return [head, ...tail].join('\n')
          })
          .join('\n')
      }
      default:
        return (n.content ?? []).map((c) => block(c, indent)).join('\n')
    }
  }
  if (title) blocks.push('# ' + title)
  if (doc && typeof doc === 'object') ((doc as PMNode).content ?? []).forEach((n) => blocks.push(block(n)))
  return blocks.join('\n\n').trim() + '\n'
}

/** 글(줄 = 문단) + 사진 → 블록들 */
function bodyBlocks(body?: string | null, assetId?: string | null): PMNode[] {
  const out: PMNode[] = (body ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => ({ type: 'paragraph', content: [{ type: 'text', text: l }] }))
  if (assetId) out.push({ type: 'asset', attrs: { assetId } })
  return out
}

/* ---------- 날짜 · 수업 키 ---------- */

/** 오늘 수업 노트 키 '과목id|YYYY-MM-DD' (학습일, 새벽 4시 경계) */
export function classKeyFor(subjectId: string, at: Date | number = Date.now()): string {
  return `${subjectId}|${dayKey(studyDayStart(at))}`
}

function dateOfClassKey(key: string): Date | null {
  const m = /\|(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null
}

/* ---------- 새 노트 알림 (하늘 birthStar는 화면이 부른다) ---------- */

type Born = (n: Note) => void
const born = new Set<Born>()
/** 이 모듈로 만든 새 노트 (화면이 birthStar를 부른다). 해제 함수를 돌려준다 */
export function onNoteCreated(fn: Born): () => void {
  born.add(fn)
  return () => born.delete(fn)
}

/* ---------- 찾기 ---------- */

const alive = (n: Note | undefined): n is Note => !!n && !n.deletedAt

export async function findNoteByClassKey(classKey: string): Promise<Note | undefined> {
  return db.notes.where('classKey').equals(classKey).filter((n) => !n.deletedAt).first()
}

/** 같은 제목(앞뒤 공백 무시)의 살아 있는 노트 중 최근 것 */
export async function findNoteByTitle(title: string): Promise<Note | undefined> {
  const t = title.trim()
  if (!t) return undefined
  const list = await db.notes.where('title').equals(t).filter((n) => !n.deletedAt).toArray()
  return list.sort((a, b) => b.updatedAt - a.updatedAt)[0]
}

/* ---------- 링크 ---------- */

/** 이 제목을 가리키던 빈 링크(to = null)를 이 노트로 잇는다 */
async function connectDangling(title: string, id: string): Promise<number> {
  const t = title.trim()
  if (!t) return 0
  return db.links.where('toTitle').equals(t).filter((l) => l.to === null && l.from !== id).modify({ to: id })
}

/**
 * links 다시 계산: from 기준으로 지우고 다시 넣는다. 돌려주는 added = 이번에 새로 이어진 [from, to] (하늘 drawLink용).
 * doc을 안 주면 저장된 본문을 읽는다.
 */
export async function recomputeLinks(noteId: string, doc?: unknown): Promise<Array<[string, string]>> {
  return db.transaction('rw', TABLES, async () => {
    const d = doc ?? (await db.noteBodies.get(noteId))?.doc
    const refs = extractLinks(d)
    const prev = await db.links.where('from').equals(noteId).toArray()
    const prevTo = new Set(prev.map((l) => l.to).filter(Boolean) as string[])
    const prevByTitle = new Map(prev.filter((l) => l.to).map((l) => [l.toTitle, l]))
    const now = Date.now()
    const rows: NoteLink[] = []
    const seen = new Set<string>()
    for (const r of refs) {
      let to: string | null = null
      if (r.to && alive(await db.notes.get(r.to))) to = r.to
      if (!to) {
        const hint = prevByTitle.get(r.title)?.to
        if (hint && alive(await db.notes.get(hint))) to = hint
      }
      if (!to) to = (await findNoteByTitle(r.title))?.id ?? null
      if (to === noteId) continue
      const k = to ?? 't:' + r.title
      if (seen.has(k)) continue
      seen.add(k)
      const old = prev.find((l) => (to ? l.to === to : l.to === null && l.toTitle === r.title))
      rows.push({ id: old?.id ?? uid('link-'), from: noteId, to, toTitle: r.title, createdAt: old?.createdAt ?? now })
    }
    await db.links.where('from').equals(noteId).delete()
    if (rows.length) await db.links.bulkAdd(rows)
    return rows.filter((l) => l.to && !prevTo.has(l.to)).map((l) => [noteId, l.to!] as [string, string])
  })
}

/* ---------- 쓰기 ---------- */

export interface CreateNoteOpts {
  title?: string
  subjectId?: string | null
  template?: TemplateName | null
  classKey?: string | null
  /** 본문 JSON(주면 template·body보다 먼저) */
  doc?: PMNode
  /** 글(줄 = 문단) */
  body?: string | null
  /** 사진 assets id → 그림 블록 */
  assetId?: string | null
  /** true면 onNoteCreated(하늘 birthStar)를 부르지 않는다 — 별가루 '노트로'는 fileDust가 도착 연출(D3 → D6)을 맡는다 */
  quiet?: boolean
}

async function classTitle(subjectId: string | null | undefined, classKey: string | null | undefined): Promise<string> {
  const s = subjectId ? await db.subjects.get(subjectId) : undefined
  const d = (classKey && dateOfClassKey(classKey)) || studyDayStart(Date.now())
  return `${fmtMD(d)}${s ? ' ' + s.short : ''}`
}

/** 새 노트(kind 'doc') + 본문 v1. 같은 제목을 가리키던 빈 링크를 잇는다 */
export async function createNote(opts: CreateNoteOpts = {}): Promise<Note> {
  const note = await db.transaction('rw', TABLES, async () => {
    const now = Date.now()
    const id = uid('note-')
    const template = opts.template ?? null
    let title = (opts.title ?? '').trim()
    if (!title && template === 'class') title = await classTitle(opts.subjectId, opts.classKey)
    const doc: PMNode = opts.doc ? { ...opts.doc } : template ? templateDoc(template) : { type: 'doc', content: bodyBlocks(opts.body, opts.assetId) }
    if (opts.doc || template) {
      const extra = bodyBlocks(opts.body, opts.assetId)
      if (extra.length) doc.content = [...(doc.content ?? []), ...extra]
    }
    const text = docToText(doc)
    const n: Note = {
      id,
      title,
      subjectId: opts.subjectId ?? null,
      kind: 'doc',
      excerpt: excerptOf(text) || undefined,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      classKey: opts.classKey ?? null,
      template,
    }
    await db.notes.add(n)
    await db.noteBodies.put({ noteId: id, doc, text, version: 1, updatedAt: now })
    if (opts.assetId) await db.assets.update(opts.assetId, { ownerId: id })
    if (title) await connectDangling(title, id)
    if (extractLinks(doc).length) await recomputeLinks(id, doc)
    return n
  })
  if (!opts.quiet) setTimeout(() => born.forEach((fn) => fn(note)), 0)
  return note
}

/**
 * 본문 저장 (편집기 자동 저장): noteBodies(doc · text · version+1) + notes.updatedAt·excerpt + links 다시 계산.
 * 돌려주는 added = 새로 이어진 링크 [from, to].
 */
export async function saveBody(noteId: string, doc: unknown): Promise<{ version: number; added: Array<[string, string]> }> {
  return db.transaction('rw', TABLES, async () => {
    const now = Date.now()
    const prev = await db.noteBodies.get(noteId)
    const text = docToText(doc)
    const version = (prev?.version ?? 0) + 1
    await db.noteBodies.put({ noteId, doc, text, version, updatedAt: now })
    await db.notes.update(noteId, { updatedAt: now, excerpt: excerptOf(text) || undefined })
    const added = await recomputeLinks(noteId, doc)
    return { version, added }
  })
}

/** 노트 끝에 글(줄 = 문단)·사진을 붙인다 */
export async function appendToNote(noteId: string, add: { text?: string | null; assetId?: string | null }): Promise<number> {
  return db.transaction('rw', TABLES, async () => {
    const body = await db.noteBodies.get(noteId)
    const doc = (body?.doc as PMNode | undefined) ?? { type: 'doc', content: [] }
    const blocks = bodyBlocks(add.text, add.assetId)
    if (!blocks.length) return body?.version ?? 0
    // 끝의 빈 문단 하나는 덮는다(틀의 빈 칸 뒤에 줄줄이 빈 줄이 남지 않게)
    const content = [...(doc.content ?? [])]
    const last = content[content.length - 1]
    if (last && last.type === 'paragraph' && !(last.content ?? []).length) content.pop()
    const next: PMNode = { ...doc, content: [...content, ...blocks] }
    if (add.assetId) await db.assets.update(add.assetId, { ownerId: noteId })
    return (await saveBody(noteId, next)).version
  })
}

/**
 * 열거나 만들기: classKey가 있으면 그 수업 노트, 없으면 같은 제목 노트를 찾는다.
 * 찾으면 body·사진을 끝에 붙이고, 없으면 만든다(classKey · template 그대로).
 */
export async function openOrCreateNote(opts: CreateNoteOpts = {}): Promise<{ note: Note; created: boolean }> {
  return db.transaction('rw', TABLES, async () => {
    const found = opts.classKey ? await findNoteByClassKey(opts.classKey) : opts.title ? await findNoteByTitle(opts.title) : undefined
    if (found) {
      if (opts.body || opts.assetId) await appendToNote(found.id, { text: opts.body, assetId: opts.assetId })
      return { note: found, created: false }
    }
    return { note: await createNote(opts), created: true }
  })
}

/** 별가루 '노트로' (design-m2 2-2). 메모 상태(filed)는 부른 쪽이 바꾼다 */
export async function fileMemoToNote(memo: Pick<Memo, 'text' | 'subjectId' | 'assetId'>, at: Date | number = Date.now()): Promise<{ id: string; created: boolean }> {
  return db.transaction('rw', TABLES, async () => {
    const sid = memo.subjectId ?? null
    const cls = sid ? await findNoteByClassKey(classKeyFor(sid, at)) : undefined
    if (cls) {
      await appendToNote(cls.id, { text: memo.text, assetId: memo.assetId })
      return { id: cls.id, created: false }
    }
    const lines = memo.text.split('\n')
    const i = lines.findIndex((l) => l.trim())
    const head = i >= 0 ? lines[i]!.trim() : ''
    const title = head.slice(0, 40) || '사진 메모'
    const rest = [head.length > 40 ? head.slice(40) : '', ...(i >= 0 ? lines.slice(i + 1) : [])].join('\n')
    const n = await createNote({ title, subjectId: sid, body: rest, assetId: memo.assetId, quiet: true })
    return { id: n.id, created: true }
  })
}

/** 제목 바꾸기 → 그 제목을 가리키던 빈 링크를 잇는다 */
export async function renameNote(noteId: string, title: string): Promise<void> {
  await db.transaction('rw', TABLES, async () => {
    const t = title.trim()
    await db.notes.update(noteId, { title: t, updatedAt: Date.now() })
    if (t) await connectDangling(t, noteId)
  })
}

export async function setNoteSubject(noteId: string, subjectId: string | null): Promise<void> {
  await db.notes.update(noteId, { subjectId, updatedAt: Date.now() })
}

/** 지우기(soft): deletedAt. 이 노트에서 나간 링크는 지우고, 들어오던 링크는 빈 링크(to = null)로 */
export async function deleteNote(noteId: string): Promise<void> {
  await db.transaction('rw', TABLES, async () => {
    const now = Date.now()
    await db.notes.update(noteId, { deletedAt: now, updatedAt: now })
    await db.links.where('from').equals(noteId).delete()
    await db.links.where('to').equals(noteId).modify({ to: null })
  })
}

/** 같은 템플릿을 지금 노트에 씌운다(문서가 비어 있을 때 '/' 메뉴). 수업 틀이면 빈 제목을 '10.17 물리'로 */
export async function applyTemplateMeta(noteId: string, template: TemplateName): Promise<string | null> {
  return db.transaction('rw', TABLES, async () => {
    const n = await db.notes.get(noteId)
    if (!n) return null
    const patch: Partial<Note> = { template, updatedAt: Date.now() }
    if (template === 'class' && !n.title.trim()) patch.title = await classTitle(n.subjectId, n.classKey)
    await db.notes.update(noteId, patch)
    if (patch.title) await connectDangling(patch.title, noteId)
    return patch.title ?? null
  })
}

/* ---------- 하늘: 노트 별 · 빛줄기 (useSkyStars notes · noteLinks · subjects) ---------- */

export interface NoteStarsSpec {
  notes: Array<{ id: string; subjectId: string; links: number }>
  noteLinks: Array<[string, string]>
}

/** 과목이 없는 노트의 하늘 과목 id (흰빛) */
export const NO_SUBJECT = '_none'

const EMPTY_STARS: NoteStarsSpec = { notes: [], noteLinks: [] }

/**
 * 노트 별 데이터: 살아 있는 노트마다 { id, subjectId, links(연결 수) } + 두 끝이 살아 있는 링크 쌍.
 * 내용이 같으면 같은 배열을 돌려준다(하늘은 바뀔 때만 다시 올린다).
 */
export function useNoteStars(): NoteStarsSpec | undefined {
  const raw = useLiveQuery(async () => {
    const [notes, links] = await Promise.all([db.notes.toArray(), db.links.toArray()])
    return { notes, links }
  }, [])
  const last = useRef<{ key: string; v: NoteStarsSpec }>({ key: '', v: EMPTY_STARS })
  return useMemo(() => {
    if (!raw) return undefined
    const live = new Set(raw.notes.filter((n) => !n.deletedAt).map((n) => n.id))
    const pairs: Array<[string, string]> = []
    const seen = new Set<string>()
    const deg = new Map<string, number>()
    for (const l of raw.links) {
      if (!l.to || l.to === l.from || !live.has(l.from) || !live.has(l.to)) continue
      const k = l.from < l.to ? l.from + '|' + l.to : l.to + '|' + l.from
      if (seen.has(k)) continue
      seen.add(k)
      pairs.push([l.from, l.to])
      deg.set(l.from, (deg.get(l.from) ?? 0) + 1)
      deg.set(l.to, (deg.get(l.to) ?? 0) + 1)
    }
    const notes = raw.notes
      .filter((n) => live.has(n.id))
      .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1))
      .map((n) => ({ id: n.id, subjectId: n.subjectId ?? NO_SUBJECT, links: deg.get(n.id) ?? 0 }))
    const key = notes.map((n) => `${n.id}:${n.subjectId}:${n.links}`).join(',') + '/' + pairs.map((p) => p.join('>')).join(',')
    if (key !== last.current.key) last.current = { key, v: { notes, noteLinks: pairs } }
    return last.current.v
  }, [raw])
}

/** 하늘에 줄 과목색 useSkyStars({ subjects }) — 내용이 같으면 같은 배열 */
export function useSkySubjects(subjects: Subject[]): Array<{ id: string; color: string }> {
  const key = subjects.map((s) => s.id + ':' + s.color).join(',')
  const last = useRef<{ key: string; v: Array<{ id: string; color: string }> }>({ key: '', v: [] })
  if (last.current.key !== key) last.current = { key, v: subjects.map((s) => ({ id: s.id, color: `var(--s-${s.color})` })) }
  return last.current.v
}
