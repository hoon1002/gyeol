/**
 * 별가루 나누기 (design-m2 2-2): 노트로 · 할 일로 · 보관 · 되돌리기 · 과목 바꾸기.
 * 하늘: fileDust(id, subjectId, to) — 노트 = 과목 성운으로 흘러감, 할 일 = 반짝 뒤 사라짐, 보관 = 사라짐.
 */
import { db, uid, type Memo } from '@/db/schema'
import { fileMemoToNote } from '@/db/notes'
import { skyFileDust, type FileTo } from './sky'

/** 할 일의 '마감 없음' (Task.dueAt은 필수 숫자라 0으로 둔다 — 마감 목록·D-day는 dueAt ≥ 지금만 본다) */
export const NO_DUE = 0

function firstLine(text: string, n: number): string {
  const line = (text.split('\n').find((l) => l.trim()) ?? '').trim()
  return line.length > n ? line.slice(0, n) : line
}

/** 노트로 (design-m2 2-2): 앱 A의 fileMemoToNote — 오늘 그 과목 수업 노트가 있으면 끝에 문단, 없으면 새 doc 노트(제목 = 첫 줄 앞 40자) */
async function toNote(memo: Memo): Promise<{ id: string; created: boolean }> {
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
    const id = uid('task-')
    await db.transaction('rw', db.tasks, db.memos, async () => {
      await db.tasks.add({ id, subjectId: sid, kind: 'assignment', title: firstLine(memo.text, 80) || '사진 메모', dueAt: NO_DUE, done: 0, createdAt: now, updatedAt: now })
      await db.memos.update(memo.id, { state: 'filed', filedTo: { type: 'task', id }, updatedAt: now })
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
