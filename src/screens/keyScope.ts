/**
 * 화면 전역 키(복습 Space · 1–4 · Esc, 노트 ⌘F · / · Esc)를 그 화면이 받아도 되는가 (QA M3 #1).
 *  - 글을 쓰는 중(input · textarea · select · contenteditable · [role=textbox])이면 받지 않는다.
 *  - 포커스가 그 화면 밖(메모 칸 · ⌘K · 설정 · 별가루함 같은 떠 있는 층, 크롬 버튼)이면 받지 않는다. body는 괜찮다.
 *  - ⌘K · 설정 · 렌즈 시트가 열려 있으면 받지 않는다.
 *  - 겹침 층(src/shell/layers.ts: 별 패널 · 메모 · 별가루함 · ⌘K · 편집기 제안 …)이 하나라도 떠 있으면 받지 않는다.
 */
import { isLayerOpen } from '@/shell/layers'
import type { SpacePath } from '@/shell/spaces'
import { useUi } from '@/stores/ui'

const TYPING = 'input, textarea, select, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"], [role="textbox"]'

/** 글을 쓰는 자리인가 */
export function isTyping(t: EventTarget | null): boolean {
  if (!(t instanceof Element)) return false
  return (t as HTMLElement).isContentEditable || !!t.closest(TYPING)
}

/** 포커스(이벤트 대상)가 그 화면 안이거나 아무 데도 없나(body) */
export function inScreen(t: EventTarget | null, path: SpacePath): boolean {
  if (!(t instanceof Element) || t === document.body || t === document.documentElement) return true
  return !!t.closest(`.space[data-path="${path}"]`)
}

/** 앱 위에 떠 있는 층이 열려 있나 */
export function overlayOpen(): boolean {
  const ui = useUi.getState()
  return ui.paletteOpen || ui.settingsOpen || ui.lensOpen || isLayerOpen()
}

/** 그 화면의 키로 받아도 되나: 화면 안 · 층 없음 · (typing = false면) 글 쓰는 중 아님 */
export function screenKey(e: KeyboardEvent, path: SpacePath, o: { typing?: boolean } = {}): boolean {
  if (e.isComposing || e.keyCode === 229) return false
  if (overlayOpen() || !inScreen(e.target, path)) return false
  return o.typing ? true : !isTyping(e.target)
}
