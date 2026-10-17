/**
 * 손글씨 메모 초안 (리더 결정 M3-7): 글 메모 초안과 같은 규칙으로 앱을 새로 열어도 남는다.
 * 초안 = 'memo:<id>' 쪽 중 그 메모 행이 아직 없는 것. 펜으로 ＋를 다시 누르면 획이 있는 가장 최근 초안을 다시 붙인다.
 * 저장하면 메모 행이 생겨 초안이 아니게 되고, 버리기(✕ 길게) · 비우기(획 0으로 닫기)면 쪽을 지운다. 7일 지난 빈 초안은 시작할 때 지운다.
 */
import { db } from '@/db/schema'

const WEEK = 7 * 24 * 60 * 60 * 1000

async function orphanPages() {
  const pages = await db.pages.where('noteId').startsWith('memo:').toArray()
  const ids = [...new Set(pages.map((p) => p.noteId.slice(5)))]
  const have = new Set((await db.memos.bulkGet(ids)).filter(Boolean).map((m) => m!.id))
  return pages.filter((p) => !have.has(p.noteId.slice(5)))
}

/** 획이 있는 가장 최근 초안의 메모 id (없으면 null) */
export async function findInkDraft(): Promise<string | null> {
  const pages = (await orphanPages()).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
  for (const p of pages) {
    if ((await db.strokes.where('pageId').equals(p.id).count()) === 0) continue
    // 같은 메모의 빈 쪽(개발 StrictMode 이중 마운트 잔여)은 지워서 패드가 획 있는 쪽을 열게 한다
    const sib = pages.filter((x) => x.noteId === p.noteId && x.id !== p.id)
    for (const x of sib) if ((await db.strokes.where('pageId').equals(x.id).count()) === 0) await db.pages.delete(x.id)
    return p.noteId.slice(5)
  }
  return null
}

/** 초안 버리기: 그 메모의 쪽 · 획 · 쪽 항목을 지운다 (메모 행이 이미 있으면 건드리지 않는다) */
export async function discardInkDraft(memoId: string): Promise<void> {
  if (await db.memos.get(memoId)) return
  const pages = await db.pages.where('noteId').equals('memo:' + memoId).primaryKeys()
  if (!pages.length) return
  await db.transaction('rw', db.pages, db.strokes, db.pageItems, async () => {
    await db.strokes.where('pageId').anyOf(pages).delete()
    await db.pageItems.where('pageId').anyOf(pages).delete()
    await db.pages.bulkDelete(pages)
  })
}

/** 시작할 때: 7일이 지난 빈 초안 쪽을 지운다 */
export async function sweepInkDrafts(now = Date.now()): Promise<number> {
  let n = 0
  for (const p of await orphanPages()) {
    if (now - (p.updatedAt ?? 0) < WEEK) continue
    if ((await db.strokes.where('pageId').equals(p.id).count()) > 0) continue
    await db.pageItems.where('pageId').equals(p.id).delete()
    await db.pages.delete(p.id)
    n++
  }
  return n
}
