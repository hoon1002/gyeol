/** 셸 공용 훅 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { useRouter } from '@tanstack/react-router'
import { flightMs, useFieldTransition, type MotionLevel } from '@/fx'
import { useSettings } from '@/stores/settings'
import { useUi } from '@/stores/ui'
import { spaceIndex, type SpacePath } from './spaces'

/* ---------- 미디어 쿼리 ---------- */

export function useMediaQuery(q: string): boolean {
  const subscribe = useCallback(
    (cb: () => void) => {
      let mq: MediaQueryList | null = null
      try {
        mq = matchMedia(q)
        mq.addEventListener('change', cb)
      } catch {
        /* noop */
      }
      return () => mq?.removeEventListener('change', cb)
    },
    [q],
  )
  return useSyncExternalStore(
    subscribe,
    () => {
      try {
        return matchMedia(q).matches
      } catch {
        return false
      }
    },
    () => false,
  )
}

export const useOsReducedMotion = () => useMediaQuery('(prefers-reduced-motion: reduce)')
export const useIsPhone = () => useMediaQuery('(max-width: 599px)')
export const useIsDesktop = () => useMediaQuery('(min-width: 1200px)')

/** 실제 적용 모션 수준: OS '동작 줄이기'면 off */
export function useEffectiveMotion(): MotionLevel {
  const pref = useSettings((s) => s.motion)
  const os = useOsReducedMotion()
  return os ? 'off' : pref
}

/* ---------- 이동 (결 와이프로 감싼 라우터 이동) ---------- */

/** 장소 좌표 (design-v3-camera §1, iPad 값) — 글자 들어오는 시점 = 비행 길이 D − 320ms */
const PLACE: Record<string, { x: number; y: number; z: number }> = {
  '/': { x: 0.5, y: 0.5, z: 1 },
  '/settings': { x: 0.5, y: 0.5, z: 1 },
  '/planner': { x: 0.55, y: 0.47, z: 0.88 },
  '/notes': { x: 0.4, y: 0.74, z: 1.4 },
  '/review': { x: 0.66, y: 0.5, z: 1.9 },
  '/graph': { x: 0.7, y: 0.36, z: 2.3 },
  '/focus': { x: 0.48, y: 0.33, z: 3.0 },
}

function setEnterDelay(from: string, to: string, flying: boolean) {
  const a = PLACE[from]
  const b = PLACE[to]
  const ms = flying && a && b ? Math.max(170, flightMs(a, b) - 320) : 170
  document.documentElement.style.setProperty('--enter-base', `${ms}ms`)
}

export function useGo() {
  const transition = useFieldTransition()
  const router = useRouter()
  const level = useEffectiveMotion()
  const travel = useSettings((s) => s.travel)
  return useCallback(
    (to: SpacePath, origin?: Element | { x: number; y: number } | null) => {
      const cur = router.state.location.pathname
      if (cur === to) {
        window.scrollTo({ top: 0, behavior: 'smooth' })
        return Promise.resolve()
      }
      const direction = spaceIndex(to) >= spaceIndex(cur) ? 'forward' : 'back'
      setEnterDelay(cur, to, level === 'rich' && travel === 'fly')
      return transition(
        async () => {
          await router.navigate({ to })
          window.scrollTo(0, 0)
        },
        { origin: origin ?? undefined, direction },
      )
    },
    [router, transition, level, travel],
  )
}

/* ---------- 스크롤로 크롬 숨기기 ---------- */

export function useScrollHide(): void {
  const setHidden = useUi((s) => s.setScrollHidden)
  useEffect(() => {
    let last = window.scrollY
    let raf = 0
    const onScroll = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        const y = window.scrollY
        const dy = y - last
        if (Math.abs(dy) < 4) return
        setHidden(y > 80 && dy > 0)
        last = y
      })
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [setHidden])
}

/* ---------- CSS 변수 실제 값 (필드 tint는 CSS 색 문자열이 필요) ---------- */

export function useCssColor(varName: string | null, themeKey: string): string | undefined {
  const [v, setV] = useState<string | undefined>(undefined)
  useEffect(() => {
    if (!varName) {
      setV(undefined)
      return
    }
    const name = varName.startsWith('var(') ? varName.slice(4, -1) : varName
    const val = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    setV(val || undefined)
  }, [varName, themeKey])
  return v
}

/* ---------- 입력 중인가 (단축키 무시) ---------- */

export function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}
