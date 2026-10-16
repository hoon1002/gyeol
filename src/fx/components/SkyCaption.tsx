import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import { useSkyCaption } from '../hooks'

export interface SkyCaptionProps {
  text: string
  /** 캡션을 띄울 자리 (요소 가운데 또는 화면 좌표) */
  at: RefObject<Element | null> | { x: number; y: number }
  ms?: number
  /** 바뀔 때마다 다시 띄운다 */
  showKey?: string | number
}

/** 3초 숫자 캡션(#33·#44)을 선언형으로 띄운다. 그림은 FieldProvider의 캡션 층이 그린다(opacity만) */
export function SkyCaption({ text, at, ms = 3000, showKey }: SkyCaptionProps): null {
  const { show } = useSkyCaption()
  const atRef = useRef(at)
  atRef.current = at
  useEffect(() => {
    const a = atRef.current
    const target = 'current' in a ? a.current : a
    if (target) show(text, target, ms)
  }, [show, text, ms, showKey])
  return null
}
