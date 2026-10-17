/** 아이콘: 24px 그리드, 선 1.6px, 둥근 끝 (design.md 5장). 장식이므로 aria-hidden. */
import type { SVGProps } from 'react'

type P = SVGProps<SVGSVGElement> & { size?: number }

function Svg({ size = 22, children, ...rest }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...rest}>
      {children}
    </svg>
  )
}

export const IconToday = (p: P) => (
  <Svg {...p}>
    {/* 지평선 + 별 */}
    <path d="M3 17.5h18" />
    <path d="M6 20.5h12" opacity=".5" />
    <path d="M12 5.5v5M9.5 8h5" />
    <path d="M10.6 6.6l2.8 2.8M13.4 6.6l-2.8 2.8" strokeWidth={0.9} opacity=".6" />
  </Svg>
)
export const IconNote = (p: P) => (
  <Svg {...p}>
    <path d="M6.5 3.5h8L19 8v11a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19V5a1.5 1.5 0 0 1 1.5-1.5z" />
    <path d="M14 3.5V8h4.5M8.5 12.5h7M8.5 16h5" />
  </Svg>
)
/** 지도(← 그래프): 이어진 별 세 개 */
export const IconMap = (p: P) => (
  <Svg {...p}>
    <circle cx="6" cy="7" r="2.2" />
    <circle cx="18" cy="6" r="2.2" />
    <circle cx="12" cy="17.5" r="2.6" />
    <path d="M7.9 8.6l2.8 6.6M16.8 7.9l-3.5 7.3M8.2 6.8l7.6-.6" />
  </Svg>
)
export const IconReview = (p: P) => (
  <Svg {...p}>
    <rect x="4" y="6.5" width="13" height="14" rx="2.2" />
    <path d="M8 3.5h9.5A2.5 2.5 0 0 1 20 6v11" />
  </Svg>
)
export const IconPlan = (p: P) => (
  <Svg {...p}>
    <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </Svg>
)
export const IconFocus = (p: P) => (
  <Svg {...p}>
    {/* 모래시계 */}
    <path d="M6.5 3.5h11M6.5 20.5h11" />
    <path d="M7.5 3.5c0 4.5 4.5 5.5 4.5 8.5s-4.5 4-4.5 8.5M16.5 3.5c0 4.5-4.5 5.5-4.5 8.5s4.5 4 4.5 8.5" />
    <path d="M10 18.5h4" opacity=".6" />
  </Svg>
)
export const IconCmd = (p: P) => (
  <Svg {...p}>
    <path d="M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3z" />
  </Svg>
)
export const IconSearch = (p: P) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M16 16l4 4" />
  </Svg>
)
export const IconArrow = (p: P) => (
  <Svg strokeWidth={1.8} {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Svg>
)
export const IconTheme = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 3.5a8.5 8.5 0 0 0 0 17z" fill="currentColor" />
  </Svg>
)
export const IconMotion = (p: P) => (
  <Svg {...p}>
    <path d="M3 12c2.5-4 5-4 7.5 0s5 4 7.5 0 2-3 3-3" />
    <path d="M3 17c2.5-3 5-3 7.5 0s5 3 7.5 0" opacity=".55" />
  </Svg>
)
export const IconPen = (p: P) => (
  <Svg {...p}>
    <path d="M14.5 5.5l4 4L9 19H5v-4z" />
    <path d="M12.5 7.5l4 4" />
  </Svg>
)
export const IconDoc = (p: P) => (
  <Svg {...p}>
    <path d="M6.5 3.5h11A1.5 1.5 0 0 1 19 5v14a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19V5a1.5 1.5 0 0 1 1.5-1.5z" />
    <path d="M8.5 8h7M8.5 11.5h7M8.5 15h4" />
  </Svg>
)
export const IconPdf = (p: P) => (
  <Svg {...p}>
    <path d="M6.5 3.5h8L19 8v11a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19V5a1.5 1.5 0 0 1 1.5-1.5z" />
    <path d="M8 16.5v-4h1.5a1.3 1.3 0 0 1 0 2.6H8M12.5 16.5v-4h1a2 2 0 0 1 0 4zM16.5 12.5H15v4M15 14.5h1.3" strokeWidth={1.2} />
  </Svg>
)
export const IconDeck = (p: P) => (
  <Svg {...p}>
    <rect x="5" y="7" width="12" height="13" rx="2" />
    <path d="M8 4h9a2 2 0 0 1 2 2v10" />
  </Svg>
)
export const IconLens = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8" />
    <circle cx="12" cy="12" r="3.2" />
  </Svg>
)
export const IconSettings = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8" />
  </Svg>
)
/** 상단 점 3개 — 설정 시트 */
export const IconMore = (p: P) => (
  <Svg {...p}>
    <circle cx="5.5" cy="12" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="18.5" cy="12" r="1.1" fill="currentColor" stroke="none" />
  </Svg>
)
export const IconPlus = (p: P) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
)
export const IconMic = (p: P) => (
  <Svg {...p}>
    <rect x="9" y="3.5" width="6" height="11" rx="3" />
    <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
  </Svg>
)
export const IconChevron = (p: P) => (
  <Svg {...p}>
    <path d="M7 10l5 5 5-5" />
  </Svg>
)
export const IconPause = (p: P) => (
  <Svg {...p}>
    <path d="M9 6v12M15 6v12" strokeWidth={2} />
  </Svg>
)
export const IconPlay = (p: P) => (
  <Svg {...p}>
    <path d="M8 5.5v13l10.5-6.5z" />
  </Svg>
)
export const IconClose = (p: P) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
)

/** 결 심볼 v3: 57° 사선 위 별 5개(은하의 결) + 인주 점 하나(낙관) */
export function Symbol({ size = 26, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false" className={className}>
      <g fill="currentColor">
        <circle cx="7.6" cy="27.4" r="1.1" opacity=".55" />
        <circle cx="11" cy="22.2" r="1.5" opacity=".8" />
        <circle cx="14.6" cy="16.6" r="1.2" opacity=".7" />
        <path d="M19.2 6.6l.85 2.75 2.75.85-2.75.85-.85 2.75-.85-2.75-2.75-.85 2.75-.85z" />
        <circle cx="24.4" cy="2.9" r=".9" opacity=".5" />
      </g>
      <circle cx="25.6" cy="21.4" r="1.6" fill="var(--seal, #FF8F78)" />
    </svg>
  )
}
