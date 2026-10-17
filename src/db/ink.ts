/**
 * 손글씨 저장소 (schema v3: pages · strokes · pageItems · assets). 소유: 손글씨 엔진. 엔진(src/ink)은 이 파일로만 DB에 닿는다.
 *
 *  - 획 1개 = 행 1개. points = Float32Array [x, y, pressure, t] 반복의 ArrayBuffer (x·y = 쪽 좌표 pt, t = 점 시각 − createdAt ms).
 *  - 지우기는 deletedAt(soft), 변형은 points를 다시 쓴다. 되돌리기는 행 스냅숏을 다시 쓴다(updatedAt = 지금).
 *  - 쪽은 지연 로드한다: 키만 먼저 읽고(primaryKeys) bulkGet을 묶음으로 나눠 프레임을 막지 않는다.
 *
 * 백업(src/lib/backup.ts, JSON) 주의: ArrayBuffer는 JSON에서 {}가 된다. strokes.points는
 *   encodeStrokePoints(buf) → base64 문자열, decodeStrokePoints(str) → ArrayBuffer 로 바꿔 넣는다.
 *   행 단위로는 strokeToJSON(row) / strokeFromJSON(obj) (points: { $f32: base64 }), 값 단위로는 isEncodedPoints(v).
 *   해시(canon)도 ArrayBuffer를 바이트로 봐야 왕복 비교가 의미 있다 → pointsHash(buf).
 *
 * 선택 필드(schema 밖, 색인 없음 · JSON에 그대로 실린다 — schema.ts에 올릴지 리더 결정):
 *   Stroke.pen      'ball' | 'fountain'   (tool 'pen'의 촉 종류. 없으면 볼펜)
 *   PageItem.color  테이프 색 · 글 상자 글자 색(없으면 기본)
 *   PageItem.fontSize  글 상자 글자 크기(pt, 없으면 16)
 */
import Dexie, { type Table } from 'dexie'
import { db as appDb, uid, type Asset, type Meta, type Note, type Page, type PageItem, type PageTemplate, type Stroke } from './schema'

export type PenTip = 'ball' | 'fountain'

export interface InkStroke extends Stroke {
  pen?: PenTip | null
}

export interface InkItem extends PageItem {
  color?: string | null
  fontSize?: number | null
}

/** 엔진이 쓰는 표만 (앱 db와 시험용 db가 같은 꼴) */
export type InkDB = Dexie & {
  pages: Table<Page, string>
  strokes: Table<InkStroke, string>
  pageItems: Table<InkItem, string>
  assets: Table<Asset, string>
  notes: Table<Note, string>
  meta: Table<Meta, string>
}

/** 앱 DB('gyeol') */
export const appInkDB = appDb as unknown as InkDB

/** 시험 페이지용 격리 DB (사용자 DB를 건드리지 않는다). 색인은 schema v3와 같다. */
export function openInkLabDB(name = 'gyeol-inklab'): InkDB {
  const d = new Dexie(name)
  d.version(1).stores({
    notes: 'id, subjectId, kind, updatedAt',
    meta: 'key',
    assets: 'id, ownerId, createdAt',
    pages: 'id, noteId, [noteId+index], updatedAt',
    strokes: 'id, pageId, [pageId+layer], updatedAt',
    pageItems: 'id, pageId, updatedAt',
  })
  return d as InkDB
}

/* ---------- 점 버퍼 ---------- */

export const POINT_STRIDE = 4

/** Float32Array → 꼭 맞는 ArrayBuffer (뷰가 큰 버퍼의 일부여도 잘라서) */
export function packPoints(f: Float32Array): ArrayBuffer {
  if (f.byteOffset === 0 && f.byteLength === f.buffer.byteLength) return f.buffer as ArrayBuffer
  return f.slice().buffer as ArrayBuffer
}

export function pointsOf(row: { points: ArrayBuffer }): Float32Array {
  const b = row.points
  if (b instanceof ArrayBuffer) return new Float32Array(b, 0, b.byteLength >> 2)
  // 백업 등에서 TypedArray/DataView로 들어온 경우
  const v = b as unknown as ArrayBufferView
  if (v && ArrayBuffer.isView(v)) return new Float32Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) as ArrayBuffer)
  return new Float32Array(0)
}

const LE = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1

function bytesOfPoints(buf: ArrayBuffer | ArrayBufferView): Uint8Array {
  const u8 = buf instanceof ArrayBuffer ? new Uint8Array(buf) : new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
  if (LE) return u8
  // 큰 끝 기기: 저장 형식은 항상 작은 끝 f32
  const out = new Uint8Array(u8.length)
  for (let i = 0; i + 3 < u8.length; i += 4) {
    out[i] = u8[i + 3]!
    out[i + 1] = u8[i + 2]!
    out[i + 2] = u8[i + 1]!
    out[i + 3] = u8[i]!
  }
  return out
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function toBase64(u8: Uint8Array): string {
  const native = (u8 as unknown as { toBase64?: () => string }).toBase64
  if (typeof native === 'function') return native.call(u8)
  let s = ''
  const CH = 0x8000
  for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, Array.from(u8.subarray(i, i + CH)))
  if (typeof btoa === 'function') return btoa(s)
  // btoa 없는 환경(이론상): 손으로
  let out = ''
  for (let i = 0; i < u8.length; i += 3) {
    const a = u8[i]!, b = u8[i + 1] ?? 0, c = u8[i + 2] ?? 0
    out += B64[a >> 2]! + B64[((a & 3) << 4) | (b >> 4)]! + (i + 1 < u8.length ? B64[((b & 15) << 2) | (c >> 6)]! : '=') + (i + 2 < u8.length ? B64[c & 63]! : '=')
  }
  return out
}

function fromBase64(s: string): Uint8Array {
  const U8 = Uint8Array as unknown as { fromBase64?: (s: string) => Uint8Array }
  if (typeof U8.fromBase64 === 'function') return U8.fromBase64(s)
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** strokes.points(ArrayBuffer) → base64 (작은 끝 Float32). 백업 JSON에 넣는 꼴 */
export function encodeStrokePoints(buf: ArrayBuffer | ArrayBufferView): string {
  return toBase64(bytesOfPoints(buf))
}

/** base64 → strokes.points(ArrayBuffer) */
export function decodeStrokePoints(b64: string): ArrayBuffer {
  const u8 = fromBase64(b64)
  const fixed = LE ? u8 : bytesOfPoints(u8) // 같은 뒤집기로 되돌린다
  return fixed.buffer.slice(fixed.byteOffset, fixed.byteOffset + fixed.byteLength) as ArrayBuffer
}

export interface EncodedPoints {
  $f32: string
}

export function isEncodedPoints(v: unknown): v is EncodedPoints {
  return !!v && typeof v === 'object' && typeof (v as EncodedPoints).$f32 === 'string'
}

export type StrokeJSON = Omit<InkStroke, 'points'> & { points: EncodedPoints }

/** 획 행 → JSON에 안전한 꼴 (points만 base64로) */
export function strokeToJSON(row: InkStroke): StrokeJSON {
  return { ...row, points: { $f32: encodeStrokePoints(row.points) } }
}

/** JSON 꼴 → 획 행 (이미 ArrayBuffer면 그대로) */
export function strokeFromJSON(o: StrokeJSON | InkStroke): InkStroke {
  const p = (o as { points: unknown }).points
  if (isEncodedPoints(p)) return { ...(o as StrokeJSON), points: decodeStrokePoints(p.$f32) } as InkStroke
  return o as InkStroke
}

/** 점 버퍼 내용 해시용 문자열 (백업 왕복 비교: canon()이 ArrayBuffer를 {}로 보지 않게) */
export function pointsHash(buf: ArrayBuffer | ArrayBufferView): string {
  // FNV-1a 32bit ×2 (빠름, 비교용). 보안 해시가 필요하면 base64를 sha256에 넣는다.
  const u8 = bytesOfPoints(buf)
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ u8.length
  for (let i = 0; i < u8.length; i++) {
    h1 = Math.imul(h1 ^ u8[i]!, 0x01000193)
    h2 = Math.imul(h2 ^ u8[u8.length - 1 - i]!, 0x5bd1e995)
  }
  return `f32:${u8.length}:${(h1 >>> 0).toString(16)}${(h2 >>> 0).toString(16)}`
}

/* ---------- 쪽 ---------- */

export const A4: [number, number] = [595, 842]

export function newPageRow(noteId: string, index: number, o: { template?: PageTemplate; w?: number; h?: number; pdf?: Page['pdf']; paper?: string | null } = {}): Page {
  const now = Date.now()
  return {
    id: uid('pg'),
    noteId,
    index,
    template: o.template ?? 'blank',
    w: o.w ?? A4[0],
    h: o.h ?? A4[1],
    pdf: o.pdf ?? null,
    paper: o.paper ?? null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  }
}

/** 살아 있는 쪽을 순서대로 */
export async function listPages(d: InkDB, noteId: string): Promise<Page[]> {
  const rows = await d.pages.where('noteId').equals(noteId).toArray()
  return rows.filter((p) => !p.deletedAt).sort((a, b) => a.index - b.index || (a.id < b.id ? -1 : 1))
}

const ensuring = new WeakMap<InkDB, Map<string, Promise<Page[]>>>()

/**
 * 쪽이 하나도 없으면 첫 쪽을 만든다. 겹쳐 불려도(StrictMode 두 번 마운트 · 엔진 둘 · createNote와 동시) 하나만 생긴다:
 * 같은 noteId의 진행 중인 약속을 나눠 쓰고, rw 트랜잭션 안에서 다시 확인한다(IndexedDB가 같은 표의 rw를 차례로 돌린다).
 */
export function ensurePages(d: InkDB, noteId: string, init: { template?: PageTemplate; w?: number; h?: number } = {}): Promise<Page[]> {
  let per = ensuring.get(d)
  if (!per) ensuring.set(d, (per = new Map()))
  const hit = per.get(noteId)
  if (hit) return hit
  const p = d
    .transaction('rw', d.pages, async () => {
      const rows = (await d.pages.where('noteId').equals(noteId).toArray()).filter((x) => !x.deletedAt)
      if (rows.length) return rows.sort((a, b) => a.index - b.index || (a.id < b.id ? -1 : 1))
      const first = newPageRow(noteId, 0, init)
      await d.pages.put(first)
      return [first]
    })
    .finally(() => per!.delete(noteId))
  per.set(noteId, p)
  return p
}

/* ---------- 획 · 물건 읽기 ---------- */

export async function strokeKeysOf(d: InkDB, pageId: string): Promise<string[]> {
  return (await d.strokes.where('pageId').equals(pageId).primaryKeys()) as string[]
}

/** 획을 묶음으로 읽는다(한 번에 큰 구조 복제를 하지 않게). 지운 것은 뺀다. */
export async function loadStrokes(d: InkDB, pageId: string, onBatch?: (rows: InkStroke[]) => void, batch = 160): Promise<InkStroke[]> {
  const keys = await strokeKeysOf(d, pageId)
  const out: InkStroke[] = []
  for (let i = 0; i < keys.length; i += batch) {
    const rows = (await d.strokes.bulkGet(keys.slice(i, i + batch))).filter((r): r is InkStroke => !!r && !r.deletedAt)
    out.push(...rows)
    onBatch?.(rows)
    if (i + batch < keys.length) await idle()
  }
  return out
}

export async function loadItems(d: InkDB, pageId: string): Promise<InkItem[]> {
  return (await d.pageItems.where('pageId').equals(pageId).toArray()).filter((r) => !r.deletedAt)
}

function idle(): Promise<void> {
  return new Promise((r) => {
    if (typeof requestAnimationFrame === 'function' && typeof document !== 'undefined' && document.visibilityState === 'visible') requestAnimationFrame(() => r())
    else setTimeout(r, 0)
  })
}

/* ---------- 쓰기 ---------- */

export interface InkWrite {
  strokes?: InkStroke[]
  items?: InkItem[]
  pages?: Page[]
}

/** 스냅숏 행들을 한 트랜잭션에 쓴다 (넣기·지우기(soft)·되살리기·변형 모두 put) */
export async function writeRows(d: InkDB, w: InkWrite): Promise<void> {
  const s = w.strokes?.length ? w.strokes : null
  const it = w.items?.length ? w.items : null
  const pg = w.pages?.length ? w.pages : null
  if (!s && !it && !pg) return
  await d.transaction('rw', [d.strokes, d.pageItems, d.pages], async () => {
    if (s) await d.strokes.bulkPut(s)
    if (it) await d.pageItems.bulkPut(it)
    if (pg) await d.pages.bulkPut(pg)
  })
}

/* ---------- 첨부 ---------- */

export async function saveAsset(d: InkDB, blob: Blob, ownerId: string | null): Promise<string> {
  const id = uid('as')
  await d.assets.put({ id, ownerId, mime: blob.type || 'application/octet-stream', blob, createdAt: Date.now() })
  return id
}

export async function getAssetBlob(d: InkDB, id: string): Promise<Blob | null> {
  return (await d.assets.get(id))?.blob ?? null
}

/** 노트 목록 정렬용: 마지막 손댄 시각 · 쪽 수 (notes 표가 있을 때만, 실패해도 조용히) */
export async function touchNote(d: InkDB, noteId: string, patch: Partial<Pick<Note, 'pages' | 'page'>> = {}): Promise<void> {
  try {
    await d.notes.update(noteId, { updatedAt: Date.now(), ...patch })
  } catch {
    /* notes가 없거나 노트가 없음 */
  }
}

/* ---------- 기억하는 값 (meta, design-ink 부록 C) ---------- */

/** meta 읽기 (없거나 실패하면 fallback) */
export async function getInkMeta<T>(d: InkDB, key: string, fallback: T): Promise<T> {
  try {
    const row = await d.meta.get(key)
    return row ? (row.value as T) : fallback
  } catch {
    return fallback
  }
}

export async function setInkMeta(d: InkDB, key: string, value: unknown): Promise<void> {
  try {
    await d.meta.put({ key, value })
  } catch {
    /* 저장소 없음 */
  }
}
