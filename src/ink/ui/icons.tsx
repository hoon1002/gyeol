/** 손글씨 전용 아이콘 (24 격자 · 선 1.5 · 둥근 끝, src/shell/icons.tsx와 같은 규격). 공용은 shell에서 가져다 쓴다. */
import type { SVGProps } from 'react'

type P = SVGProps<SVGSVGElement> & { size?: number }

function Svg({ size = 22, children, ...rest }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...rest}>
      {children}
    </svg>
  )
}

export const IconInkPen = (p: P) => (
  <Svg {...p}>
    <path d="M16.5 3.5l4 4L9 19l-5 1.5L5.5 15.5z" />
    <path d="M14 6l4 4" />
  </Svg>
)
export const IconFountain = (p: P) => (
  <Svg {...p}>
    <path d="M12 2.5l5 7-5 12-5-12z" />
    <path d="M12 9.5v6" />
    <circle cx="12" cy="9.5" r="1" />
  </Svg>
)
export const IconPencil = (p: P) => (
  <Svg {...p}>
    <path d="M15.5 4.5l4 4L8 20H4v-4z" />
    <path d="M4 16l4 4M13 7l4 4" />
  </Svg>
)
export const IconHighlighter = (p: P) => (
  <Svg {...p}>
    <path d="M14.5 4l5.5 5.5-8 8-4-.5-.5-4z" />
    <path d="M7.5 13l-3.5 3.5 2.5 2.5 1.5-1.5" />
    <path d="M14 20.5h6" />
  </Svg>
)
export const IconEraserPart = (p: P) => (
  <Svg {...p}>
    <path d="M14 4.5l5.5 5.5-8 8H7l-3-3z" />
    <path d="M9 9.5l5.5 5.5" />
    <path d="M13 20h2M17 20h2M9 20h2" />
  </Svg>
)
export const IconTape = (p: P) => (
  <Svg {...p}>
    <path d="M4 8l1-1-1-1h16l-1 1 1 1-1 1 1 1-1 1 1 1-1 1 1 1-1 1 1 1H4l1-1-1-1 1-1-1-1 1-1-1-1 1-1z" transform="translate(0 2) scale(1 .7)" />
  </Svg>
)
export const IconShape = (p: P) => (
  <Svg {...p}>
    <path d="M9 4l6.5 11h-13z" />
    <circle cx="16" cy="15" r="4.5" />
  </Svg>
)
export const IconTextBox = (p: P) => (
  <Svg {...p}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
    <path d="M8 9h8M12 9v7" />
  </Svg>
)
export const IconImage = (p: P) => (
  <Svg {...p}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="M20.5 16l-5-5-8.5 8.5" />
  </Svg>
)
export const IconPaste = (p: P) => (
  <Svg {...p}>
    <rect x="5" y="4.5" width="14" height="16" rx="2" />
    <path d="M9 4.5V3.5h6v1M9 11h6M9 15h4" />
  </Svg>
)
export const IconPageAdd = (p: P) => (
  <Svg {...p}>
    <path d="M6.5 3.5h7L18 8v12.5H6.5z" />
    <path d="M12.2 11v6M9.2 14h6" />
  </Svg>
)
export const IconTemplate = (p: P) => (
  <Svg {...p}>
    <rect x="5.5" y="3.5" width="13" height="17" rx="1.5" />
    <path d="M8.5 8.5h7M8.5 12h7M8.5 15.5h7" />
  </Svg>
)
export const IconDrawer = (p: P) => (
  <Svg {...p}>
    <rect x="8" y="3.5" width="12" height="15" rx="1.5" />
    <path d="M5 6v13.5a1.5 1.5 0 0 0 1.5 1.5H16" />
  </Svg>
)
export const IconPdfIn = (p: P) => (
  <Svg {...p}>
    <path d="M6.5 3.5h7L18 8v12.5H6.5z" />
    <path d="M12 10v6M9.5 13.5L12 16l2.5-2.5" />
  </Svg>
)
export const IconShare = (p: P) => (
  <Svg {...p}>
    <path d="M7 10H5.5v10.5h13V10H17" />
    <path d="M12 14V3.5M8.5 7L12 3.5 15.5 7" />
  </Svg>
)
export const IconRedo = (p: P) => (
  <Svg {...p}>
    <path d="M15 8.5h-6a5 5 0 0 0 0 10h4" />
    <path d="M12.5 5L16 8.5 12.5 12" />
  </Svg>
)
export const IconUndoInk = (p: P) => (
  <Svg {...p}>
    <path d="M9 8.5h6a5 5 0 0 1 0 10h-4" />
    <path d="M11.5 5L8 8.5l3.5 3.5" />
  </Svg>
)
export const IconFinger = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="9" r="4.5" />
    <path d="M12 13.5V21" />
  </Svg>
)
export const IconScratch = (p: P) => (
  <Svg {...p}>
    <path d="M4 15l4-6 3 7 3-8 3 7 3-5" />
  </Svg>
)
export const IconUnsure = (p: P) => (
  <Svg {...p}>
    <path d="M3.5 8.5h17v7h-17z" />
    <circle cx="17" cy="12" r="1.2" fill="currentColor" />
  </Svg>
)
export const IconHand = (p: P) => (
  <Svg {...p}>
    <path d="M8 12V6.5a1.5 1.5 0 0 1 3 0V11M11 10.5V5a1.5 1.5 0 0 1 3 0v5.5M14 10.5V6.5a1.5 1.5 0 0 1 3 0V14a6 6 0 0 1-6 6h-.5a5 5 0 0 1-4-2l-2.8-3.8a1.4 1.4 0 0 1 2.2-1.8L8 14" />
  </Svg>
)
export const IconCopy = (p: P) => (
  <Svg {...p}>
    <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
    <path d="M15.5 8.5v-3h-11v11h3" />
  </Svg>
)
export const IconDuplicate = (p: P) => (
  <Svg {...p}>
    <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
    <path d="M15.5 8.5v-3h-11v11h3M14 11.5v5M11.5 14h5" />
  </Svg>
)
export const IconCut = (p: P) => (
  <Svg {...p}>
    <circle cx="6.5" cy="17.5" r="2.5" />
    <circle cx="17.5" cy="17.5" r="2.5" />
    <path d="M8.5 16L18 4.5M15.5 16L6 4.5" />
  </Svg>
)
export const IconColorDot = ({ color, size = 22, ring }: { color: string; size?: number; ring?: boolean }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    {ring && <circle cx="12" cy="12" r="11" fill="none" stroke="currentColor" strokeWidth="1.5" />}
    <circle cx="12" cy="12" r={ring ? 7.5 : 10} fill={color} />
  </svg>
)
