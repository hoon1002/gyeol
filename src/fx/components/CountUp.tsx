import { useLayoutEffect, useRef } from 'react'
import { useMotionMode } from '../context'
import type { CountUpProps } from '../types'

const defaultFormat = (n: number) => String(Math.round(n))

/**
 * 숫자 카운트업 — 600ms ease-out, tabular-nums. once(기본 true)면 처음 나타날 때 한 번만 세고
 * 이후 값이 바뀌면 바로 바꾼다. once=false면 값이 바뀔 때마다 이전 값에서 센다.
 * 글자는 React가 아니라 ref로 직접 쓴다(프레임마다 리렌더 없음). 끔: 최종값.
 */
export function CountUp({ value, format, duration = 600, once = true, className }: CountUpProps) {
  const mode = useMotionMode()
  const ref = useRef<HTMLSpanElement>(null)
  const fmtRef = useRef(format ?? defaultFormat)
  fmtRef.current = format ?? defaultFormat
  const shown = useRef<number | null>(null)
  const played = useRef(false)
  const raf = useRef(0)
  const isInt = Number.isInteger(value)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const fmt = fmtRef.current
    const from = shown.current ?? 0
    const animate = mode === 'rich' && (!once || !played.current) && from !== value && duration > 0
    const first = !played.current
    cancelAnimationFrame(raf.current)
    if (!animate) {
      played.current = true
      el.textContent = fmt(value)
      shown.current = value
      if (mode === 'calm' && first) el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'linear' })
      return
    }
    const t0 = performance.now()
    el.textContent = fmt(isInt ? Math.round(from) : from)
    const tick = (now: number) => {
      const p = Math.max(0, Math.min(1, (now - t0) / duration))
      const e = 1 - Math.pow(1 - p, 3)
      const v = from + (value - from) * e
      shown.current = v
      el.textContent = fmtRef.current(p >= 1 ? value : isInt ? Math.round(v) : v)
      if (p < 1) raf.current = requestAnimationFrame(tick)
      else {
        shown.current = value
        played.current = true
      }
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, mode])

  // 형식만 바뀐 경우
  useLayoutEffect(() => {
    const el = ref.current
    if (el && shown.current === value) el.textContent = fmtRef.current(value)
  })

  return <span ref={ref} className={className ? `gx-count ${className}` : 'gx-count'} aria-label={fmtRef.current(value)} />
}
