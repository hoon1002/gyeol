import { useEffect, useLayoutEffect, useRef } from 'react'
import type { CSSProperties } from 'react'
import { useMotionMode } from '../context'
import type { FocusRingProps } from '../types'
import { EASE_OUT } from './RevealText'

/**
 * 원형 타이머 링 + 궤도 빛 (v1 W3).
 * progress = 지난 시간 비율(0 = 꽉 찬 링, 1 = 다 줄어든 링). 링은 남은 시간만큼 남고, 빛은 줄어드는 끝을 돈다.
 * 앱이 1초마다만 progress를 바꿔도 running 중에는 사이를 매끄럽게 이어 그린다(속도 추정).
 * state: idle(정지·흐린 빛) / running(빛이 숨 쉼) / paused(링 흐림·빛 깜박임) / done(링이 다시 차오르고 파문 1회).
 * drawIn: 처음 나타날 때 링이 760ms 동안 그려지고 빛은 600ms 뒤에 켜진다.
 */
export function FocusRing({ progress, size = 200, color, state, drawIn = false, children }: FocusRingProps) {
  const mode = useMotionMode()
  const progRef = useRef<SVGCircleElement>(null)
  const orbitRef = useRef<SVGGElement>(null)
  const sample = useRef({ p: progress, t: 0, rate: 0, shown: progress })
  const drawn = useRef(false)

  const paint = (p: number) => {
    const c = Math.max(0, Math.min(1, p))
    sample.current.shown = c
    const prog = progRef.current
    const orbit = orbitRef.current
    if (prog) prog.style.strokeDashoffset = String(-1000 * c)
    if (orbit) orbit.setAttribute('transform', `rotate(${(c * 360).toFixed(2)} 100 100)`)
  }

  // 새 progress → 속도 추정
  useLayoutEffect(() => {
    const now = performance.now()
    const s = sample.current
    const dt = now - s.t
    if (s.t && dt > 30 && dt < 3000 && progress >= s.p) s.rate = (progress - s.p) / dt
    else if (progress < s.p) s.rate = 0
    s.p = progress
    s.t = now
    if (state !== 'running' || mode === 'off' || !drawn.current) paint(state === 'done' ? 0 : progress)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress, state, mode])

  // running 동안 매 프레임 이어 그리기
  useEffect(() => {
    if (state !== 'running' || mode === 'off') return
    let raf = 0
    const tick = () => {
      const s = sample.current
      const ahead = Math.min(performance.now() - s.t, 1500)
      const target = Math.min(1, s.p + s.rate * ahead)
      // 뒤로 튀지 않게 아주 조금만 되돌림
      paint(target < s.shown ? s.shown + (target - s.shown) * 0.2 : target)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, mode])

  // done: 링이 다시 차오른다
  useEffect(() => {
    if (state !== 'done' || mode === 'off') return
    const prog = progRef.current
    if (!prog) return
    const from = -1000 * Math.max(0, Math.min(1, progress))
    prog.animate([{ strokeDashoffset: from }, { strokeDashoffset: 0 }], { duration: 760, easing: EASE_OUT })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  // 처음 그리기
  useLayoutEffect(() => {
    if (drawn.current) return
    drawn.current = true
    if (!drawIn || mode === 'off') return
    const prog = progRef.current
    const orbit = orbitRef.current
    const to = -1000 * Math.max(0, Math.min(1, progress))
    if (mode === 'calm') {
      prog?.parentElement?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'linear' })
      return
    }
    prog?.animate([{ strokeDashoffset: 1000 }, { strokeDashoffset: to }], { duration: 760, easing: EASE_OUT, fill: 'backwards' })
    orbit?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: 600, fill: 'backwards' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const style = { width: size, height: size, '--gx-ring-c': color ?? 'var(--accent, #FF5B2E)' } as CSSProperties
  return (
    <div className="gx-ring" style={style} data-state={state}>
      <svg viewBox="0 0 200 200" aria-hidden="true">
        <circle className="gx-track" cx="100" cy="100" r="92" />
        <circle
          ref={progRef}
          className="gx-prog"
          cx="100"
          cy="100"
          r="92"
          pathLength={1000}
          strokeDasharray="1000"
        />
        <circle className="gx-halo" cx="100" cy="100" r="92" />
        <g ref={orbitRef} className="gx-orbit">
          <circle className="gx-orb-glow" cx="192" cy="100" r="9" />
          <circle className="gx-orb" cx="192" cy="100" r="4" />
        </g>
      </svg>
      <div className="gx-ring-c">{children}</div>
    </div>
  )
}
