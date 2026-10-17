/**
 * 별가루 나누기 (design-m2 2-2): 노트로 · 할 일로 · 보관 · 되돌리기 · 과목 바꾸기.
 * 하늘: fileDust(id, subjectId, to) — 노트 = 과목 성운으로 흘러감, 할 일 = 반짝 뒤 사라짐, 보관 = 사라짐.
 */
import { db, uid, type Memo } from '@/db/schema'
import { createNote, fileMemoToNote } from '@/db/notes'
import { skyFileDust, type FileTo } from './sky'
import { memoItems } from './api'
import { fmtSec } from './voice'

/** 할 일의 '마감 없음' (Task.dueAt은 필수 숫자라 0으로 둔다 — 마감 목록·D-day는 dueAt ≥ 지금만 본다) */
export const NO_DUE = 0

function firstLine(text: string, n: number): string {
  const line = (text.split('\n').find((l) => l.replace(/^\s*\[( |x|X)\]\s?/, '').trim()) ?? '').replace(/^\s*\[( |x|X)\]\s?/, '').trim()
  return line.length > n ? line.slice(0, n) : line
}

/** 노트로 (design-m2 2-2): 앱 A의 fileMemoToNote — 오늘 그 과목 수업 노트가 있으면 끝에 문단, 없으면 새 doc 노트(제목 = 첫 줄 앞 40자) */
async function toNote(memo: Memo): Promise<{ id: string; created: boolean }> {
  if (memo.kind === 'ink') return inkToNote(memo)
  return fileMemoToNote(memo)
}

export async function fileMemo(memo: Memo, to: FileTo): Promise<void> {
  const now = Date.now()
  const sid = memo.subjectId ?? null
  if (to === 'note') {
    const r = await toNote(memo)
    await db.memos.update(memo.id, { state: 'filed', filedTo: { type: 'note', id: r.id }, updatedAt: now })
    skyFileDust(memo.id, sid, 'note')
  } else if (to === 'task') {
    // 체크 메모 = 체크 안 된 항목마다 과제 1개, 음성 = "음성 메모 0:42" (design-ink 8-3 · 8-4). 마감은 비움
    const items = memoItems(memo)
    const titles = items ? items.filter((x) => !x.done).map((x) => x.text) : [memo.kind === 'voice' ? `음성 메모 ${fmtSec(memo.durationMs ?? 0)}` : firstLine(memo.text, 80) || '사진 메모']
    const ids: string[] = []
    await db.transaction('rw', db.tasks, db.memos, async () => {
      for (const title of titles.length ? titles : [firstLine(memo.text, 80) || '메모']) {
        const id = uid('task-')
        ids.push(id)
        await db.tasks.add({ id, subjectId: sid, kind: 'assignment', title: title.slice(0, 80), dueAt: NO_DUE, done: 0, createdAt: now, updatedAt: now })
      }
      await db.memos.update(memo.id, { state: 'filed', filedTo: { type: 'task', id: ids[0]! }, updatedAt: now })
    })
    skyFileDust(memo.id, null, 'task')
  } else {
    await db.memos.update(memo.id, { state: 'archived', updatedAt: now })
    skyFileDust(memo.id, null, 'archive')
  }
}

/** 보관함에서 되돌리기 → 다시 별가루 */
export async function restoreMemo(id: string): Promise<void> {
  await db.memos.update(id, { state: 'inbox', updatedAt: Date.now() })
}

export async function setMemoSubject(id: string, subjectId: string | null): Promise<void> {
  await db.memos.update(id, { subjectId, updatedAt: Date.now() })
}

/**
 * 손글씨 메모 → 새 필기 노트 (리더 승인 2026-10-17): 앱 A의 createNote({ kind: 'ink', quiet })로 노트를 만들고,
 * 메모 쪽(pages.noteId = 'memo:<id>')을 그 노트의 첫 쪽으로 옮긴다. 획은 pageId에 묶여 있어 그대로 따라간다.
 * 하늘은 글 메모와 같다: quiet로 birthStar를 건너뛰고 fileDust(…, 'note')가 도착 연출(D3 → D6)을 맡는다.
 */
async function inkToNote(memo: Memo): Promise<{ id: string; created: boolean }> {
  const note = await createNote({ kind: 'ink', subjectId: memo.subjectId ?? null, quiet: true })
  const all = await db.pages.where('noteId').equals('memo:' + memo.id).sortBy('index')
  // 획·항목이 있는 쪽만 옮기고 빈 쪽(개발 StrictMode 이중 마운트 잔여)은 지운다. 모두 비었으면 첫 쪽 하나는 옮긴다
  const filled = await Promise.all(all.map(async (p) => (await db.strokes.where('pageId').equals(p.id).count()) + (await db.pageItems.where('pageId').equals(p.id).count()) > 0))
  const pages = all.filter((_, i) => filled[i])
  const keep = pages.length ? pages : all.slice(0, 1)
  // createNote({ kind: 'ink' })가 빈 첫 쪽을 만들어 두면 그 자리는 메모 쪽이 맡는다
  const fresh = (await db.pages.where('noteId').equals(note.id).toArray()).map((p) => p.id)
  const drop = [...all.filter((p) => !keep.includes(p)).map((p) => p.id), ...fresh]
  await db.transaction('rw', db.pages, db.notes, async () => {
    for (const [i, p] of keep.entries()) await db.pages.update(p.id, { noteId: note.id, index: i, updatedAt: Date.now() })
    if (drop.length) await db.pages.bulkDelete(drop)
    await db.notes.update(note.id, { pages: keep.length || 1, page: 1, updatedAt: Date.now() })
  })
  return { id: note.id, created: true }
}
