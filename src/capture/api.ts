/**
 * 1초 메모 공개 API (앱 개발자 B 소유). 다른 팀원은 이 파일에서 내보내는 것만 쓴다.
 *
 *   saveMemo(text, opts?)  → 메모 id | null   ⌘K '메모로 저장'(앱 A)이 부른다. 시트 없이 바로 저장 + 80ms 뒤 하늘 별가루.
 *   openMemo(initial?)     → 미리 마운트한 메모 칸을 같은 틱에 열고 입력창에 포커스(사용자 제스처 안에서 부를 것).
 *   guessSubjectId(text)   → lib/parser 별칭으로 과목 추정(없으면 null).
 *
 * 저장 피드백은 하늘이 한다(토스트 없음, design-m2 0장).
 */
import { db, uid, type Asset, type Memo, type Subject } from '@/db/schema'
import { parseCommand } from '@/lib/parser'
import { skyDust, skyPinDust } from './sky'
import { closeMemoSheet, openMemoSheet } from './open'

export interface SaveMemoOpts {
  /** undefined = 글에서 자동 추정, null = 과목 없음 */
  subjectId?: string | null
  /** 사진 메모 (카메라·파일·붙여넣기) → assets */
  photo?: Blob | null
  /** 음성 메모 (MediaRecorder) → assets, 길이(ms)는 asset 행의 durationMs */
  audio?: { blob: Blob; ms: number } | null
  /** 체크리스트 메모: 줄마다 항목(☐ · [ ] 접두 허용) → kind 'check' + items */
  checklist?: boolean
  pinned?: boolean
  /** 하늘 별가루(D1). 기본 true */
  sky?: boolean
}

/** M3 메모 (schema v3 타입: kind · items · pinned · pageId · durationMs — 버전 올림 없음) */
export type MemoX = Memo
export type AssetX = Asset & { durationMs?: number }
export type CheckItem = NonNullable<Memo['items']>[number]

const CHECK_RE = /^\s*(?:☐|\[( |x|X)?\])\s?/

/** 글 줄 → 체크 항목 (☐ · [ ] · [x] 접두는 떼고, 빈 줄은 버린다) */
export function itemsFromText(text: string): CheckItem[] {
  return text
    .split('\n')
    .map((l) => ({ m: l.match(CHECK_RE), l }))
    .filter(({ l }) => l.replace(CHECK_RE, '').trim())
    .map(({ m, l }, i) => ({ id: `i${i}-${Math.random().toString(36).slice(2, 7)}`, text: l.replace(CHECK_RE, '').trim(), done: !!m?.[1] && m[1] !== ' ' }))
}

/** 메모의 체크 항목: items가 있으면 그것, M3 초기에 글('[x] …')로 만든 체크 메모는 읽어서 옮긴다 */
export function memoItems(m: Memo): CheckItem[] | null {
  if (m.items?.length) return m.items
  const legacy = (m as Memo & { checklist?: boolean }).checklist
  if (m.kind === 'check' || legacy) return itemsFromText(m.text)
  return null
}

/** 과목 별칭 목록으로 추정 (이름 · 짧은 이름 · 별칭, 긴 것부터) */
export function guessSubject<S extends Pick<Subject, 'id' | 'name' | 'short' | 'aliases'>>(text: string, subjects: S[]): S | null {
  const t = text.trim()
  if (!t || !subjects.length) return null
  const list = subjects.map((s) => ({ ...s, aliases: s.short ? [...s.aliases, s.short] : s.aliases }))
  const hit = parseCommand(t, list).subject
  return hit ? (subjects.find((s) => s.id === hit.id) ?? null) : null
}

export async function guessSubjectId(text: string): Promise<string | null> {
  try {
    return guessSubject(text, await db.subjects.toArray())?.id ?? null
  } catch {
    return null
  }
}

/** 큰 사진은 긴 변 2048px JPEG로 줄인다(저장 공간 · 백업 크기). 줄일 수 없으면 원본 */
async function shrinkPhoto(blob: Blob): Promise<Blob> {
  if (!/^image\/(jpeg|png|webp|heic|heif)/.test(blob.type) || blob.size < 1_200_000) return blob
  try {
    const bmp = await createImageBitmap(blob)
    const max = 2048
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height))
    if (k >= 1 && blob.size < 3_000_000) {
      bmp.close()
      return blob
    }
    const w = Math.round(bmp.width * k)
    const h = Math.round(bmp.height * k)
    const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h })
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
    if (!ctx) return blob
    ctx.drawImage(bmp, 0, 0, w, h)
    bmp.close()
    const out =
      canvas instanceof HTMLCanvasElement
        ? await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.86))
        : await (canvas as OffscreenCanvas).convertToBlob({ type: 'image/jpeg', quality: 0.86 })
    return out && out.size < blob.size ? out : blob
  } catch {
    return blob
  }
}

/**
 * 메모 하나 저장 (state 'inbox'). 글과 사진이 모두 비면 아무것도 하지 않고 null.
 * 하늘: 부른 때부터 80ms 뒤(그리고 저장이 끝난 뒤) dust({ id, subjectId }).
 */
export async function saveMemo(text: string, opts: SaveMemoOpts = {}): Promise<string | null> {
  const t0 = performance.now()
  const body = text.replace(/\s+$/u, '').replace(/^\s+/u, '')
  const raw = opts.photo ?? null
  const audio = opts.audio ?? null
  if (!body && !raw && !audio) return null
  const id = uid('memo-')
  const subjectId = opts.subjectId === undefined ? await guessSubjectId(body) : opts.subjectId
  const photo = raw ? await shrinkPhoto(raw) : null
  const now = Date.now()
  const assetId = photo || audio ? uid('asset-') : null
  const items = opts.checklist ? itemsFromText(body) : null
  const kind: Memo['kind'] = items?.length ? 'check' : audio ? 'voice' : photo ? 'photo' : 'text'
  // 체크 메모의 text는 항목 글을 줄로 이은 것(검색 색인용)
  const memo: Memo = { id, text: items?.length ? items.map((x) => x.text).join('\n') : body, assetId, subjectId, state: 'inbox', filedTo: null, createdAt: now, updatedAt: now, kind }
  if (items?.length) memo.items = items
  if (audio) memo.durationMs = Math.round(audio.ms)
  if (opts.pinned) memo.pinned = true
  await db.transaction('rw', db.memos, db.assets, async () => {
    if (assetId && audio) await db.assets.add({ id: assetId, ownerId: id, mime: audio.blob.type || 'audio/webm', blob: audio.blob, createdAt: now, durationMs: Math.round(audio.ms) } as AssetX)
    else if (assetId && photo) await db.assets.add({ id: assetId, ownerId: id, mime: photo.type || 'image/jpeg', blob: photo, createdAt: now })
    await db.memos.add(memo)
  })
  if (opts.sky !== false) {
    const wait = Math.max(0, 80 - (performance.now() - t0))
    window.setTimeout(() => {
      skyDust(id, subjectId)
      if (opts.pinned) skyPinDust(id, true)
    }, wait)
  }
  return id
}

/** 메모 칸 열기 (같은 틱에 inert 해제 + focus). initial이 있으면 그 글로 채운다 */
export function openMemo(initial?: string, origin?: Element | null): boolean {
  return openMemoSheet(initial, origin ?? null)
}

export function closeMemo(): void {
  closeMemoSheet()
}
export { openDust } from './store'
