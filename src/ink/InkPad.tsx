/**
 * 손글씨 메모 칸 (design-ink 8-1, 앱 B가 붙인다). 쪽 하나(pages.noteId = 'memo:<메모 id>'), 확대·이동 없음, 종이 투명.
 * 펜(1번 색 · 보통 굵기)만 쓴다. 긁어 지우기 · 두 손가락 탭 되돌리기는 된다. 도구 칸은 없다.
 *
 *   <InkPad memoId={memo.id} width={W} height={260} onChange={(n) => …} onReady={(eng) => …} />
 *   캔버스는 처음부터 커진 칸 크기(height)로 깔고, 칸 밖은 부모가 잘라 보이게 한다(위로 자람 · 펜 아래 그림 고정).
 *   onChange(n): 획 수 (↑ 저장 버튼을 보일지)
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useFieldPause } from '@/fx'
import { appInkDB, type InkDB } from '@/db/ink'
import { createInkEngine, type InkEngine } from './engine'
import { PEN_SLOTS } from './palette'
import type { InkPadBuffer } from './padbuffer'
import './ink.css'

export interface InkPadProps {
  memoId: string
  /** 이미 있는 쪽 (memo.pageId). 주면 그 쪽의 노트 id로 연다(없으면 'memo:<memoId>') */
  pageId?: string | null
  /** 준비되기 전에 닿은 점 (new InkPadBuffer(메모 칸)) — 준비되면 받아서 쓴다 (QA #25) */
  pending?: InkPadBuffer | null
  /** 칸 크기 (pt = CSS px) */
  width: number
  height: number
  db?: InkDB
  className?: string
  style?: CSSProperties
  onReady?: (engine: InkEngine) => void
  onChange?: (strokes: number) => void
}

export function InkPad(props: InkPadProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [inking, setInking] = useState(false)
  const cb = useRef(props)
  cb.current = props
  useEffect(() => {
    const host = ref.current
    if (!host) return
    let eng: InkEngine | null = null
    let offs: Array<() => void> = []
    let dead = false
    const d = props.db ?? appInkDB
    void (async () => {
      // 기존 쪽이 있으면 그 쪽의 노트 id로 (획을 다시 불러온다)
      const page = props.pageId ? await d.pages.get(props.pageId).catch(() => undefined) : undefined
      if (dead) return
      const noteId = page?.noteId ?? 'memo:' + props.memoId
      const e = createInkEngine({ host, noteId, db: d, mode: 'pad', padSize: [props.width, props.height], night: document.documentElement.getAttribute('data-theme') !== 'light' })
      eng = e
      e.setPen({ color: PEN_SLOTS[0], width: 2, kind: 'ball' })
      offs = [e.on('active', setInking), e.on('change', () => cb.current.onChange?.(e.doc.strokeCount))]
      await e.ready
      if (dead) return
      // 준비 전에 받은 획: 끝난 것은 그대로 쓰고, 아직 누르고 있으면 이어 받는다
      const buf = cb.current.pending
      if (buf) {
        for (const st of buf.handoff((pts) => {
          const h = e.externalStroke(pts[0]!)
          if (h) for (const q of pts.slice(1)) h.move(q)
          return h
        }))
          e.injectStroke(st)
      }
      cb.current.onReady?.(e)
      cb.current.onChange?.(e.doc.strokeCount)
    })()
    return () => {
      dead = true
      offs.forEach((f) => f())
      eng?.destroy()
    }
  }, [props.memoId, props.pageId, props.db, props.width, props.height])
  useFieldPause(inking, 'ink')
  return <div ref={ref} className={'ink-pad-host' + (props.className ? ' ' + props.className : '')} style={{ position: 'relative', width: props.width, height: props.height, ...props.style }} aria-label="손글씨 메모" role="application" />
}

export default InkPad
