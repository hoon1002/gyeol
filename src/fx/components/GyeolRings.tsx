import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { useMotionMode } from '../context'
import { noise3 } from '../engine/noise'
import type { GyeolRingsProps } from '../types'

/**
 * 이번 주 결 — 나이테 여러 개(보통 요일 7개)를 가로로 놓는다.
 * item.size = 그날 집중 시간(시간). 25분 = 고리 1겹, 크기 = 52 + 시간×20 px (최대 172).
 * size 0이면 옅은 고리 하나(빈 날). grow면 화면에 들어올 때 안쪽 고리부터 그려진다.
 * 캡션은 넣지 않는다(앱이 필요하면 바깥에 둔다).
 */
export function GyeolRings({ items, grow = true, className }: GyeolRingsProps) {
  const mode = useMotionMode()
  const ref = useRef<HTMLDivElement>(null)
  const [inView, setInView] = useState(!grow)

  useEffect(() => {
    if (inView) return
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      setInView(true)
      return
    }
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) {
          setInView(true)
          io.disconnect()
        }
      },
      { threshold: 0.2 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [inView])

  const figs = useMemo(
    () =>
      items.map((it, idx) => {
        const hours = Math.max(0, it.size)
        const n = Math.min(14, Math.round((hours * 60) / 25))
        const sz = Math.min(172, 52 + hours * 20)
        const rings = Math.max(n, 1)
        const paths: Array<{ d: string; opacity: number }> = []
        for (let k = 0; k < rings; k++) {
          const rr = 5 + (k + 1) * ((sz / 2 - 7) / rings)
          let d = ''
          for (let a = 0; a <= 64; a++) {
            const an = (a / 64) * Math.PI * 2 - Math.PI / 2
            const q = rr * (1 + 0.075 * noise3(Math.cos(an) * 1.1 + k * 0.7, Math.sin(an) * 1.1 - k * 0.5, idx * 1.7))
            const x = sz / 2 + Math.cos(an) * q + k * 0.55 - rings * 0.27
            const y = sz / 2 + Math.sin(an) * q - k * 0.25 + rings * 0.12
            d += (a ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1)
          }
          paths.push({ d: d + 'Z', opacity: n ? 0.42 + (k / rings) * 0.58 : 0.9 })
        }
        return { sz, paths, empty: n === 0, color: it.color }
      }),
    [items],
  )

  const growing = grow && mode !== 'off' && inView
  return (
    <div ref={ref} className={className ? `gx-rings ${className}` : 'gx-rings'} data-grow={growing ? '1' : '0'}>
      {figs.map((f, i) => (
        <svg key={i} width={f.sz} height={f.sz} viewBox={`0 0 ${f.sz} ${f.sz}`} aria-hidden="true" style={{ visibility: grow && !inView && mode !== 'off' ? 'hidden' : undefined }}>
          {f.paths.map((p, k) => {
            const style: CSSProperties = {
              stroke: f.empty ? 'var(--border-strong, #3A3F47)' : f.color,
              opacity: p.opacity,
            }
            if (growing) {
              style.animationDelay = `${i * 70 + k * 45}ms`
              if (mode === 'calm') style.animationDuration = '200ms'
            }
            return <path key={k} d={p.d} pathLength={1} style={style} />
          })}
        </svg>
      ))}
    </div>
  )
}
