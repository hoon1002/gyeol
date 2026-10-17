/**
 * 기억 밝기 (design-m4 5장): 노트별 그 카드들의 평균 retrievability → 밝기 b = clamp(0.40 + 0.60 × (R − 0.5)/0.45, 0.40, 1).
 * 카드가 없는(복습한 적 없는) 노트는 빠진다. 설정에서 끄면 모두 1. 하루 1번(학습일이 바뀔 때) + 복습 직후 다시 계산.
 * 하늘에는 useSkyStars({ notes: [{ id, subjectId, links, bright }] }) — 필드 이름 `bright`(0.40–1, 없으면 기억 밝기 없음).
 */
import { useEffect, useState } from 'react'
import { db, type Card } from '@/db/schema'
import { studyDayStart } from '@/lib/time'
import { useSettings } from '@/stores/settings'
import { memoryBrightOn } from './prefs'

export const BRIGHT_FLOOR = 0.4
export const brightOf = (R: number): number => Math.round(Math.min(1, Math.max(BRIGHT_FLOOR, 0.4 + (0.6 * (R - 0.5)) / 0.45)) * 1000) / 1000

const noteOf = (c: Card) => c.noteId ?? c.source?.noteId ?? null

/** 노트 id → { R, bright } */
export async function noteMemory(now = Date.now()): Promise<Map<string, { R: number; bright: number }>> {
  // FSRS(ts-fsrs)는 지연 조각 — 첫 화면에 넣지 않는다
  const { retrievability } = await import('./fsrs')
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

/* 복습한 뒤 다시 계산하라는 신호 (fsrs.rate를 부른 쪽이 알린다). 지도 · 노트가 같은 계산을 나눠 쓴다 */
const listeners = new Set<() => void>()
let ver = 0
let shared: { key: string; p: Promise<Map<string, { R: number; bright: number }>> } | null = null
export function memoryChanged(): void {
  ver++
  listeners.forEach((f) => f())
}
function sharedMemory(): Promise<Map<string, { R: number; bright: number }>> {
  const key = `${studyDayStart(Date.now()).getTime()}|${ver}|${memoryBrightOn()}`
  if (!shared || shared.key !== key) shared = { key, p: noteMemory() }
  return shared.p
}

/** 노트별 기억 밝기(학습일마다 + 복습 뒤) */
export function useNoteMemory(): Map<string, { R: number; bright: number }> | undefined {
  const [m, setM] = useState<Map<string, { R: number; bright: number }>>()
  const [tick, setTick] = useState(0)
  // 설정 '기억 밝기'를 끄면 모두 1(M2 밝기)로
  const on = useSettings((st) => st.memoryBrightness !== false)
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
    const run = () => void sharedMemory().then((v) => alive && setM(v))
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }
    if (w.requestIdleCallback) w.requestIdleCallback(run, { timeout: 3000 })
    else window.setTimeout(run, 400)
    return () => {
      alive = false
    }
  }, [tick, on])
  return m
}

/** 하늘 노트 별에 기억 밝기를 얹는다: 카드가 있는 노트만 `bright`(0.40–1)가 붙는다 */
export function withBright<T extends { id: string }>(notes: T[], m: Map<string, { bright: number }> | undefined): Array<T & { bright?: number }> {
  if (!m || !m.size) return notes
  return notes.map((n) => {
    const b = m.get(n.id)
    return b ? { ...n, bright: b.bright } : n
  })
}
