import type { ComponentType } from 'react'
import type { MoodName } from '@/fx'
import { IconFocus, IconGraph, IconNote, IconPlan, IconReview, IconSettings, IconToday } from './icons'

export type SpacePath = '/' | '/notes' | '/graph' | '/review' | '/planner' | '/focus' | '/settings'

export interface Space {
  path: SpacePath
  name: string
  mood: MoodName
  icon: ComponentType<{ size?: number }>
  /** 독에 놓는가 (설정은 프로필·⌘K로) */
  dock: boolean
  /** 폰 독에서 숨김 (그래프는 노트 위 토글) */
  phoneHidden?: boolean
  keywords: string[]
}

export const SPACES: Space[] = [
  { path: '/', name: '오늘', mood: 'today', icon: IconToday, dock: true, keywords: ['today', 'home', '홈', '대시보드'] },
  { path: '/notes', name: '노트', mood: 'notes', icon: IconNote, dock: true, keywords: ['notes', '필기', '문서', 'pdf'] },
  { path: '/graph', name: '그래프', mood: 'graph', icon: IconGraph, dock: true, phoneHidden: true, keywords: ['graph', '별자리', '연결', '링크'] },
  { path: '/review', name: '복습', mood: 'review', icon: IconReview, dock: true, keywords: ['review', '카드', '플래시카드', '암기'] },
  { path: '/planner', name: '플래너', mood: 'planner', icon: IconPlan, dock: true, keywords: ['planner', '시간표', '일정', '마감', 'd-day'] },
  { path: '/focus', name: '집중', mood: 'focus', icon: IconFocus, dock: true, keywords: ['focus', '타이머', '뽀모도로', '집중'] },
  { path: '/settings', name: '설정', mood: 'settings', icon: IconSettings, dock: false, keywords: ['settings', '테마', '모션', '환경'] },
]

export function spaceOf(path: string): Space {
  return SPACES.find((s) => s.path === path) ?? SPACES[0]!
}

export function spaceIndex(path: string): number {
  return Math.max(0, SPACES.findIndex((s) => s.path === path))
}
