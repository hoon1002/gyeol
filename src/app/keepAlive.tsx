/**
 * 7개 공간 keep-alive: 한 번 마운트한 화면은 지우지 않고 보이기만 바꾼다(비활성 = hidden + inert).
 * 공간 전환 첫 프레임에서 React 마운트 비용을 없애기 위함(리더 측정 25–41ms → 목표 ≤ 20ms).
 * 비활성 화면은 하늘에 아무것도 말하지 않는다: FieldMood·useFieldData·useSkyStars는 활성일 때만.
 */
import { createContext, useContext, useEffect, useRef } from 'react'
import { FieldMood, useFieldData, useSkyStars, type FieldData, type FieldMoodProps, type SkyStarsSpec } from '@/fx'

export const ActiveContext = createContext(true)

/** 이 화면이 지금 보이는 공간인가 */
export function useActive(): boolean {
  return useContext(ActiveContext)
}

function SkyData(props: FieldData): null {
  useFieldData(props)
  return null
}

function Stars({ spec }: { spec: SkyStarsSpec }): null {
  useSkyStars(spec)
  return null
}

function Leave({ fn }: { fn: () => void }): null {
  const ref = useRef(fn)
  ref.current = fn
  useEffect(() => () => ref.current(), [])
  return null
}

/**
 * 활성일 때만 하늘에 말한다(잎 컴포넌트라 화면 전체는 다시 그려지지 않는다).
 * data = 데이터 별 값, stars = 데이터 별 층(비활성이 되면 마지막 상태 유지), onLeave = 이 공간을 떠날 때 한 번.
 */
export function ActiveMood({ data, stars, onLeave, ...props }: FieldMoodProps & { data?: FieldData; stars?: SkyStarsSpec; onLeave?: () => void }) {
  const active = useActive()
  // 같은 별 층을 다시 활성화할 때는 다시 동기화하지 않는다(전환 첫 프레임 비용 절약)
  const synced = useRef<string | null>(null)
  const starsKey = stars ? JSON.stringify(stars) : null
  const needSync = !!stars && starsKey !== synced.current
  useEffect(() => {
    if (active && needSync) synced.current = starsKey
  })
  if (!active) return null
  return (
    <>
      <FieldMood {...props} />
      {data && <SkyData {...data} />}
      {needSync && <Stars spec={stars!} />}
      {onLeave && <Leave fn={onLeave} />}
    </>
  )
}

const NO_STARS: SkyStarsSpec = {}

/** 활성일 때만 데이터 별 층을 동기화(비활성이면 마지막 상태 유지) */
export function useActiveSkyStars(spec: SkyStarsSpec): void {
  useSkyStars(useActive() ? spec : NO_STARS)
}
