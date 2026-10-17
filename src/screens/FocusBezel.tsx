/**
 * 집중 타이머 링 = 은하 원반 둘레의 베젤 (design-m1 2-3).
 * 자리: useSkyAnchor('focus-disk') → { x, y, r, visible } (CSS px). r = 보이는 팔 고리(11.5u)의 화면 반지름 → 링 R = 1.22 × r (= 14u).
 * 앵커는 비행 끝·크기 변경·드래그가 멈출 때만 온다 → React를 다시 그리지 않고 SVG 속성과 CSS 변수만 바꾼다.
 * 비행 중(visible=false)에는 숨기고, 앵커가 오면 320ms opacity로 나타난다. 앵커가 끝내 안 오면(2.5D 대체 등) 3.2초 뒤 design-m1 자리로 그린다.
 * 진행 호는 1초마다만(부모의 1초 렌더) 바뀐다. 12시에서 시계 방향.
 * 숫자 블록 배치용 CSS 변수(--ring-x · --ring-y · --ring-r, px)를 stageRef 요소에 심는다.
 */
import { useCallback, useEffect, useRef, type RefObject } from 'react'
import { useSkyAnchor } from '@/fx'
import { zoneLayout } from '@/app/zones'

export type BezelState = 'idle' | 'running' | 'paused' | 'done'

/** 링 반지름 = 팔 고리 반지름 × 1.22 (design-m1 2-3) */
const RING_K = 1.22

/** 앵커가 없을 때의 자리 (design-m1 2-1 집중 seat · R = 짧은 변 0.40) */
function fallbackDisk(w: number, h: number): { x: number; y: number; r: number } {
  const L = zoneLayout(w, h)
  const seat = L === 'phone' ? [0.5, 0.36] : L === 'port' ? [0.54, 0.4] : w >= 1200 ? [0.6, 0.5] : [0.62, 0.5]
  return { x: seat[0]! * w, y: seat[1]! * h, r: 0.4 * Math.min(w, h) }
}

export function FocusBezel({ active, progress, state, stageRef }: { active: boolean; progress: number; state: BezelState; stageRef: RefObject<HTMLElement | null> }) {
  const svgRef = useRef<SVGSVGElement>(null)
  const trackRef = useRef<SVGCircleElement>(null)
  const arcRef = useRef<SVGCircleElement>(null)
  const got = useRef(false)
  const activeRef = useRef(active)
  activeRef.current = active

  const place = useCallback(
    (x: number, y: number, r: number, show: boolean) => {
      const svg = svgRef.current
      if (!svg) return
      for (const c of [trackRef.current, arcRef.current]) {
        if (!c) continue
        c.setAttribute('cx', x.toFixed(1))
        c.setAttribute('cy', y.toFixed(1))
        c.setAttribute('r', r.toFixed(1))
      }
      arcRef.current?.setAttribute('transform', `rotate(-90 ${x.toFixed(1)} ${y.toFixed(1)})`)
      const st = stageRef.current?.style
      st?.setProperty('--ring-x', `${x.toFixed(1)}px`)
      st?.setProperty('--ring-y', `${y.toFixed(1)}px`)
      st?.setProperty('--ring-r', `${r.toFixed(1)}px`)
      svg.dataset.show = show ? '1' : '0'
    },
    [stageRef],
  )

  // 앵커는 숨어 있을 때도 받아 둔다(장소가 다시 보일 때 크기 변경 앵커를 놓치지 않게). 보임 = 이 장소가 보이고 + 엔진이 visible.
  const last = useRef<{ x: number; y: number; r: number; visible: boolean } | null>(null)
  useSkyAnchor('focus-disk', (a) => {
    const svg = svgRef.current
    if (svg) svg.dataset.anchors = String(Number(svg.dataset.anchors ?? 0) + 1)
    if (!(a.r > 0)) {
      if (svg) svg.dataset.show = '0'
      return
    }
    got.current = true
    last.current = a
    place(a.x, a.y, a.r * RING_K, activeRef.current && a.visible)
  })

  // 장소가 보일 때마다: 비행 끝 앵커를 기다린다. 3.2초 안에 보이는 앵커가 없으면 마지막 앵커(없으면 design-m1 자리)로 그린다.
  useEffect(() => {
    const svg = svgRef.current
    if (!active) {
      if (svg) svg.dataset.show = '0'
      return
    }
    const fallback = () => {
      const f = fallbackDisk(innerWidth, innerHeight)
      return { x: f.x, y: f.y, R: f.r }
    }
    const lastFits = () => {
      const l = last.current
      // 마지막 앵커가 지금 화면 안에 있을 때만 믿는다(크기가 바뀐 뒤 옛 값이면 대체 자리)
      return l && l.x > 0 && l.x < innerWidth && l.y > 0 && l.y < innerHeight ? { x: l.x, y: l.y, R: l.r * RING_K } : null
    }
    if (!got.current) {
      const f = fallback()
      place(f.x, f.y, f.R, false)
    }
    const t = window.setTimeout(() => {
      if (svgRef.current?.dataset.show === '1') return
      const g = lastFits() ?? fallback()
      place(g.x, g.y, g.R, true)
    }, 3200)
    const onResize = () => {
      if (got.current) return
      const f = fallback()
      place(f.x, f.y, f.R, svg?.dataset.show === '1')
    }
    window.addEventListener('resize', onResize)
    return () => {
      clearTimeout(t)
      window.removeEventListener('resize', onResize)
    }
  }, [active, place])

  const p = Math.max(0, Math.min(1, progress))
  return (
    <svg ref={svgRef} className="focus-bezel" data-state={state} data-show="0" aria-hidden="true">
      <circle ref={trackRef} className="bezel-track" cx="0" cy="0" r="0" />
      <circle ref={arcRef} className="bezel-arc" cx="0" cy="0" r="0" pathLength={1} strokeDasharray={`${p} 1`} style={{ opacity: p > 0 ? undefined : 0 }} />
    </svg>
  )
}
