/**
 * 기억 밝기 (design-m4 5장): 노트별 그 카드들의 평균 retrievability → 밝기 b = clamp(0.40 + 0.60 × (R − 0.5)/0.45, 0.40, 1).
 * 카드가 없는(복습한 적 없는) 노트는 빠진다. 설정에서 끄면 모두 1. 하루 1번(학습일이 바뀔 때) + 복습 직후 다시 계산.
 * 하늘에는 useSkyStars({ notes: [{ id, subjectId, links, bright }] }) — 필드 이름 `bright`(0.40–1, 없으면 기억 밝기 없음).
 */
import { useEffect, useState } from 'react'
import { db, type Card } from '@/db/schema'
import { studyDayStart } from '@/lib/time'
import { retrievability } from './fsrs'
import { memoryBrightOn } from './prefs'

export const BRIGHT_FLOOR = 0.4
export const brightOf = (R: number): number => Math.min(1, Math.max(BRIGHT_FLOOR, 0.4 + (0.6 * (R - 0.5)) / 0.45))

const noteOf = (c: Card) => c.noteId ?? c.source?.noteId ?? null

/** 노트 id → { R, bright } */
export async function noteMemory(now = Date.now()): Promise<Map<string, { R: number; bright: number }>> {
  const cards = await db.cards.filter((c) => !c.suspended && !!noteOf(c)).toArray()
  const sum = new Map<string, { s: number; n: number }>()
  for (const c of cards) {
    const r = retrievability(c, now)
    if (r == null) continue
    const id = noteOf(c)!
    const a = sum.get(id) ?? { s: 0, n: 0 }
    a.s += r
    a.n++
    sum.set(id, a)
  }
  const on = memoryBrightOn()
  const out = new Map<string, { R: number; bright: number }>()
  sum.forEach((v, id) => {
    const R = v.s / v.n
    out.set(id, { R, bright: on ? brightOf(R) : 1 })
  })
  return out
}

/* 복습한 뒤 다시 계산하라는 신호 (fsrs.rate를 부른 쪽이 알린다) */
const listeners = new Set<() => void>()
export function memoryChanged(): void {
  listeners.forEach((f) => f())
}

/** 노트별 기억 밝기(학습일마다 + 복습 뒤) */
export function useNoteMemory(): Map<string, { R: number; bright: number }> | undefined {
  const [m, setM] = useState<Map<string, { R: number; bright: number }>>()
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const f = () => setTick((n) => n + 1)
    listeners.add(f)
    // 학습일이 바뀌면(새벽 4시) 다시
    const day = studyDayStart(Date.now()).getTime()
    const iv = window.setInterval(() => studyDayStart(Date.now()).getTime() !== day && f(), 10 * 60_000)
    return () => {
      listeners.delete(f)
      window.clearInterval(iv)
    }
  }, [])
  useEffect(() => {
    let alive = true
    const run = () => void noteMemory().then((v) => alive && setM(v))
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }
    if (w.requestIdleCallback) w.requestIdleCallback(run, { timeout: 3000 })
    else window.setTimeout(run, 400)
    return () => {
      alive = false
    }
  }, [tick])
  return m
}
