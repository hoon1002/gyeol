/**
 * 첫 회 안내 (design-quiet 4-2 · 리더 결정 7). 그림은 src/shell/Hint.tsx의 <Hint id="H7"/>.
 *
 *   const h = useHint('H2', active)        → { visible, dismiss }  기능마다 한 번(본 것 = 1.5초 이상 보였거나 대상에 손댐)
 *   const fresh = useHintCount('memo-ph', 3) → 처음 3번만 true      (⌘K 예시 · 메모 자리표시처럼 '처음 n번' 글)
 *   resetHints()                            → 설정 '처음 화면 다시 보기'가 첫 실행과 함께 초기화
 *
 * 뜨는 때: 그 화면에서 800ms 가만히(누르기·키·휠이 없을 때). 한 화면에 하나(전역 한 자리).
 * 미루는 때: 첫 실행(:root[data-onboarding]) · 잉크(:root[data-inking]) · 별 다가가기(:root[data-star-open]).
 * 지는 때: 대상에 손대면 바로(dismiss), 아니면 6초 뒤.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

export type HintId = 'H1' | 'H2' | 'H3' | 'H4' | 'H5' | 'H6' | 'H7' | 'H8' | 'H9' | 'H10' | (string & {})

const KEY = 'gyeol-hints'
const IDLE_MS = 800
const LIFE_MS = 6000
const SEEN_MS = 1500

type Seen = Record<string, number>

function read(): Seen {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Seen
  } catch {
    return {}
  }
}
function write(s: Seen): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* 저장소 없음: 이번 세션만 */
  }
}

let mem: Seen | null = null
const seenMap = (): Seen => (mem ??= read())
const listeners = new Set<() => void>()

export function hintCount(id: HintId): number {
  return seenMap()[id] ?? 0
}

export function markHint(id: HintId): void {
  const s = seenMap()
  s[id] = (s[id] ?? 0) + 1
  write(s)
}

/** 모든 첫 회 안내를 다시 보이게 (설정 '처음 화면 다시 보기') */
export function resetHints(): void {
  mem = {}
  write(mem)
  listeners.forEach((f) => f())
}

function deferred(): boolean {
  const r = document.documentElement
  return r.hasAttribute('data-onboarding') || r.hasAttribute('data-inking') || r.hasAttribute('data-star-open')
}

/** 전역 한 자리: 한 번에 안내 하나 */
let slot: string | null = null

export function useHint(id: HintId, active = true): { visible: boolean; dismiss: () => void } {
  const [visible, setVisible] = useState(false)
  const [epoch, setEpoch] = useState(0)
  const shownAt = useRef(0)

  useEffect(() => {
    const f = () => setEpoch((n) => n + 1)
    listeners.add(f)
    return () => {
      listeners.delete(f)
    }
  }, [])

  const close = useCallback(
    (touched: boolean) => {
      if (slot !== id) return
      slot = null
      if (touched || performance.now() - shownAt.current >= SEEN_MS) markHint(id)
      setVisible(false)
    },
    [id],
  )

  useEffect(() => {
    if (!active || hintCount(id) > 0) return
    let idle = 0
    let life = 0
    const arm = () => {
      clearTimeout(idle)
      idle = window.setTimeout(() => {
        if (slot || deferred() || hintCount(id) > 0) return arm()
        slot = id
        shownAt.current = performance.now()
        setVisible(true)
        life = window.setTimeout(() => close(false), LIFE_MS)
      }, IDLE_MS)
    }
    const poke = () => {
      if (slot !== id) arm()
    }
    arm()
    window.addEventListener('pointerdown', poke, true)
    window.addEventListener('keydown', poke, true)
    window.addEventListener('wheel', poke, { capture: true, passive: true })
    return () => {
      clearTimeout(idle)
      clearTimeout(life)
      window.removeEventListener('pointerdown', poke, true)
      window.removeEventListener('keydown', poke, true)
      window.removeEventListener('wheel', poke, true)
      close(false)
    }
  }, [id, active, epoch, close])

  return { visible, dismiss: useCallback(() => close(true), [close]) }
}

/** '처음 n번'만 보이는 글(⌘K 예시 · 메모 자리표시 · ↵ 키 그림). bump()는 한 번 보일 때마다 부른다 */
export function useHintCount(id: HintId, times: number): { fresh: boolean; bump: () => void } {
  const [, setEpoch] = useState(0)
  useEffect(() => {
    const f = () => setEpoch((n) => n + 1)
    listeners.add(f)
    return () => {
      listeners.delete(f)
    }
  }, [])
  const bump = useCallback(() => {
    if (hintCount(id) < times) {
      markHint(id)
      setEpoch((n) => n + 1)
    }
  }, [id, times])
  return { fresh: hintCount(id) < times, bump }
}
