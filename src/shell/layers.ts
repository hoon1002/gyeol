/**
 * 겹침 층 관리자 (QA #2–#4 · #12–#15). 떠 있는 층(별 패널 · 설정 · 메모 · 별가루함 · .ics · 시간표 팝오버 · ⌘K · 편집기 제안 …)은
 * 열 때 pushLayer로 올리고, 닫히면(언마운트) 돌려받은 해제 함수를 부른다.
 *
 *   const release = pushLayer({ id: 'memo', close: () => closeMemo(), restoreFocusTo: opener })
 *   …
 *   release()            // 층이 사라질 때(언마운트·직접 닫기). 포커스가 갈 곳을 잃었으면 restoreFocusTo로 돌려준다
 *
 * 전역 Esc 하나(window 캡처)가 **맨 위 층만** 닫는다. close()가 false를 돌려주면 층 안의 작은 상태를 먼저 접은 것으로 보고
 * 층은 남긴다(예: 고르기 모드 끄기 · 보관함 → 별가루). 한글 조합 중(isComposing)의 Esc는 건드리지 않는다.
 */

export interface Layer {
  id: string
  /** Esc · 바깥 누르기 등으로 닫기. false를 돌려주면 '안에서 한 단계만 접었다' — 층은 남는다 */
  close: () => void | boolean
  /** 닫힌 뒤 포커스를 돌려줄 곳(연 요소). 포커스가 body·사라진 요소에 빠졌을 때만 돌려준다 */
  restoreFocusTo?: Element | null | (() => Element | null)
  /** 층의 뿌리 요소(선택). 포커스가 이 안에 있다가 사라졌는지 판정에 쓴다 */
  el?: Element | null
}

type Entry = Layer & { key: number }
// HMR로 이 모듈이 다시 실행돼도 전역 Esc와 같은 스택을 쓰게 window에 둔다
const stack: Entry[] = typeof window !== 'undefined' ? ((window as Window & { __gyeolLayerStack?: Entry[] }).__gyeolLayerStack ??= []) : []
let seq = 0
const listeners = new Set<() => void>()

function lost(l: Layer): boolean {
  const a = document.activeElement
  return !a || a === document.body || !a.isConnected || a.id === 'stage' || (!!l.el && l.el.contains(a))
}

function restore(l: Layer) {
  if (!l.restoreFocusTo) return
  // 언마운트·다시 그리기가 끝난 뒤(두 프레임) 포커스가 갈 곳을 잃었을 때만. 함수면 그때 찾는다(연 요소가 다시 그려졌을 수 있다)
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const to = (typeof l.restoreFocusTo === 'function' ? l.restoreFocusTo() : l.restoreFocusTo) as HTMLElement | null | undefined
      if (to && to.isConnected && typeof to.focus === 'function' && lost(l)) to.focus({ preventScroll: true })
    }),
  )
}

export function pushLayer(l: Layer): () => void {
  const entry = { ...l, key: ++seq }
  stack.push(entry)
  listeners.forEach((f) => f())
  let done = false
  return () => {
    if (done) return
    done = true
    const i = stack.findIndex((x) => x.key === entry.key)
    if (i >= 0) stack.splice(i, 1)
    restore(entry)
    listeners.forEach((f) => f())
  }
}

/** 층이 하나라도(또는 그 id가) 떠 있는가 */
export function isLayerOpen(id?: string): boolean {
  return id ? stack.some((x) => x.id === id) : stack.length > 0
}

export function topLayer(): Layer | null {
  return stack[stack.length - 1] ?? null
}

/** 층 목록이 바뀔 때 (useSyncExternalStore용) */
export function subscribeLayers(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** 맨 위 층 닫기 (Esc와 같은 길) */
export function closeTopLayer(): boolean {
  const top = stack[stack.length - 1]
  if (!top) return false
  const r = top.close()
  if (r !== false) restore(top)
  return true
}

if (typeof window !== 'undefined' && !(window as Window & { __gyeolLayers?: boolean }).__gyeolLayers) {
  ;(window as Window & { __gyeolLayers?: boolean }).__gyeolLayers = true
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape' || e.isComposing || e.keyCode === 229 || !stack.length) return
      e.preventDefault()
      e.stopPropagation()
      closeTopLayer()
    },
    true,
  )
}
