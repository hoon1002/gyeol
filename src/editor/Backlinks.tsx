/**
 * 백링크 (design-m2 3-5): 종이 아래 '이 노트를 가리키는 노트 n' + 줄마다 제목 · 링크가 든 문장 한 줄. 5개까지, 넘으면 '모두 n ›', 0개면 숨김.
 * 노트 종류와 무관하게 쓴다(편집기 청크와 필기·PDF 미리보기 둘 다) — TipTap을 import하지 않는다.
 */
import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { db, type Note } from '@/db/schema'

function contextLine(text: string | undefined, title: string): { pre: string; word: string; post: string } | null {
  if (!text) return null
  const line = text.split('\n').find((l) => l.includes(title))
  if (!line) return null
  const i = line.indexOf(title)
  const pre = line.slice(Math.max(0, i - 28), i)
  const post = line.slice(i + title.length, i + title.length + 40)
  return { pre: (i > 28 ? '…' : '') + pre, word: title, post: post + (i + title.length + 40 < line.length ? '…' : '') }
}

export function Backlinks({ noteId, title, onOpen }: { noteId: string; title: string; onOpen: (id: string) => void }) {
  const [all, setAll] = useState(false)
  const rows = useLiveQuery(async () => {
    const ls = await db.links.where('to').equals(noteId).toArray()
    const titleOf = new Map<string, string>()
    ls.forEach((l) => l.from !== noteId && !titleOf.has(l.from) && titleOf.set(l.from, l.toTitle))
    const ids = [...titleOf.keys()]
    const ns = (await db.notes.bulkGet(ids)).filter((n): n is Note => !!n && !n.deletedAt)
    const bodies = await db.noteBodies.bulkGet(ns.map((n) => n.id))
    return ns
      .map((n, i) => ({ note: n, ctx: contextLine(bodies[i]?.text, titleOf.get(n.id) ?? title) }))
      .sort((a, b) => b.note.updatedAt - a.note.updatedAt)
  }, [noteId, title])
  if (!rows || !rows.length) return null
  const shown = all ? rows : rows.slice(0, 5)
  return (
    <section className="np-back-links" aria-label="이 노트를 가리키는 노트">
      <p className="np-bl-meta">이 노트를 가리키는 노트 {rows.length}</p>
      <ul>
        {shown.map(({ note, ctx }) => (
          <li key={note.id}>
            <button type="button" onClick={() => onOpen(note.id)}>
              <span className="np-bl-t">{note.title || '제목 없음'}</span>
              {ctx && (
                <span className="np-bl-c">
                  {ctx.pre}
                  <u>{ctx.word}</u>
                  {ctx.post}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      {!all && rows.length > 5 && (
        <button type="button" className="np-bl-all" onClick={() => setAll(true)}>
          모두 {rows.length} ›
        </button>
      )}
    </section>
  )
}

