import { useEffect, useId, useRef, useState } from 'react'
import { useMotionMode } from '../context'
import type { StampProps } from '../types'

/**
 * 인주 도장 (v1 W5). 가장 가까운 position 있는 조상의 가운데에 찍힌다(112px, −12° 기울기).
 * show가 true가 되면 520ms 동안 위에서 눌러 찍히고(번짐 파문 포함) 900ms 머문 뒤 onDone.
 * show가 false가 되면 280ms 동안 사라진다. 테두리는 SVG 난류 필터로 인주처럼 고르지 않다.
 * 끔: 애니메이션 없이 나타났다가 1.2초 뒤 onDone.
 */
export function Stamp({ show, text, sub, onDone }: StampProps) {
  const mode = useMotionMode()
  const [phase, setPhase] = useState<'hidden' | 'in' | 'out'>(show ? 'in' : 'hidden')
  const doneRef = useRef(onDone)
  doneRef.current = onDone
  const fid = 'gx-ink-' + useId().replace(/[^a-zA-Z0-9_-]/g, '')

  useEffect(() => {
    if (show) {
      setPhase('in')
      const t = window.setTimeout(() => doneRef.current?.(), mode === 'off' ? 1200 : 520 + 900)
      return () => window.clearTimeout(t)
    }
    setPhase((p) => (p === 'hidden' ? 'hidden' : 'out'))
    const t = window.setTimeout(() => setPhase('hidden'), mode === 'off' ? 0 : 300)
    return () => window.clearTimeout(t)
  }, [show, mode])

  if (phase === 'hidden') return null
  const on = phase === 'out' ? '0' : mode === 'off' ? 'still' : '1'
  return (
    <div className="gx-stamp" data-on={on} aria-hidden="true">
      <span className="gx-stamp-face" />
      <svg viewBox="0 0 112 112">
        <defs>
          <filter id={fid} x="-10%" y="-10%" width="120%" height="120%">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" result="n" />
            <feDisplacementMap in="SourceGraphic" in2="n" scale="2.6" />
          </filter>
        </defs>
        <g filter={`url(#${fid})`} fill="none" stroke="currentColor">
          <circle cx="56" cy="56" r="53" strokeWidth="3" />
          <circle cx="56" cy="56" r="47" strokeWidth="1" opacity=".55" />
        </g>
      </svg>
      <span className="gx-stamp-splash" />
      <span className="gx-stamp-t">
        <span>{text}</span>
        {sub && <small>{sub}</small>}
      </span>
    </div>
  )
}
