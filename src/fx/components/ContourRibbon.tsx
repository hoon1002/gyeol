import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useMotionMode } from '../context'
import { noise3 } from '../engine/noise'
import type { ContourRibbonProps } from '../types'
import { EASE_OUT } from './RevealText'

const H = 132
const LINES = 5

const hourOf = (d: Date) => d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600
const fmtHM = (d: Date) => `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`

/**
 * 오늘의 흐름 — 하루를 가로 등고선 띠 하나로.
 * 수업(kind 'class')은 띠가 부풀어 오르는 구간(과목색), 집중 세트('focus')는 인주 점, 지금은 세로 실선.
 * 지난 시간은 진하게, 남은 시간은 옅게. 처음 화면에 들어올 때 왼쪽에서 오른쪽으로 1.2초 동안 그려진다.
 * 너비는 부모를 따른다(ResizeObserver).
 */
export function ContourRibbon({ segments, now, className }: ContourRibbonProps) {
  const mode = useMotionMode()
  const wrapRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [w, setW] = useState(0)
  const [inView, setInView] = useState(false)
  const played = useRef(false)

  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    setW(el.clientWidth)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setW(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const el = wrapRef.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      setInView(true)
      return
    }
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) {
        setInView(true)
        io.disconnect()
      }
    }, { threshold: 0.25 })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useLayoutEffect(() => {
    if (!inView || played.current || !w) return
    played.current = true
    const svg = svgRef.current
    if (!svg || mode === 'off') return
    if (mode === 'calm') svg.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200 })
    else svg.animate([{ clipPath: 'inset(-20px 100% -20px 0)' }, { clipPath: 'inset(-20px 0% -20px 0)' }], { duration: 1200, easing: EASE_OUT })
  }, [inView, w, mode])

  const geo = useMemo(() => {
    if (!w) return null
    const pad = 14
    let h0 = 8
    let h1 = 22
    for (const s of segments) {
      h0 = Math.min(h0, Math.floor(hourOf(s.start)))
      h1 = Math.max(h1, Math.ceil(hourOf(s.end)))
    }
    const nowH = hourOf(now)
    h0 = Math.min(h0, Math.floor(nowH))
    h1 = Math.max(h1, Math.ceil(nowH))
    const X = (h: number) => pad + ((h - h0) / (h1 - h0)) * (w - pad * 2)
    const cy = 54
    const classes = segments.filter((s) => s.kind === 'class').map((s) => ({ x0: X(hourOf(s.start)), x1: X(hourOf(s.end)), color: s.color }))
    const swell = (x: number) => {
      let v = 0
      for (const c of classes) {
        const e = 22
        const t = x < c.x0 ? (x - (c.x0 - e)) / e : x > c.x1 ? (c.x1 + e - x) / e : 1
        const k = Math.max(0, Math.min(1, t))
        v = Math.max(v, k * k * (3 - 2 * k))
      }
      return v
    }
    const lines: string[] = []
    const stepX = 6
    for (let li = 0; li < LINES; li++) {
      const off = li - (LINES - 1) / 2
      let d = ''
      for (let x = pad; x <= w - pad + 0.1; x += stepX) {
        const sw = swell(x)
        const gap = 2.4 + sw * 6.4
        const y = cy - sw * 5 + 7 * noise3(x * 0.0042, 0.3, 1.7) + off * gap * (1 + 0.18 * Math.abs(off) * sw) + 1.4 * noise3(x * 0.011, li * 1.3, 4.2) * (1 - sw * 0.5)
        d += (x === pad ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(2)
      }
      lines.push(d)
    }
    const nowX = X(nowH)
    const focus = segments
      .filter((s) => s.kind === 'focus')
      .map((s) => ({ x: X((hourOf(s.start) + hourOf(s.end)) / 2), color: s.color }))
    const ticks: Array<{ x: number; label: string }> = []
    for (let h = Math.ceil(h0 / 2) * 2; h <= h1; h += 2) ticks.push({ x: X(h), label: String(h) })
    return { lines, classes, nowX, focus, ticks, cy, pad }
  }, [w, segments, now])

  const id = 'gx-rb-' + useId().replace(/[^a-zA-Z0-9_-]/g, '')

  return (
    <div ref={wrapRef} className={className ? `gx-ribbon ${className}` : 'gx-ribbon'}>
      {geo && (
        <svg ref={svgRef} width={w} height={H} viewBox={`0 0 ${w} ${H}`} role="img" aria-label={`오늘의 흐름, 지금 ${fmtHM(now)}`}>
          <defs>
            <clipPath id={`${id}-past`}>
              <rect x="0" y="-20" width={Math.max(0, geo.nowX)} height={H + 40} />
            </clipPath>
            <clipPath id={`${id}-future`}>
              <rect x={geo.nowX} y="-20" width={Math.max(0, w - geo.nowX)} height={H + 40} />
            </clipPath>
            {geo.classes.map((c, i) => {
              const f = Math.min(20, Math.max(1, (c.x1 - c.x0) / 3))
              const x0 = c.x0 - f
              const span = Math.max(1, c.x1 - c.x0 + f * 2)
              return (
                <g key={i}>
                  <linearGradient id={`${id}-g${i}`} gradientUnits="userSpaceOnUse" x1={x0} x2={x0 + span} y1="0" y2="0">
                    <stop offset="0" stopColor="#fff" stopOpacity="0" />
                    <stop offset={f / span} stopColor="#fff" stopOpacity="1" />
                    <stop offset={1 - f / span} stopColor="#fff" stopOpacity="1" />
                    <stop offset="1" stopColor="#fff" stopOpacity="0" />
                  </linearGradient>
                  <mask id={`${id}-c${i}`} maskUnits="userSpaceOnUse" x={x0} y="-20" width={span} height={H + 40}>
                    <rect x={x0} y="-20" width={span} height={H + 40} fill={`url(#${id}-g${i})`} />
                  </mask>
                </g>
              )
            })}
          </defs>
          <g clipPath={`url(#${id}-past)`} opacity="0.62">
            {geo.lines.map((d, i) => (
              <path key={i} className="gx-rb-base" d={d} />
            ))}
          </g>
          <g clipPath={`url(#${id}-future)`} opacity="0.26">
            {geo.lines.map((d, i) => (
              <path key={i} className="gx-rb-base" d={d} />
            ))}
          </g>
          {geo.classes.map((c, i) => (
            <g key={i} mask={`url(#${id}-c${i})`} style={{ stroke: c.color }}>
              {geo.lines.map((d, li) => (
                <path key={li} className={li === (LINES - 1) / 2 ? 'gx-rb-core' : 'gx-rb-cls'} d={d} style={{ stroke: c.color }} opacity={li === (LINES - 1) / 2 ? 1 : 0.8} />
              ))}
            </g>
          ))}
          {geo.focus.map((f, i) => (
            <circle key={i} className="gx-rb-dot" cx={f.x} cy={geo.cy + 30} r="3.6" style={f.color ? { fill: f.color } : undefined} />
          ))}
          <line className="gx-rb-now" x1={geo.nowX} x2={geo.nowX} y1={geo.cy - 34} y2={geo.cy + 34} />
          <circle className="gx-rb-now-dot" cx={geo.nowX} cy={geo.cy - 34} r="2.4" />
          <text className="gx-rb-nowlbl" x={geo.nowX} y={geo.cy - 42} textAnchor="middle">
            지금 {fmtHM(now)}
          </text>
          {geo.ticks.map((t) => (
            <text key={t.label} x={t.x} y={H - 8} textAnchor="middle">
              {t.label}
            </text>
          ))}
        </svg>
      )}
    </div>
  )
}
