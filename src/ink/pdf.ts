/**
 * 손글씨 엔진 — PDF (pdfjs-dist, 쓸 때만 불러온다). 원본은 assets Blob, 쪽마다 Page(pdf: { assetId, pageNo }).
 * 보이는 쪽만 그린다(render.ts 슬롯이 부른다). worker는 Vite `?url`로. 구형 Safari를 위해 legacy 빌드를 쓴다.
 */
import type { InkDB } from '@/db/ink'
import { getAssetBlob } from '@/db/ink'

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs')
type PdfDoc = Awaited<ReturnType<PdfJs['getDocument']>['promise']>

let libP: Promise<PdfJs> | null = null

export function pdfjs(): Promise<PdfJs> {
  if (!libP)
    libP = Promise.all([import('pdfjs-dist/legacy/build/pdf.mjs'), import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')]).then(([lib, w]) => {
      lib.GlobalWorkerOptions.workerSrc = (w as { default: string }).default
      return lib
    })
  return libP
}

const docs = new WeakMap<InkDB, Map<string, Promise<PdfDoc>>>()

/** 첨부 id → 열린 PDF (DB마다 캐시) */
export function pdfDoc(db: InkDB, assetId: string): Promise<PdfDoc> {
  let per = docs.get(db)
  if (!per) docs.set(db, (per = new Map()))
  let p = per.get(assetId)
  if (!p) {
    p = (async () => {
      const lib = await pdfjs()
      const blob = await getAssetBlob(db, assetId)
      if (!blob) throw new Error('PDF 원본이 없어요')
      const data = new Uint8Array(await blob.arrayBuffer())
      return lib.getDocument({ data }).promise
    })()
    p.catch(() => per!.delete(assetId))
    per.set(assetId, p)
  }
  return p
}

/** 파일 → 쪽 크기들(pt, 회전 반영) */
export async function readPdfSizes(file: Blob, onPage?: (i: number, n: number) => void): Promise<Array<[number, number]>> {
  const lib = await pdfjs()
  const data = new Uint8Array(await file.arrayBuffer())
  const task = lib.getDocument({ data })
  const doc = await task.promise
  const out: Array<[number, number]> = []
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      const vp = page.getViewport({ scale: 1 })
      out.push([Math.round(vp.width * 100) / 100, Math.round(vp.height * 100) / 100])
      page.cleanup()
      onPage?.(i, doc.numPages)
    }
  } finally {
    void task.destroy()
  }
  return out
}

export interface PdfTask {
  promise: Promise<void>
  cancel(): void
}

/**
 * PDF 쪽의 한 영역을 ctx에 그린다. ctx의 캔버스 (0,0) = 쪽 좌표 (rx, ry), k = 장치 px / pt.
 */
export function renderPdfRegion(db: InkDB, assetId: string, pageNo: number, ctx: CanvasRenderingContext2D, k: number, rx: number, ry: number): PdfTask {
  let cancelled = false
  let task: { cancel(): void; promise: Promise<void> } | null = null
  const promise = (async () => {
    const doc = await pdfDoc(db, assetId)
    if (cancelled) return
    const page = await doc.getPage(pageNo)
    if (cancelled) return
    const viewport = page.getViewport({ scale: k })
    // pdfjs는 지금 변환 위에 곱해 그린다 → 슬롯의 쪽 변환을 풀고 장치 px 기준으로
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalCompositeOperation = 'source-over'
    ctx.fillStyle = '#FFFFFF'
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)
    const t = page.render({ canvas: null, canvasContext: ctx, viewport, transform: [1, 0, 0, 1, -rx * k, -ry * k], background: 'rgba(255,255,255,1)' })
    task = t
    await t.promise
  })()
  return {
    promise,
    cancel() {
      cancelled = true
      task?.cancel()
    },
  }
}

/** 쪽 하나를 통째로 캔버스에 (썸네일 · PNG 내보내기) */
export async function renderPdfPage(db: InkDB, assetId: string, pageNo: number, ctx: CanvasRenderingContext2D, k: number): Promise<void> {
  await renderPdfRegion(db, assetId, pageNo, ctx, k, 0, 0).promise
}
