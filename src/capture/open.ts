/**
 * 메모 칸 여닫기 손잡이. MemoSheet가 마운트될 때 자기 DOM 손잡이를 등록하고,
 * 키·버튼 핸들러는 React 렌더를 기다리지 않고 이 손잡이를 바로 부른다(같은 틱에 inert 해제 + focus, design-m2 1-2).
 */
export interface MemoSheetHandle {
  open: (initial: string | undefined, origin: Element | null) => void
  close: () => void
  isOpen: () => boolean
}

let handle: MemoSheetHandle | null = null

export function registerMemoSheet(h: MemoSheetHandle | null): void {
  handle = h
}

export function openMemoSheet(initial: string | undefined, origin: Element | null): boolean {
  if (!handle) return false
  handle.open(initial, origin)
  return true
}

export function closeMemoSheet(): void {
  handle?.close()
}

export function isMemoOpen(): boolean {
  return handle?.isOpen() ?? false
}

/** 개발용 측정: 마지막 열기의 키 → 포커스 / 키 → 다음 프레임 (ms) */
export interface MemoOpenTiming {
  via: 'key' | 'button' | 'api'
  toFocus: number
  toFrame: number | null
}

export const memoTimings: MemoOpenTiming[] = []
