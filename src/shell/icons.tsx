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

/* ===== M3 새 아이콘 (design-quiet 3-3: 24 격자 · 선 1.5 · round) — 문서의 New* = 코드의 Icon* ===== */

const Fill = { fill: 'currentColor', stroke: 'none' } as const
/** 왼쪽 꺾쇠 (뒤로) */
export const IconBack = (p: P) => (
  <Svg {...p}>
    <path d="M14.5 6.5L9 12l5.5 5.5" />
  </Svg>
)
export const IconCheck = (p: P) => (
  <Svg {...p}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Svg>
)
export const IconUndo = (p: P) => (
  <Svg {...p}>
    <path d="M8 5L4 9l4 4M4 9h10a5 5 0 0 1 0 10h-3" />
  </Svg>
)
export const IconStop = (p: P) => (
  <Svg {...p}>
    <rect x="7.5" y="7.5" width="9" height="9" rx="2" />
  </Svg>
)
export const IconRepeat = (p: P) => (
  <Svg {...p}>
    <path d="M19 12a7 7 0 1 1-2.05-4.95M19 4.5V9h-4.5" />
  </Svg>
)
export const IconRest = (p: P) => (
  <Svg {...p}>
    <path d="M5.5 10h11v3.5a5.5 5.5 0 0 1-11 0zM16.5 11h1.25a2.25 2.25 0 0 1 0 4.5H16M9 4.5c-.6.8.6 1.4 0 2.2M12.5 4.5c-.6.8.6 1.4 0 2.2" />
  </Svg>
)
export const IconDust = (p: P) => (
  <Svg {...p}>
    <g {...Fill}>
      <circle cx="8" cy="9" r="1.4" />
      <circle cx="15.5" cy="7" r="1" />
      <circle cx="13" cy="15.5" r="1.8" />
    </g>
  </Svg>
)
export const IconToNote = (p: P) => (
  <Svg {...p}>
    <path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5zM14 3.5v5h5M8.5 14.5h6M12 11.5l3 3-3 3" />
  </Svg>
)
export const IconTask = (p: P) => (
  <Svg {...p}>
    <rect x="4.5" y="4.5" width="15" height="15" rx="3.5" />
    <path d="M8.5 12.2l2.4 2.4 4.6-4.8" />
  </Svg>
)
export const IconArchive = (p: P) => (
  <Svg {...p}>
    <path d="M4 5.5h16v3.5H4zM5.5 9v9.5h13V9M10 12.5h4" />
  </Svg>
)
export const IconExport = (p: P) => (
  <Svg {...p}>
    <path d="M12 4v10M8 10l4 4 4-4M5 15.5v4h14v-4" />
  </Svg>
)
export const IconImport = (p: P) => (
  <Svg {...p}>
    <path d="M12 14V4M8 8l4-4 4 4M5 15.5v4h14v-4" />
  </Svg>
)
export const IconMerge = (p: P) => (
  <Svg {...p}>
    <path d="M6 4v4a5 5 0 0 0 5 5h8M6 20v-4M16 10l3 3-3 3" />
  </Svg>
)
export const IconReplace = (p: P) => (
  <Svg {...p}>
    <path d="M4 8.5h13l-3.5-3.5M20 15.5H7l3.5 3.5" />
  </Svg>
)
export const IconTrash = (p: P) => (
  <Svg {...p}>
    <path d="M5 7h14M10 7V5h4v2M7 7l.9 12.5h8.2L17 7" />
  </Svg>
)
export const IconCalendarIn = (p: P) => (
  <Svg {...p}>
    <rect x="4" y="5.5" width="16" height="14.5" rx="2.5" />
    <path d="M4 9.5h16M8.5 3.5v4M15.5 3.5v4M12 12v5.5M9.8 15.3l2.2 2.2 2.2-2.2" />
  </Svg>
)
export const IconGridDraw = (p: P) => (
  <Svg {...p}>
    <path d="M19.5 11V6.5a2 2 0 0 0-2-2h-11a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2H11M4.5 10h15M10 4.5V19.5M14 20.5l5.6-5.6 1.4 1.4-5.6 5.6H14z" />
  </Svg>
)
export const IconRoom = (p: P) => (
  <Svg {...p}>
    <path d="M6.5 20V4.8a.8.8 0 0 1 .8-.8h9.4a.8.8 0 0 1 .8.8V20M4 20h16M14.2 12v1.2" />
  </Svg>
)
export const IconFlag = (p: P) => (
  <Svg {...p}>
    <path d="M6 21V4M6 4.5h10.5l-2 3.5 2 3.5H6" />
  </Svg>
)
export const IconLink = (p: P) => (
  <Svg {...p}>
    <path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" />
  </Svg>
)
export const IconMoon = (p: P) => (
  <Svg {...p}>
    <path d="M19 14.5A7.5 7.5 0 1 1 9.5 5 6 6 0 0 0 19 14.5z" />
  </Svg>
)
export const IconSun = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6L7 7M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" />
  </Svg>
)
export const IconAuto = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="7.5" />
    <path d="M12 4.5a7.5 7.5 0 0 1 0 15z" {...Fill} />
  </Svg>
)
const WAVE = 'c2.7-3 5.3 3 8 0s5.3-3 8 0'
export const IconWave3 = (p: P) => (
  <Svg {...p}>
    <path d={`M4 8${WAVE}M4 12${WAVE}M4 16${WAVE}`} />
  </Svg>
)
export const IconWave1 = (p: P) => (
  <Svg {...p}>
    <path d={`M4 12${WAVE}`} />
  </Svg>
)
export const IconFlat = (p: P) => (
  <Svg {...p}>
    <path d="M4 12h16" />
  </Svg>
)
export const IconTravel = (p: P) => (
  <Svg {...p}>
    <path d="M5 18c2.5-7.5 9.5-10 14-8M15.5 6.5L19 10l-3.8 2.6" />
  </Svg>
)
export const IconTravelShort = (p: P) => (
  <Svg {...p}>
    <path d="M8 12h8M13 9l3 3-3 3" />
  </Svg>
)
export const IconFade = (p: P) => (
  <Svg {...p}>
    <rect x="4" y="5" width="10" height="10" rx="2" />
    <rect x="10" y="9" width="10" height="10" rx="2" opacity=".45" />
  </Svg>
)
const ORBIT = <ellipse cx="12" cy="12" rx="8.5" ry="4" transform="rotate(-30 12 12)" />
export const IconOrbit = (p: P) => (
  <Svg {...p}>
    {ORBIT}
    <circle cx="18.6" cy="8.4" r="1.5" {...Fill} />
  </Svg>
)
export const IconOrbitSlow = (p: P) => (
  <Svg {...p}>
    <ellipse cx="12" cy="12" rx="8.5" ry="4" transform="rotate(-30 12 12)" strokeDasharray="2 2.6" />
    <circle cx="18.6" cy="8.4" r="1.5" {...Fill} />
  </Svg>
)
export const IconOrbitOff = (p: P) => (
  <Svg {...p}>
    {ORBIT}
    <path d="M5 19L19 5" />
  </Svg>
)
export const IconLock = (p: P) => (
  <Svg {...p}>
    <rect x="5.5" y="10.5" width="13" height="9" rx="2" />
    <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
  </Svg>
)
export const IconStorage = (p: P) => (
  <Svg {...p}>
    <ellipse cx="12" cy="6.5" rx="6.5" ry="2.5" />
    <path d="M5.5 6.5v11c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5v-11M5.5 12c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5" />
  </Svg>
)
export const IconShield = (p: P & { filled?: boolean }) => {
  const { filled, ...rest } = p
  return (
    <Svg {...rest}>
      <path d="M12 3.5l7 3v5c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9v-5z" fill={filled ? 'currentColor' : 'none'} fillOpacity={filled ? 0.18 : undefined} />
      <path d="M9 12l2 2 4-4" />
    </Svg>
  )
}
export const IconSample = (p: P) => (
  <Svg {...p}>
    <path d="M9.5 3.5h5M10.5 3.5V9l-4.8 8.4a2 2 0 0 0 1.7 3.1h9.2a2 2 0 0 0 1.7-3.1L13.5 9V3.5M7.8 14.5h8.4" />
  </Svg>
)
export const IconReplay = (p: P) => (
  <Svg {...p}>
    <path d="M19 12a7 7 0 1 1-2.05-4.95M19 4.5V9h-4.5" />
    <path d="M12 9.6l.7 1.7 1.7.7-1.7.7-.7 1.7-.7-1.7-1.7-.7 1.7-.7z" {...Fill} />
  </Svg>
)

/* 메모 강화 · 손글씨와 함께 쓰는 이름 (손글씨 도구 칸은 src/ink/ui/icons.tsx가 이것을 가져다 쓴다) */
export const IconChecklist = (p: P) => (
  <Svg {...p}>
    <path d="M4.5 7l1.6 1.6L9 5.7M4.5 15l1.6 1.6L9 13.7M12 7.5h7.5M12 15.5h7.5" />
  </Svg>
)
export const IconPin = (p: P & { filled?: boolean }) => {
  const { filled, ...rest } = p
  return (
    <Svg {...rest}>
      <path d="M9 4h6l-1 5 3.5 3.5h-11L10 9zM12 12.5V20" fill={filled ? 'currentColor' : 'none'} fillOpacity={filled ? 0.25 : undefined} />
    </Svg>
  )
}
export const IconEraser = (p: P) => (
  <Svg {...p}>
    <path d="M8.5 19.5l-4-4a1.5 1.5 0 0 1 0-2.1l8.9-8.9a1.5 1.5 0 0 1 2.1 0l4 4a1.5 1.5 0 0 1 0 2.1L12 18.1M8.5 19.5H19M8.4 9.5l6.1 6.1" />
  </Svg>
)
export const IconLasso = (p: P) => (
  <Svg {...p}>
    <path d="M7.5 15.5C4.8 14.4 3.5 12.6 3.5 10.5c0-3.6 3.8-6 8.5-6s8.5 2.4 8.5 6-3.8 6-8.5 6c-1.2 0-2.3-.2-3.3-.5" strokeDasharray="2.6 2.4" />
    <path d="M8.7 16c-.9 1.6-.2 3.5 1.8 3.5 1.2 0 1.6-1 1-2" />
  </Svg>
)
export const IconSelect = (p: P) => (
  <Svg {...p}>
    <rect x="4.5" y="4.5" width="15" height="15" rx="3.5" strokeDasharray="3 2.4" />
    <path d="M8.5 12.2l2.4 2.4 4.6-4.8" />
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
