import type { CSSProperties } from 'react'

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
 */
export function ProgressLine({ value, label, tone = 'star', width = '100%', now = true, className }: ProgressLineProps) {
  const v = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0))
  const style = { width, '--gx-pl': v } as CSSProperties
  return (
    <div
      className={'gx-progress' + (tone === 'quiet' ? ' is-quiet' : '') + (className ? ' ' + className : '')}
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
