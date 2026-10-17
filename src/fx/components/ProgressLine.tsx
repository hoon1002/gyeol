import { useEffect, useRef, type CSSProperties } from 'react'

export interface ProgressLineProps {
  /** 0..1 */
  value: number
  /** 읽어 주는 글 (예: "일반물리 수업, 43분 남음") — 화면에는 보이지 않는다 */
  label?: string
  /** 'quiet' = 조용한 색(휴식·수업), 'star' = 별빛 금(집중) */
  tone?: 'quiet' | 'star'
  width?: number | string
  /** 지금 표시(1×7px)를 그릴지 (기본 true) */
  now?: boolean
  className?: string
}

/**
 * 가로 1px 진행선 + 지금 표시 1×7px (design-v3 · design-v3-motion #10·16·42). FocusRing을 대체한다.
 * 움직임은 선의 길이뿐(1초 linear). 동작 줄이기면 즉시.
 * 전력(power-budget §4-9): 지금 표시도 transform(합성 스레드)으로 움직이고, 한 걸음이 1px 미만(집중 1초 틱 = 0.1–0.3px)이면
 * 전환 없이 바로 옮긴다 — 1초 전환이 매초 다시 걸려 화면 주사율로 끝없이 도는 것을 막는다(보이는 결과 같음).
 */
export function ProgressLine({ value, label, tone = 'star', width = '100%', now = true, className }: ProgressLineProps) {
  const v = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0))
  const ref = useRef<HTMLDivElement>(null)
  const widthPx = useRef(0)
  const prev = useRef(v)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    widthPx.current = el.getBoundingClientRect().width
    const ro = new ResizeObserver((es) => {
      const w = es[0]?.contentRect.width
      if (w !== undefined) widthPx.current = w
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  useEffect(() => {
    prev.current = v
  }, [v])
  // eslint-disable-next-line react-hooks/refs -- 마지막으로 잰 폭·직전 값만 읽는다(렌더 결과는 클래스 하나)
  const stepPx = Math.abs(v - prev.current) * widthPx.current
  const subPixel = stepPx > 0 && stepPx < 1
  const style = { width, '--gx-pl': v } as CSSProperties
  return (
    <div
      ref={ref}
      className={'gx-progress' + (tone === 'quiet' ? ' is-quiet' : '') + (subPixel ? ' is-step' : '') + (className ? ' ' + className : '')}
      style={style}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(v * 100)}
      aria-label={label}
      title={label}
    >
      <span className="gx-progress-fill" />
      {now && <span className="gx-progress-now" />}
    </div>
  )
}
