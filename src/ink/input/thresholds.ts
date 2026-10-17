/**
 * 입력 판정 숫자 (design-ink 0-2). 엔진과 앱(노트 화면 · 메모 칸)이 이 값만 쓴다. 다른 곳에 숫자를 두지 않는다.
 * 거리는 화면 CSS px, 시간은 ms.
 */
export const INK_THRESHOLDS = {
  /** 누르기 / 끌기: 이동 < 6px이고 길게 누르기 전에 떼면 누르기. 넘으면 끌기(끌기 뒤 click은 버림) */
  tapMove: 6,
  /** 여러 손가락 탭은 250ms 안 */
  multiTapMs: 250,
  /** 손가락 길게 누르기 */
  fingerLongMs: 450,
  fingerLongMove: 10,
  /** 펜 길게 누르기(빈 곳): 600ms, 이동 < 4px. 300ms부터 고리 예고 */
  penLongMs: 600,
  penLongMove: 4,
  penRingFromMs: 300,
  /** 마우스 왼쪽 길게 누르기 (오른쪽 클릭은 즉시) */
  mouseLongMs: 600,
  /** 두 손가락 탭: 내려온 시각 차 ≤ 80ms, 둘 다 250ms 안에 뗌, 각 이동 < 10px, 거리 변화 < 6% */
  twoTapDownSpread: 80,
  threeTapDownSpread: 100,
  tapFingerMove: 10,
  tapDistChange: 0.06,
  /** 두 손가락 대고 있기: 600ms 뒤부터 120ms마다 되돌리기 */
  holdUndoMs: 600,
  holdUndoEvery: 120,
  /** 핀치: 거리 변화 ≥ 6%, 두 손가락 끌기: 중점 이동 ≥ 10px */
  pinchDist: 0.06,
  panMove: 10,
  /** 한 손가락 이동(펜만 쓰기) 시작 */
  scrollSlop: 6,
  /** 확대 범위 (맞춤 100% 기준), 뗐을 때 94–106%면 100%로 붙는다(200ms) */
  zoomMin: 0.5,
  zoomMax: 4,
  zoomSnapLo: 0.94,
  zoomSnapHi: 1.06,
  zoomSnapMs: 200,
  /** 도형 다듬기: 획 끝에서 500ms 멈춤, 이동 < 4px */
  shapeHoldMs: 500,
  shapeHoldMove: 4,
  /** 형광펜 곧게: 끝에서 300ms 멈춤, 또는 벗어난 폭 < 길이의 6% */
  hlStraightHoldMs: 300,
  hlStraightDev: 0.06,
  /** 가장자리 밀기: 손가락, 시작 x ≤ 20px, 가로 ≥ 24px, 가로/세로 > 1.5, 처음 120ms 안 */
  edgeStartX: 20,
  edgeMove: 24,
  edgeRatio: 1.5,
  edgeWithinMs: 120,
  /** 손바닥: 접점 width·height > 40px 버림. 펜 뗀 뒤 300ms 동안 펜 마지막 점 120px 안 손가락 무시 */
  palmSize: 40,
  palmAfterPenMs: 300,
  palmNearPen: 120,
  /** 빈 곳: 누른 점 12px 안에 획·물건이 없음 */
  emptyRadius: 12,
  /** 손가락 쓰기 중 두 번째 손가락이 이 안에 오면 쓰던 획을 버리고 제스처로 */
  secondFingerMs: 160,
  /** 긁어 지우기 (design-ink 4-3) */
  scratchReversals: 4,
  scratchReversalSpan: 6,
  scratchDensity: 3,
  scratchMaxMs: 1500,
  scratchCover: 0.6,
  scratchHullPad: 4,
  /** 고르기(길게 누름): 24pt 안에 이어진 획 묶음 */
  clusterGap: 24,
  /** 회전 손잡이 자석: 15°마다 ±3° */
  rotateSnapStep: 15,
  rotateSnapWithin: 3,
  /** 손잡이 누르는 영역 */
  handleHit: 32,
  /** 쓰기 활동 끝으로 보는 시간 (하늘 쉼 · data-inking) */
  activeTailMs: 2000,
} as const

export type InkThresholds = typeof INK_THRESHOLDS
