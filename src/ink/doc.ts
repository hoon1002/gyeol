/**
 * 손글씨 엔진 — 메모리 속 문서 (쪽 · 획 · 물건) + 공간 격자 + 저장 큐 + 되돌리기(명령 = 행 스냅숏 전/후).
 *
 * 모든 바뀜은 '행 스냅숏'으로 다룬다: 되돌리기 = before를 다시 쓰고, 다시하기 = after를 다시 쓴다.
 * 없던 것은 deletedAt이 찍힌 스냅숏으로 나타낸다. 그래서 명령 종류가 몇이든 apply 하나로 끝난다.
 */
import type { Page, PageTemplate } from '@/db/schema'
import { ensurePages, loadItems, loadStrokes, writeRows, type InkDB, type InkItem, type InkStroke, type InkWrite } from '@/db/ink'
import { bboxOverlap, type BBox } from './geom'
import { StrokeModel, zCompare } from './stroke'

export type Snap = InkWrite

export interface Command {
  label: string
  before: Snap
  after: Snap
  /** 되돌릴 때 보여 줄 쪽 */
  pageId?: string | null
}

export class History {
  private stack: Command[] = []
  private at = 0
  constructor(readonly limit = 200) {}
  push(c: Command): void {
    this.stack.length = this.at
    this.stack.push(c)
    if (this.stack.length > this.limit) this.stack.shift()
    this.at = this.stack.length
  }
  undo(): Command | null {
    return this.at > 0 ? this.stack[--this.at]! : null
  }
  redo(): Command | null {
    return this.at < this.stack.length ? this.stack[this.at++]! : null
  }
  get canUndo(): boolean {
    return this.at > 0
  }
  get canRedo(): boolean {
    return this.at < this.stack.length
  }
  clear(): void {
    this.stack = []
    this.at = 0
  }
}

/* ---------- 공간 격자 (획 bbox → 칸) ---------- */

const CELL = 96
const key = (cx: number, cy: number) => (cx + 4096) * 8192 + (cy + 4096)

export class Grid {
  private cells = new Map<number, Set<StrokeModel>>()
  private where = new WeakMap<StrokeModel, number[]>()
  private stamp = 1
  private seen = new WeakMap<StrokeModel, number>()

  add(m: StrokeModel): void {
    const b = m.bbox
    const keys: number[] = []
    const x0 = Math.floor(b[0] / CELL), x1 = Math.floor(b[2] / CELL), y0 = Math.floor(b[1] / CELL), y1 = Math.floor(b[3] / CELL)
    for (let cx = x0; cx <= x1; cx++)
      for (let cy = y0; cy <= y1; cy++) {
        const k = key(cx, cy)
        let s = this.cells.get(k)
        if (!s) this.cells.set(k, (s = new Set()))
        s.add(m)
        keys.push(k)
      }
    this.where.set(m, keys)
  }

  remove(m: StrokeModel): void {
    const keys = this.where.get(m)
    if (!keys) return
    for (const k of keys) this.cells.get(k)?.delete(m)
    this.where.delete(m)
  }

  query(b: BBox, out: StrokeModel[] = []): StrokeModel[] {
    const st = ++this.stamp
    const x0 = Math.floor(b[0] / CELL), x1 = Math.floor(b[2] / CELL), y0 = Math.floor(b[1] / CELL), y1 = Math.floor(b[3] / CELL)
    for (let cx = x0; cx <= x1; cx++)
      for (let cy = y0; cy <= y1; cy++) {
        const s = this.cells.get(key(cx, cy))
        if (!s) continue
        for (const m of s) {
          if (this.seen.get(m) === st) continue
          this.seen.set(m, st)
          if (bboxOverlap(m.bbox, b)) out.push(m)
        }
      }
    return out
  }
}

/* ---------- 쪽 ---------- */

export class PageModel {
  page: Page
  strokes = new Map<string, StrokeModel>()
  items = new Map<string, InkItem>()
  grid = new Grid()
  state: 'none' | 'loading' | 'ready' = 'none'
  loading: Promise<void> | null = null
  /** 형광 획 수 (형광 층이 필요한가) */
  hl = 0
  /** 바뀔 때마다 +1 (썸네일 캐시) */
  version = 0
  private sortedCache: StrokeModel[] | null = []

  constructor(page: Page) {
    this.page = page
  }
  get id(): string {
    return this.page.id
  }

  addModel(m: StrokeModel): void {
    this.strokes.set(m.id, m)
    this.grid.add(m)
    if (m.row.layer === 'highlight') this.hl++
    const sc = this.sortedCache
    if (sc) {
      const last = sc[sc.length - 1]
      if (!last || zCompare(last, m) <= 0) sc.push(m)
      else this.sortedCache = null
    }
    this.version++
  }

  removeModel(id: string): StrokeModel | undefined {
    const m = this.strokes.get(id)
    if (!m) return undefined
    this.strokes.delete(id)
    this.grid.remove(m)
    if (m.row.layer === 'highlight') this.hl--
    this.sortedCache = null
    this.version++
    return m
  }

  /** z 순서(만든 시각)대로 */
  sorted(): StrokeModel[] {
    if (!this.sortedCache) this.sortedCache = [...this.strokes.values()].sort(zCompare)
    return this.sortedCache
  }

  /** 상자와 겹치는 획 (z 순서) */
  query(b: BBox, layer?: 'ink' | 'highlight'): StrokeModel[] {
    const out = this.grid.query(b)
    const f = layer ? out.filter((m) => m.row.layer === layer) : out
    return f.sort(zCompare)
  }

  itemsSorted(): InkItem[] {
    return [...this.items.values()].sort((a, b) => a.z - b.z || a.createdAt - b.createdAt)
  }

  tapeCounts(): { revealed: number; total: number; color: string | null } {
    let total = 0, revealed = 0
    let color: string | null = null
    for (const it of this.items.values()) {
      if (it.kind !== 'tape') continue
      total++
      if (!it.hidden) revealed++
      color ??= it.color ?? null
    }
    return { revealed, total, color }
  }
}

/* ---------- 문서 ---------- */

export interface DocHooks {
  strokes(pm: PageModel, added: StrokeModel[], removed: StrokeModel[]): void
  items(pm: PageModel, changed: InkItem[], removed: InkItem[]): void
  pages(): void
  loaded(pm: PageModel): void
  error(e: unknown): void
  saved(): void
}

export class InkDoc {
  pages: PageModel[] = []
  byId = new Map<string, PageModel>()
  private q: Promise<void> = Promise.resolve()
  private pendingWrites = 0

  constructor(
    readonly db: InkDB,
    readonly noteId: string,
    private hooks: DocHooks,
  ) {}

  async open(init: { template?: PageTemplate; w?: number; h?: number } = {}): Promise<void> {
    const rows = await ensurePages(this.db, this.noteId, init)
    this.pages = rows.map((p) => new PageModel(p))
    this.byId = new Map(this.pages.map((pm) => [pm.id, pm]))
  }

  get saving(): boolean {
    return this.pendingWrites > 0
  }

  /** 쪽 획·물건을 읽는다 (저장 큐가 빈 뒤에) */
  load(pm: PageModel): Promise<void> {
    if (pm.state === 'ready') return Promise.resolve()
    if (pm.loading) return pm.loading
    pm.state = 'loading'
    pm.loading = (async () => {
      await this.q
      const [items] = await Promise.all([
        loadItems(this.db, pm.id),
        loadStrokes(this.db, pm.id, (rows) => {
          for (const r of rows) if (!pm.strokes.has(r.id)) pm.addModel(new StrokeModel(r))
        }),
      ])
      for (const it of items) pm.items.set(it.id, it)
      pm.state = 'ready'
      pm.loading = null
      pm.version++
      this.hooks.loaded(pm)
    })().catch((e) => {
      pm.state = 'none'
      pm.loading = null
      this.hooks.error(e)
    })
    return pm.loading
  }

  /** 스냅숏을 메모리에 적용 (저장은 persist) */
  apply(s: Snap): Set<string> {
    const touched = new Set<string>()
    if (s.pages?.length) {
      for (const p of s.pages) {
        const cur = this.byId.get(p.id)
        if (p.deletedAt) {
          if (cur) {
            this.byId.delete(p.id)
            this.pages = this.pages.filter((x) => x !== cur)
          }
        } else if (cur) cur.page = p
        else {
          const pm = new PageModel(p)
          this.byId.set(p.id, pm)
          this.pages.push(pm)
        }
        touched.add(p.id)
      }
      this.pages.sort((a, b) => a.page.index - b.page.index || (a.id < b.id ? -1 : 1))
      this.hooks.pages()
    }
    if (s.strokes?.length) {
      const per = new Map<PageModel, { added: StrokeModel[]; removed: StrokeModel[] }>()
      for (const r of s.strokes) {
        const pm = this.byId.get(r.pageId)
        touched.add(r.pageId)
        if (!pm || pm.state !== 'ready') continue
        let acc = per.get(pm)
        if (!acc) per.set(pm, (acc = { added: [], removed: [] }))
        const cur = pm.strokes.get(r.id)
        if (cur && cur.row === r) continue
        if (cur) acc.removed.push(pm.removeModel(r.id)!)
        if (!r.deletedAt) {
          const m = new StrokeModel(r)
          pm.addModel(m)
          acc.added.push(m)
        }
      }
      for (const [pm, acc] of per) if (acc.added.length || acc.removed.length) this.hooks.strokes(pm, acc.added, acc.removed)
    }
    if (s.items?.length) {
      const per = new Map<PageModel, { changed: InkItem[]; removed: InkItem[] }>()
      for (const it of s.items) {
        const pm = this.byId.get(it.pageId)
        touched.add(it.pageId)
        if (!pm || pm.state !== 'ready') continue
        let acc = per.get(pm)
        if (!acc) per.set(pm, (acc = { changed: [], removed: [] }))
        if (it.deletedAt) {
          const cur = pm.items.get(it.id)
          if (cur) {
            pm.items.delete(it.id)
            acc.removed.push(cur)
          }
        } else {
          pm.items.set(it.id, it)
          acc.changed.push(it)
        }
        pm.version++
      }
      for (const [pm, acc] of per) this.hooks.items(pm, acc.changed, acc.removed)
    }
    return touched
  }

  /** 스냅숏을 저장 큐에 */
  persist(s: Snap): Promise<void> {
    if (!s.strokes?.length && !s.items?.length && !s.pages?.length) return this.q
    this.pendingWrites++
    this.q = this.q
      .then(() => writeRows(this.db, s))
      .catch((e) => this.hooks.error(e))
      .finally(() => {
        this.pendingWrites--
        this.hooks.saved()
      })
    return this.q
  }

  /** 저장 큐가 빌 때까지 */
  flush(): Promise<void> {
    return this.q
  }

  stroke(pageId: string, id: string): StrokeModel | undefined {
    return this.byId.get(pageId)?.strokes.get(id)
  }

  get strokeCount(): number {
    let n = 0
    for (const pm of this.pages) n += pm.strokes.size
    return n
  }
}

/** 스냅숏 행에 지금 시각을 찍는다 (되돌리기·다시하기도 '마지막 바뀜'이다) */
export function stamp(s: Snap, now = Date.now()): Snap {
  return {
    strokes: s.strokes?.map((r) => ({ ...r, updatedAt: now })),
    items: s.items?.map((r) => ({ ...r, updatedAt: now })),
    pages: s.pages?.map((r) => ({ ...r, updatedAt: now })),
  }
}

export const deleted = <T extends { deletedAt?: number | null }>(r: T, now = Date.now()): T => ({ ...r, deletedAt: now, updatedAt: now })
export const alive = <T extends { deletedAt?: number | null }>(r: T, now = Date.now()): T => ({ ...r, deletedAt: null, updatedAt: now })

export type { InkStroke, InkItem }
