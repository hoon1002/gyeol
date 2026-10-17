/**
 * 누르기 ↔ 끌기 구분 (M3): 하늘에서 시작한 끌기 · 두 손가락(핀치) · 관성 회전 · 휠/트랙패드 핀치 뒤에 브라우저가 보내는
 * click을 '하늘 끌기 끝'으로 표시한다. 앱(StarPress 등)은 isSkyDragClick(e)가 참이면 그 click을 '빈 하늘 누르기'로 보지 않는다.
 * 3D · 2.5D 어느 쪽이든 같은 규칙(창 캡처 단계에서 본다 — 앱의 click 처리보다 먼저).
 * 하늘 밖(패널 · 글 · 버튼)에서 시작해 하늘에서 끝난 누름의 click도 표시한다(QA #5).
 * 커서: 끌 수 있는 빈 하늘 위 :root.gx-grab, 끄는 중 :root.gx-grabbing (QA #18, fx.css).
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
export function installSkyGesture(filter: (e: Event) => boolean, spin: () => number, canDrag: () => boolean = () => true): () => void {
  const ptrs = new Map<number, { x0: number; y0: number }>()
  let on = false
  // QA #5: 하늘 밖(패널 · 글 · 버튼)에서 시작한 누름 — 하늘 위에서 끝나 공통 조상에 온 click은 '하늘 누르기'가 아니다
  let downTarget: EventTarget | null = null
  let offSky = false
  let offMoved = 0
  let ox = 0
  let oy = 0
  // QA #18 커서: 끌 수 있는 빈 하늘 위 grab · 끄는 중 grabbing (별 위 pointer는 StarPress) — 종이(data-paper) · 쓰는 중(data-inking)이면 바꾸지 않는다
  const root = document.documentElement
  let grabbing = false
  const quiet = () => root.dataset.paper !== undefined || root.dataset.inking !== undefined
  const setCursor = (grab: boolean, held: boolean) => {
    if (root.classList.contains('gx-grab') !== grab) root.classList.toggle('gx-grab', grab)
    if (root.classList.contains('gx-grabbing') !== held) root.classList.toggle('gx-grabbing', held)
  }
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
      downTarget = e.target
      offSky = !on
      offMoved = 0
      ox = e.clientX
      oy = e.clientY
      grabbing = on && e.pointerType === 'mouse' && e.button === 0 && canDrag() && !quiet()
      setCursor(false, grabbing)
      moved = 0
      multi = false
      touch = e.pointerType === 'touch'
      endedAt = 0
    } else if (on) multi = true
    if (on) ptrs.set(e.pointerId, { x0: e.clientX, y0: e.clientY })
  }
  const move = (e: PointerEvent) => {
    if (offSky && e.isPrimary) offMoved = Math.max(offMoved, Math.hypot(e.clientX - ox, e.clientY - oy))
    if (e.pointerType === 'mouse' && !grabbing) {
      // 누르지 않고 움직일 때만 판정(가벼운 closest 몇 번, rAF 없음)
      if (e.buttons === 0) setCursor(!quiet() && canDrag() && filter(e), false)
      else if (root.classList.contains('gx-grab')) setCursor(false, false)
    }
    if (!on) return
    const p = ptrs.get(e.pointerId)
    if (p) moved = Math.max(moved, Math.hypot(e.clientX - p.x0, e.clientY - p.y0))
  }
  const up = (e: PointerEvent) => {
    if (grabbing && e.isPrimary) {
      grabbing = false
      setCursor(e.type === 'pointerup' && e.pointerType === 'mouse' && !quiet() && canDrag() && filter(e), false)
    }
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
      return
    }
    // 하늘 밖에서 시작해 움직였거나 다른 곳(하늘)에서 끝난 누름: click이 누른 요소 안이 아니면(공통 조상) 하늘 누르기가 아니다
    if (offSky && downTarget instanceof Node) {
      const inside = e.target instanceof Node && downTarget.contains(e.target)
      if (!inside || offMoved >= MOVE_MOUSE) marked.add(e)
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
    setCursor(false, false)
  }
}
