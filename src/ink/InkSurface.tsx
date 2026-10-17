/**
 * 노트 화면에 붙이는 얇은 래퍼 (앱 A). 엔진은 React 밖, 이 컴포넌트는 붙이고 떼는 일과 하늘 쉼만 한다.
 *
 *   const InkSurface = lazy(() => import('@/ink'))          // 첫 화면 번들 밖
 *   <InkSurface noteId={note.id} onReady={(eng) => …} onClose={() => …} onPagesWritten={(n) => …} />
 *
 * - 하늘: 펜이 닿아 있거나 마지막 획 뒤 2초 → useFieldPause(true, 'ink'). :root[data-inking]은 엔진이 붙인다.
 * - 밤 종이: html[data-theme]를 지켜보고 엔진에 알린다.
 * - onClose: 엔진 'ink.close' 명령(⌘K '노트 닫기')이 오면 부른다. 앱이 ‹ · 뒤로를 처리하면서 같은 것을 부르면 된다.
 * - onPagesWritten(n): 닫을 때(언마운트) 이번에 연 동안 획이 늘어난 쪽 수 → 하늘 inkSettled(noteId, { pages: n })용.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useFieldPause } from '@/fx'
import type { InkDB } from '@/db/ink'
import type { PageTemplate } from '@/db/schema'
import { createInkEngine, type InkEngine } from './engine'
import { InkToolbar } from './ui/InkToolbar'
import './ink.css'

export interface InkSurfaceProps {
  noteId: string
  db?: InkDB
  /** 새 노트 첫 쪽 틀 */
  template?: PageTemplate
  className?: string
  style?: CSSProperties
  /** 화면이 보이는가 (숨은 화면은 하늘을 붙들지 않는다) */
  active?: boolean
  /** 도구 칸 · 둥근 메뉴 · 선택 칸 · 서랍 UI (기본 true). 앱이 직접 그리면 false */
  ui?: boolean
  onReady?: (engine: InkEngine) => void
  onClose?: () => void
  /** 닫을 때: 이번에 획이 늘어난 쪽 수 */
  onPagesWritten?: (pages: number, strokesAdded: number) => void
}

function themeNight(): boolean {
  return document.documentElement.getAttribute('data-theme') !== 'light'
}

export function InkSurface(props: InkSurfaceProps) {
  const { noteId, db, template, active = true, ui = true } = props
  const hostRef = useRef<HTMLDivElement>(null)
  const [engine, setEngine] = useState<InkEngine | null>(null)
  const [inking, setInking] = useState(false)
  const cb = useRef(props)
  cb.current = props

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const eng = createInkEngine({ host, noteId, db, template, night: themeNight() })
    const touched = new Set<string>()
    const offs = [
      eng.on('active', setInking),
      eng.on('stroke', ({ pageId }) => touched.add(pageId)),
      eng.on('ui', ({ id }) => {
        if (id === 'ink.close') cb.current.onClose?.()
      }),
    ]
    let alive = true
    void eng.ready.then(() => {
      if (!alive) return
      setEngine(eng)
      cb.current.onReady?.(eng)
    })
    // 테마 → 밤 종이
    const mo = new MutationObserver(() => eng.setNight(themeNight()))
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => {
      alive = false
      mo.disconnect()
      offs.forEach((f) => f())
      cb.current.onPagesWritten?.(touched.size, eng.strokesAdded)
      eng.destroy()
      setEngine(null)
      setInking(false)
    }
  }, [noteId, db, template])

  useFieldPause(active && inking, 'ink')

  return (
    <div className={'ink-surface' + (props.className ? ' ' + props.className : '')} style={{ position: 'relative', width: '100%', height: '100%', ...props.style }}>
      <div ref={hostRef} className="ink-canvas" style={{ position: 'absolute', inset: 0 }} aria-label="필기" role="application" />
      {ui && engine && <InkToolbar engine={engine} />}
    </div>
  )
}

export default InkSurface
