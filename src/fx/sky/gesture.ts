/**
 * 누르기 ↔ 끌기 구분 (M3): 하늘에서 시작한 끌기 · 두 손가락(핀치) · 관성 회전 · 휠/트랙패드 핀치 뒤에 브라우저가 보내는
 * click을 '하늘 끌기 끝'으로 표시한다. 앱(StarPress 등)은 isSkyDragClick(e)가 참이면 그 click을 '빈 하늘 누르기'로 보지 않는다.
 * 3D · 2.5D 어느 쪽이든 같은 규칙(창 캡처 단계에서 본다 — 앱의 click 처리보다 먼저).
 */
const marked = new WeakSet<Event>()

/** 이 click이 끌기·핀치·관성·휠 뒤에 온 것인가 */
export function isSkyDragClick(e: Event): boolean {
  return marked.has(e)
}

const MOVE_MOUSE = 6 // px
const MOVE_TOUCH = 10 // px
const SPIN_DEG_S = 20 // 손을 뗄 때 이 속도 이상으로 돌고 있으면(관성) 끌기
const WHEEL_MS = 350 // 휠·트랙패드 핀치 뒤 이 시간 안의 click

/**
 * 창에 붙인다. filter: 하늘에서 시작한 누름인가(FieldEngine.dragFilter). spin: 지금 회전 속도(°/s).
 * 돌려주는 함수로 뗀다.
 */
export function installSkyGesture(filter: (e: Event) => boolean, spin: () => number): () => void {
  const ptrs = new Map<number, { x0: number; y0: number }>()
  let on = false
  let moved = 0
  let multi = false
  let touch = false
  let endedAt = 0
  let wheelAt = 0
  const opt = { capture: true, passive: true } as const

  const down = (e: PointerEvent) => {
    if (e.isPrimary) {
      ptrs.clear()
      on = filter(e)
      moved = 0
      multi = false
      touch = e.pointerType === 'touch'
      endedAt = 0
    } else if (on) multi = true
    if (on) ptrs.set(e.pointerId, { x0: e.clientX, y0: e.clientY })
  }
  const move = (e: PointerEvent) => {
    if (!on) return
    const p = ptrs.get(e.pointerId)
    if (p) moved = Math.max(moved, Math.hypot(e.clientX - p.x0, e.clientY - p.y0))
  }
  const up = (e: PointerEvent) => {
    if (!on || !ptrs.has(e.pointerId)) return
    ptrs.delete(e.pointerId)
    if (ptrs.size > 0) return
    on = false
    if (multi || moved >= (touch ? MOVE_TOUCH : MOVE_MOUSE) || spin() >= SPIN_DEG_S) endedAt = performance.now()
  }
  const wheel = (e: WheelEvent) => {
    if (filter(e)) wheelAt = performance.now()
  }
  const click = (e: MouseEvent) => {
    const now = performance.now()
    if ((endedAt && now - endedAt < 800) || now - wheelAt < WHEEL_MS) {
      marked.add(e)
      endedAt = 0
    }
  }
  window.addEventListener('pointerdown', down, opt)
  window.addEventListener('pointermove', move, opt)
  window.addEventListener('pointerup', up, opt)
  window.addEventListener('pointercancel', up, opt)
  window.addEventListener('wheel', wheel, opt)
  window.addEventListener('click', click, opt)
  return () => {
    window.removeEventListener('pointerdown', down, opt)
    window.removeEventListener('pointermove', move, opt)
    window.removeEventListener('pointerup', up, opt)
    window.removeEventListener('pointercancel', up, opt)
    window.removeEventListener('wheel', wheel, opt)
    window.removeEventListener('click', click, opt)
  }
}
