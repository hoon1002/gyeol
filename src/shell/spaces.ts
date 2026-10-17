/**
 * 장소 v4 (plan-v4-final 3-4): 오늘 · 노트 · 지도 · 복습 · 계획 · 집중. 설정은 장소가 아니라 시트(SettingsSheet).
 * 옛 주소 /graph → /map, /planner → /plan, /settings → 오늘 위 설정 시트 (router.tsx).
 */
import type { ComponentType } from 'react'
import type { MoodName } from '@/fx'
import { IconFocus, IconMap, IconNote, IconPlan, IconReview, IconToday } from './icons'

export type SpacePath = '/' | '/notes' | '/map' | '/review' | '/plan' | '/focus'

export interface Space {
  path: SpacePath
  name: string
  mood: MoodName
  icon: ComponentType<{ size?: number }>
  /** 폰(< 768) 아래 독에 놓는가. 지도는 노트 위 토글, 계획은 오늘 맨 아래 줄 */
  phoneDock: boolean
  /** 빈 하늘 드래그 트랙볼 (useSkyDrag). 글 쓰기·카드 조작 장소는 끈다 */
  drag: boolean
  keywords: string[]
}

/**
 * 하늘 preset 이름. 계약은 'map'·'plan'이지만 @/fx의 MoodName에 아직 없어서 옛 이름을 쓴다(fx는 같은 장소로 보낸다).
 * TODO(M1·fx 대기): MoodName에 'map'·'plan'이 생기면 두 줄만 바꾼다.
 */
export const MAP_MOOD: MoodName = 'graph'
export const PLAN_MOOD: MoodName = 'planner'

export const SPACES: Space[] = [
  { path: '/', name: '오늘', mood: 'today', icon: IconToday, phoneDock: true, drag: true, keywords: ['today', 'home', '홈'] },
  { path: '/notes', name: '노트', mood: 'notes', icon: IconNote, phoneDock: true, drag: false, keywords: ['notes', '필기', '문서', 'pdf'] },
  { path: '/map', name: '지도', mood: MAP_MOOD, icon: IconMap, phoneDock: false, drag: true, keywords: ['map', 'graph', '그래프', '별자리', '연결', '링크', '나의 은하'] },
  { path: '/review', name: '복습', mood: 'review', icon: IconReview, phoneDock: true, drag: false, keywords: ['review', '카드', '플래시카드', '암기'] },
  { path: '/plan', name: '계획', mood: PLAN_MOOD, icon: IconPlan, phoneDock: false, drag: false, keywords: ['plan', 'planner', '플래너', '시간표', '일정', '마감', 'd-day'] },
  { path: '/focus', name: '집중', mood: 'focus', icon: IconFocus, phoneDock: true, drag: true, keywords: ['focus', '타이머', '뽀모도로'] },
]

export function spaceOf(path: string): Space {
  return SPACES.find((s) => s.path === path) ?? SPACES[0]!
}

export function spaceIndex(path: string): number {
  return Math.max(0, SPACES.findIndex((s) => s.path === path))
}

export function isSpacePath(path: string): path is SpacePath {
  return SPACES.some((s) => s.path === path)
}
