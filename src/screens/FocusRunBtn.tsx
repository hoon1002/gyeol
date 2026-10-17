/**
 * 오늘의 금빛 원 — 집중이 도는(또는 멈춘) 동안 (QA #11): 남은 시간 링 + 숫자 `18:24`. 누르면 집중으로.
 * 글은 늘리지 않는다(숫자 하나). 1초마다 이 잎만 다시 그린다, 숨은 공간이면 멈춘다.
 */
import { useEffect, useState } from 'react'
import { remainingMs, useFocusTimer } from '@/stores/focus'
import { tip } from '@/shell/Tip'

const R = 21
const C = 2 * Math.PI * R

function mmss(ms: number): string {
  const s = Math.ceil(ms / 1000)
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

export function FocusRunBtn({ active, onGo }: { active: boolean; onGo: (el: Element) => void }) {
  const t = useFocusTimer()
  const [, tick] = useState(0)
  useEffect(() => {
    if (!active || t.phase !== 'running') return
    const iv = window.setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(iv)
  }, [active, t.phase])
  const left = remainingMs(t)
  const frac = t.plannedMs ? Math.max(0, Math.min(1, left / t.plannedMs)) : 0
  const label = `${t.phase === 'paused' ? '멈춘 집중' : '집중 중'} ${mmss(left)}`
  return (
    <button type="button" className={`gold-btn focus-run${t.phase === 'paused' ? ' is-paused' : ''}`} {...tip(label)} onClick={(e) => onGo(e.currentTarget)}>
      <svg width="48" height="48" viewBox="0 0 48 48" aria-hidden="true">
        <circle cx="24" cy="24" r={R} fill="none" stroke="currentColor" strokeOpacity=".25" strokeWidth="2" />
        <circle cx="24" cy="24" r={R} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - frac)} transform="rotate(-90 24 24)" />
      </svg>
      <span className="ibadge focus-run-num" aria-hidden="true">{mmss(left)}</span>
    </button>
  )
}
