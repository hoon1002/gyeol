import type { Mood, MoodName } from './types'

/**
 * 공간별 프리셋 (design-v2 §5-1). 가로(landscape) 기준 좌표.
 * 세로 화면·폰에서는 PORTRAIT_KNOTS가 옹이 위치를 대신한다(override.knot을 주면 그쪽이 우선).
 */
export const MOODS: Record<MoodName, Mood> = {
  landing: { speed: 1.0, step: 0.085, aniso: [0.55, 1.45], knot: [0.64, 0.44], knotStrength: 1.0, rings: 3 },
  today: { speed: 1.0, step: 0.09, aniso: [0.55, 1.45], knot: [0.7, 0.44], knotStrength: 0.9, breath: true },
  notes: { speed: 0.35, step: 0.14, aniso: [1.6, 0.5], knot: null, knotStrength: 0, dim: 0.8 },
  graph: {
    speed: 0.6,
    step: 0.1,
    aniso: [1, 1],
    knots: [
      [0.3, 0.35],
      [0.68, 0.3],
      [0.5, 0.7],
    ],
    knotStrength: 0.6,
    tintAmount: 0.7,
    dim: 0.85,
  },
  review: { speed: 0.8, step: 0.09, aniso: [0.8, 1.2], knot: [0.5, 0.42], knotStrength: 0.7 },
  planner: { speed: 0.5, step: 0.11, aniso: [0.4, 1.8], knot: [0.5, 0.5], knotStrength: 0.5, tintAmount: 0.4 },
  map: { speed: 0.6, step: 0.1, aniso: [1, 1], knots: [[0.3, 0.35], [0.68, 0.3], [0.5, 0.7]], knotStrength: 0.6, tintAmount: 0.7, dim: 0.85 },
  plan: { speed: 0.5, step: 0.11, aniso: [0.4, 1.8], knot: [0.5, 0.5], knotStrength: 0.5, tintAmount: 0.4 },
  onboarding: { speed: 1.0, step: 0.09, aniso: [0.55, 1.45], knot: [0.62, 0.42], knotStrength: 0.9 },
  focus: { speed: 0.25, step: 0.12, aniso: [1, 1], knot: [0.5, 0.46], knotStrength: 1.0, breath: true, dim: 0.8 },
  settings: { speed: 0.4, step: 0.1, aniso: [0.55, 1.45], knot: [0.72, 0.4], knotStrength: 0.5 },
}

/** 세로 화면(높이 > 너비) 또는 폭 600 미만에서 쓰는 옹이 위치 (design-v2 §3 와이어프레임) */
export const PORTRAIT_KNOTS: Partial<Record<MoodName, [number, number]>> = {
  landing: [0.5, 0.3],
  today: [0.5, 0.24],
  review: [0.5, 0.3],
  planner: [0.5, 0.36],
  settings: [0.5, 0.2],
}
