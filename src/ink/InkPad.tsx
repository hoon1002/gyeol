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
import type { InkDB } from '@/db/ink'
import { createInkEngine, type InkEngine } from './engine'
import { PEN_SLOTS } from './palette'
import './ink.css'

export interface InkPadProps {
  memoId: string
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
    const eng = createInkEngine({ host, noteId: 'memo:' + props.memoId, db: props.db, mode: 'pad', padSize: [props.width, props.height], night: document.documentElement.getAttribute('data-theme') !== 'light' })
    eng.setPen({ color: PEN_SLOTS[0], width: 2, kind: 'ball' })
    const offs = [eng.on('active', setInking), eng.on('change', () => cb.current.onChange?.(eng.doc.strokeCount))]
    void eng.ready.then(() => {
      cb.current.onReady?.(eng)
      cb.current.onChange?.(eng.doc.strokeCount)
    })
    return () => {
      offs.forEach((f) => f())
      eng.destroy()
    }
  }, [props.memoId, props.db, props.width, props.height])
  useFieldPause(inking, 'ink')
  return <div ref={ref} className={'ink-pad-host' + (props.className ? ' ' + props.className : '')} style={{ position: 'relative', width: props.width, height: props.height, ...props.style }} aria-label="손글씨 메모" role="application" />
}

export default InkPad
