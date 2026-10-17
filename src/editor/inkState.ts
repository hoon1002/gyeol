/**
 * 펼친 종이(필기 · PDF 노트) 상태 한 곳 — 첫 화면 번들에 들어가도 가볍게(잉크 엔진을 import하지 않는다).
 *  - 노트 화면이 종이를 펼치면 open(noteId), 접으면 close().
 *  - ⌘K는 isPaperOpen()으로 '손글씨' 묶음을 먼저 보일지 정하고, 그때만 '@/ink'를 동적 import한다.
 *  - PDF 가져오기: 노트를 만든 뒤 펼치기 전에 파일을 맡겨 두면(setPendingPdf) 종이가 엔진 준비 뒤에 가져온다.
 */
import { useSyncExternalStore } from 'react'

let openId: string | null = null
const listeners = new Set<() => void>()
const pendingPdf = new Map<string, Blob>()

export function paperOpened(noteId: string): void {
  openId = noteId
  listeners.forEach((f) => f())
}

export function paperClosed(noteId: string): void {
  if (openId !== noteId) return
  openId = null
  listeners.forEach((f) => f())
}

/** 지금 펼친 필기 노트 id (없으면 null) */
export function openPaperId(): string | null {
  return openId
}

export function isPaperOpen(): boolean {
  return openId !== null
}

export function usePaperOpen(): string | null {
  return useSyncExternalStore(
    (f) => {
      listeners.add(f)
      return () => listeners.delete(f)
    },
    () => openId,
  )
}

export function setPendingPdf(noteId: string, file: Blob): void {
  pendingPdf.set(noteId, file)
}

export function takePendingPdf(noteId: string): Blob | null {
  const f = pendingPdf.get(noteId) ?? null
  pendingPdf.delete(noteId)
  return f
}

/** 파일 고르기(PDF). 고르지 않으면 null */
export function pickPdf(): Promise<File | null> {
  return new Promise((res) => {
    const inp = document.createElement('input')
    inp.type = 'file'
    inp.accept = 'application/pdf,.pdf'
    inp.style.display = 'none'
    let done = false
    const finish = (f: File | null) => {
      if (done) return
      done = true
      inp.remove()
      res(f)
    }
    inp.onchange = () => finish(inp.files?.[0] ?? null)
    inp.addEventListener('cancel', () => finish(null))
    document.body.appendChild(inp)
    inp.click()
  })
}
