/**
 * 전역 입력 추적 (한 번만 설치). 무입력 시간(숨·깊은 대기·useIdle)과 포인터 위치를 함께 본다.
 * pointermove는 마우스·터치·Apple Pencil 호버(pointerType 'pen', buttons 0)를 모두 받는다.
 */
type Fn = () => void

let installed = false
let lastInput = typeof performance !== 'undefined' ? performance.now() : 0
const subs = new Set<Fn>()

export const pointer = { x: -1, y: -1, t: -1e9, type: '' as string, inside: false }

function bump() {
  lastInput = performance.now()
  subs.forEach((f) => f())
}

function install() {
  if (installed || typeof window === 'undefined') return
  installed = true
  const opts: AddEventListenerOptions = { passive: true, capture: true }
  const move = (e: PointerEvent) => {
    pointer.x = e.clientX
    pointer.y = e.clientY
    pointer.t = performance.now()
    pointer.type = e.pointerType
    pointer.inside = true
    bump()
  }
  window.addEventListener('pointermove', move, opts)
  window.addEventListener('pointerdown', move, opts)
  // 창 밖으로 나가면 옹이를 제자리로
  window.addEventListener(
    'pointerout',
    (e: PointerEvent) => {
      if (!e.relatedTarget) pointer.inside = false
    },
    opts,
  )
  for (const t of ['keydown', 'wheel', 'touchstart', 'scroll', 'compositionupdate'] as const) {
    window.addEventListener(t, bump, opts)
  }
}

export const input = {
  last(): number {
    install()
    return lastInput
  },
  subscribe(f: Fn): () => void {
    install()
    subs.add(f)
    return () => {
      subs.delete(f)
    }
  },
  ensure: install,
}
