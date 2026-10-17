/**
 * 백업 `.gyeol.zip` (m2-brief 8, design-m2 8장). fflate로 묶는다.
 *   manifest.json  { app, format, schema, exportedAt, counts{표: 행 수}, hashes{표: 내용 해시}, assets }
 *   data.json      { 표 이름: 행[] } — Blob은 { $asset: 'assets/<id>.<확장자>', type } 참조로 빼내고,
 *                  ArrayBuffer·TypedArray(획 points 등)는 { $bin: base64, t: 'Float32Array' }로 넣는다
 *   assets/…       사진 등 원본
 *   notes/*.md     노트 마크다운 사본(noteBodies.text) — 읽기용, 가져오기에는 쓰지 않는다
 * 가져오기: 'merge'(같은 id면 updatedAt(없으면 createdAt)이 큰 쪽, 없는 행은 넣음) · 'replace'(모든 표를 비우고 넣음).
 * 왕복 시험: roundTrip() — 실제 DB는 읽기만 하고, 임시 DB에 '바꾸기'로 넣은 뒤 표마다 개수·해시를 비교한다.
 */
import Dexie, { type Table } from 'dexie'
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate'
import { db } from '@/db/schema'
import { dayKey } from './time'

export type ImportMode = 'merge' | 'replace'

export interface Manifest {
  app: 'gyeol'
  format: 1
  schema: number
  exportedAt: number
  counts: Record<string, number>
  hashes: Record<string, string>
  assets: number
}

export interface ImportResult {
  mode: ImportMode
  counts: Record<string, number>
  /** 합치기에서 새로 들어온 행 수 (표별) */
  added: Record<string, number>
  newNoteIds: string[]
}

type Row = Record<string, unknown>
type AnyDB = Dexie

/* ---------- 바이너리(ArrayBuffer · TypedArray · DataView): JSON에서 사라지지 않게 { $bin: base64, t: 타입 이름 } ---------- */

type Bin = ArrayBuffer | ArrayBufferView

function isBin(v: unknown): v is Bin {
  return v instanceof ArrayBuffer || ArrayBuffer.isView(v)
}

function binBytes(v: Bin): Uint8Array {
  return v instanceof ArrayBuffer ? new Uint8Array(v) : new Uint8Array(v.buffer, v.byteOffset, v.byteLength)
}

function binType(v: Bin): string {
  return v instanceof ArrayBuffer ? 'ArrayBuffer' : v.constructor.name
}

function toB64(u8: Uint8Array): string {
  let out = ''
  for (let i = 0; i < u8.length; i += 0x8000) out += String.fromCharCode(...u8.subarray(i, i + 0x8000))
  return btoa(out)
}

function fromB64(b64: string): Uint8Array {
  const raw = atob(b64)
  const u8 = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) u8[i] = raw.charCodeAt(i)
  return u8
}

const VIEWS: Record<string, new (b: ArrayBuffer) => ArrayBufferView> = {
  Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array, BigInt64Array, BigUint64Array, DataView,
}

/** { $bin, t } → 원래 타입 (복사본 버퍼라 정렬이 맞다) */
function unbin(o: { $bin: string; t?: string }): Bin {
  const u8 = fromB64(o.$bin)
  const buf = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer
  const V = o.t ? VIEWS[o.t] : undefined
  return V ? new V(buf) : buf
}

/* ---------- 해시 (표 내용 = 기본 키 순 정렬 + 키 정렬 JSON, Blob = 바이트 SHA-256) ---------- */

async function sha256(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === 'string' ? strToU8(data) : data
  const buf = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
}

async function canon(v: unknown): Promise<unknown> {
  if (v instanceof Blob) return { $blob: await sha256(new Uint8Array(await v.arrayBuffer())), type: v.type, size: v.size }
  if (isBin(v)) return { $bin: await sha256(binBytes(v)), t: binType(v), size: v.byteLength }
  if (Array.isArray(v)) return Promise.all(v.map(canon))
  if (v && typeof v === 'object') {
    const out: Row = {}
    for (const k of Object.keys(v as Row).sort()) {
      const x = (v as Row)[k]
      if (x !== undefined) out[k] = await canon(x)
    }
    return out
  }
  return v
}

function pkOf(t: Table): (r: Row) => string {
  const kp = t.schema.primKey.keyPath
  return (r) => (Array.isArray(kp) ? kp.map((k) => String(r[k])).join('|') : String(r[kp as string]))
}

export async function tableHashes(d: AnyDB = db): Promise<{ counts: Record<string, number>; hashes: Record<string, string> }> {
  const counts: Record<string, number> = {}
  const hashes: Record<string, string> = {}
  for (const t of d.tables) {
    const rows = (await t.toArray()) as Row[]
    const pk = pkOf(t)
    rows.sort((a, b) => (pk(a) < pk(b) ? -1 : pk(a) > pk(b) ? 1 : 0))
    counts[t.name] = rows.length
    hashes[t.name] = await sha256(JSON.stringify(await canon(rows)))
  }
  return { counts, hashes }
}

/* ---------- 내보내기 ---------- */

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/heic': 'heic', 'application/pdf': 'pdf' }

function safeName(s: string): string {
  return s.replace(/[\\/:*?"<>|#\n\r\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || '노트'
}

export async function exportBackup(d: AnyDB = db): Promise<{ blob: Blob; filename: string; manifest: Manifest }> {
  const files: Zippable = {}
  const data: Record<string, Row[]> = {}
  let assetN = 0
  const pull = async (v: unknown, hint: string): Promise<unknown> => {
    if (v instanceof Blob) {
      const path = `assets/${safeName(hint)}-${assetN++}.${EXT[v.type] ?? 'bin'}`
      files[path] = [new Uint8Array(await v.arrayBuffer()), { level: 0 }]
      return { $asset: path, type: v.type }
    }
    if (isBin(v)) return { $bin: toB64(binBytes(v)), t: binType(v) }
    if (Array.isArray(v)) return Promise.all(v.map((x, i) => pull(x, `${hint}-${i}`)))
    if (v && typeof v === 'object') {
      const out: Row = {}
      for (const [k, x] of Object.entries(v as Row)) out[k] = await pull(x, hint)
      return out
    }
    return v
  }
  for (const t of d.tables) {
    const rows = (await t.toArray()) as Row[]
    const pk = pkOf(t)
    data[t.name] = (await Promise.all(rows.map((r) => pull(r, pk(r))))) as Row[]
  }
  // 노트 마크다운 사본
  const notes = (data.notes ?? []) as Array<{ id: string; title: string; deletedAt?: number | null }>
  const bodies = new Map(((data.noteBodies ?? []) as Array<{ noteId: string; text: string }>).map((b) => [b.noteId, b.text]))
  const used = new Set<string>()
  notes.filter((n) => !n.deletedAt).forEach((n) => {
    let name = safeName(n.title)
    if (used.has(name)) name = `${name} (${n.id.slice(-6)})`
    used.add(name)
    files[`notes/${name}.md`] = strToU8(`# ${n.title}\n\n${bodies.get(n.id) ?? ''}\n`)
  })
  const { counts, hashes } = await tableHashes(d)
  const manifest: Manifest = { app: 'gyeol', format: 1, schema: d.verno, exportedAt: Date.now(), counts, hashes, assets: assetN }
  files['data.json'] = strToU8(JSON.stringify(data))
  files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2))
  const zipped = zipSync(files, { level: 6 })
  return { blob: new Blob([zipped as BlobPart], { type: 'application/zip' }), filename: `gyeol-${dayKey(Date.now())}.gyeol.zip`, manifest }
}

/** 내려받기 (iOS는 공유 시트가 되면 그쪽) */
export async function saveFile(blob: Blob, filename: string): Promise<void> {
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
  const ios = /iP(hone|od|ad)/.test(nav.userAgent) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1)
  if (ios && nav.canShare) {
    const file = new File([blob], filename, { type: 'application/zip' })
    if (nav.canShare({ files: [file] })) {
      try {
        await nav.share({ files: [file] })
        return
      } catch {
        /* 취소 → 아래 내려받기로 */
      }
    }
  }
  const url = URL.createObjectURL(blob)
  const a = Object.assign(document.createElement('a'), { href: url, download: filename })
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

/** 내보내고 meta.lastBackup 기록 */
export async function exportAndSave(): Promise<Manifest> {
  const { blob, filename, manifest } = await exportBackup()
  await saveFile(blob, filename)
  await db.meta.put({ key: 'lastBackup', value: { at: manifest.exportedAt, notes: manifest.counts.notes ?? 0, memos: manifest.counts.memos ?? 0 } })
  return manifest
}

/* ---------- 가져오기 ---------- */

export interface OpenedBackup {
  manifest: Manifest
  data: Record<string, Row[]>
}

/** 파일을 열어 검사한다. 결 백업이 아니면 throw */
export async function openBackup(file: Blob): Promise<OpenedBackup> {
  const files = unzipSync(new Uint8Array(await file.arrayBuffer()))
  const mf = files['manifest.json']
  const dj = files['data.json']
  if (!mf || !dj) throw new Error('not a gyeol backup')
  const manifest = JSON.parse(strFromU8(mf)) as Manifest
  if (manifest.app !== 'gyeol' || manifest.format !== 1) throw new Error('not a gyeol backup')
  const raw = JSON.parse(strFromU8(dj)) as Record<string, Row[]>
  const put = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(put)
    if (v && typeof v === 'object') {
      const o = v as Row
      if (typeof o.$bin === 'string' && Object.keys(o).length <= 2) return unbin(o as { $bin: string; t?: string })
      if (typeof o.$asset === 'string' && Object.keys(o).length <= 2) {
        const bytes = files[o.$asset]
        return new Blob(bytes ? [bytes as BlobPart] : [], { type: String(o.type ?? '') })
      }
      const out: Row = {}
      for (const [k, x] of Object.entries(o)) out[k] = put(x)
      return out
    }
    return v
  }
  const data: Record<string, Row[]> = {}
  for (const [name, rows] of Object.entries(raw)) data[name] = rows.map((r) => put(r) as Row)
  return { manifest, data }
}

const stamp = (r: Row | undefined): number => Number((r?.updatedAt as number | undefined) ?? (r?.createdAt as number | undefined) ?? 0)

export async function importBackup(b: OpenedBackup, mode: ImportMode, d: AnyDB = db): Promise<ImportResult> {
  const names = d.tables.map((t) => t.name).filter((n) => b.data[n])
  const added: Record<string, number> = {}
  const counts: Record<string, number> = {}
  const newNoteIds: string[] = []
  await d.transaction('rw', d.tables, async () => {
    if (mode === 'replace') await Promise.all(d.tables.map((t) => t.clear()))
    for (const name of names) {
      const t = d.table(name)
      const rows = b.data[name]!
      counts[name] = rows.length
      if (mode === 'replace') {
        await t.bulkPut(rows)
        added[name] = rows.length
        if (name === 'notes') newNoteIds.push(...rows.map((r) => String(r.id)))
        continue
      }
      const pk = pkOf(t)
      const kp = t.schema.primKey.keyPath as string
      const have = (await t.bulkGet(rows.map((r) => r[kp] as string))) as Array<Row | undefined>
      const put: Row[] = []
      let n = 0
      rows.forEach((r, i) => {
        const cur = have[i]
        if (!cur) {
          put.push(r)
          n++
          if (name === 'notes') newNoteIds.push(pk(r))
        } else if (name !== 'meta' && stamp(r) > stamp(cur)) put.push(r)
      })
      if (put.length) await t.bulkPut(put)
      added[name] = n
    }
  })
  return { mode, counts, added, newNoteIds }
}

/* ---------- 왕복 시험 (개발용: window.__gyeolBackup.roundTrip()) ---------- */

export function cloneSchema(name: string): Dexie {
  const t = new Dexie(name)
  const stores: Record<string, string> = {}
  db.tables.forEach((tb) => {
    const s = tb.schema
    stores[tb.name] = [s.primKey.src, ...s.indexes.map((i) => i.src)].join(',')
  })
  t.version(db.verno).stores(stores)
  return t
}

/** src(기본 = 실제 DB, 읽기만) → 내보내기 → 임시 DB에 '바꾸기' → 표마다 개수·해시 비교 */
export async function roundTrip(src: AnyDB = db): Promise<{ ok: boolean; bytes: number; tables: Record<string, { count: number; same: boolean }> }> {
  const before = await tableHashes(src)
  const { blob, manifest } = await exportBackup(src)
  const tmp = cloneSchema(`gyeol-roundtrip-${Date.now()}`)
  try {
    await tmp.open()
    // 바꾸기가 기존 행을 비우는지도 본다: 쓰레기 행 하나를 먼저 넣는다
    await tmp.table('meta').put({ key: 'junk', value: 1 })
    const opened = await openBackup(blob)
    await importBackup(opened, 'replace', tmp)
    const after = await tableHashes(tmp)
    const tables: Record<string, { count: number; same: boolean }> = {}
    let ok = true
    for (const name of Object.keys(before.counts)) {
      const same = before.counts[name] === after.counts[name] && before.hashes[name] === after.hashes[name] && manifest.hashes[name] === after.hashes[name]
      tables[name] = { count: after.counts[name] ?? -1, same }
      ok &&= same
    }
    return { ok, bytes: blob.size, tables }
  } finally {
    tmp.close()
    await Dexie.delete(tmp.name)
  }
}

/**
 * 합성 왕복 시험: 임시 원본 DB에 사진 Blob · 획(points = ArrayBuffer와 Float32Array 둘 다) · 쪽 · 메모(고정·체크리스트)를 넣고
 * roundTrip(원본)으로 표마다 개수·해시를 비교한 뒤 임시 DB를 지운다. 실제 DB는 건드리지 않는다.
 */
export async function roundTripSynthetic(): Promise<Awaited<ReturnType<typeof roundTrip>> & { strokesChecked: boolean }> {
  const src = cloneSchema(`gyeol-rt-syn-${Date.now()}`)
  try {
    await src.open()
    const now = Date.now()
    const has = (n: string) => src.tables.some((t) => t.name === n)
    const pts = new Float32Array(4 * 200).map((_, i) => (i % 4 === 3 ? now + i : Math.sin(i) * 300))
    await src.table('subjects').put({ id: 's1', name: '물리', short: '물리', color: 'phys', aliases: ['물리'], order: 0, createdAt: now, updatedAt: now })
    await src.table('notes').put({ id: 'n1', title: '손글씨', subjectId: 's1', kind: 'ink', createdAt: now, updatedAt: now })
    await src.table('memos').put({ id: 'm1', text: '[ ] 하나\n[x] 둘', checklist: true, pinned: true, subjectId: 's1', state: 'inbox', filedTo: null, createdAt: now, updatedAt: now })
    await src.table('assets').put({ id: 'a1', ownerId: 'm1', mime: 'image/png', blob: new Blob([new Uint8Array([137, 80, 78, 71, 1, 2, 3])], { type: 'image/png' }), createdAt: now })
    if (has('pages')) await src.table('pages').put({ id: 'p1', noteId: 'n1', index: 0, template: 'grid', updatedAt: now })
    if (has('strokes')) {
      await src.table('strokes').bulkPut([
        { id: 'k1', pageId: 'p1', layer: 0, tool: 'pen', color: '#F2EFE8', width: 2, points: pts.buffer.slice(0), updatedAt: now },
        { id: 'k2', pageId: 'p1', layer: 0, tool: 'highlighter', color: '#F3D29A', width: 12, points: new Float32Array(pts.subarray(0, 40)), updatedAt: now },
      ])
    }
    const rt = await roundTrip(src)
    // 획 points가 같은 타입·같은 값으로 돌아오는지 직접 본다
    let strokesChecked = !has('strokes')
    if (has('strokes')) {
      const { blob } = await exportBackup(src)
      const back = await openBackup(blob)
      const k1 = back.data.strokes?.find((r) => r.id === 'k1')?.points
      const k2 = back.data.strokes?.find((r) => r.id === 'k2')?.points
      strokesChecked = k1 instanceof ArrayBuffer && k1.byteLength === pts.byteLength && new Float32Array(k1)[5] === pts[5] && k2 instanceof Float32Array && k2.length === 40 && k2[7] === pts[7]
    }
    return { ...rt, ok: rt.ok && strokesChecked, strokesChecked }
  } finally {
    src.close()
    await Dexie.delete(src.name)
  }
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as Window & { __gyeolBackup?: unknown }).__gyeolBackup = { roundTrip, roundTripSynthetic, tableHashes, exportBackup, openBackup }
}
