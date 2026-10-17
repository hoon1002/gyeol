/**
 * 결 손글씨 — 진입점 하나 (앱은 동적 import: `lazy(() => import('@/ink'))` → default = InkSurface).
 *
 *   엔진만:   const { createInkEngine } = await import('@/ink')
 *   React:    <InkSurface noteId … />            (default export)
 *   메모 칸:  <InkPad pageNoteId="memo:<id>" … />
 *   명령:     INK_COMMANDS · runInkCommand(id)   (⌘K 연결)
 *   백업 도우미는 이 청크가 아니라 '@/db/ink'(encodeStrokePoints · decodeStrokePoints)에 있다.
 */
export { InkSurface, default } from './InkSurface'
export type { InkSurfaceProps } from './InkSurface'
export { InkPad } from './InkPad'
export type { InkPadProps } from './InkPad'
export { InkEngine, createInkEngine, getActiveInkEngine } from './engine'
export type { Selection } from './engine'
export { INK_COMMANDS, INK_COMMAND_MAP, matchKey } from './commands'
export { inkThumbnail, inkThumbnailURL } from './thumb'
export { renderTapeRegion, renderPageRegion, syncTapeCandidates } from './region'
export type { RegionImage, RegionOpts } from './region'
export { TapeReveal } from './TapeReveal'
export type { TapeRevealProps } from './TapeReveal'
export { InkPadBuffer } from './padbuffer'
export type { BufferedPoint } from './padbuffer'
export type { InkThumbOptions } from './thumb'
export type { InkCommand, InkCommandGroup, KeyMatch } from './commands'
export { INK_THRESHOLDS } from './input/thresholds'
export { PEN_COLORS, PEN_SLOTS, HL_COLORS, HL_SLOTS, TAPE_COLORS, TAPE_SLOTS, WIDTHS, nightColor, inkColor, tapeColor, paperOf, PAPERS } from './palette'
export type * from './types'

import { INK_COMMAND_MAP } from './commands'
import { getActiveInkEngine, type InkEngine } from './engine'

/** ⌘K에서: 마지막으로 손댄 엔진에 명령 실행. 엔진이 필요한데 없으면 false */
export function runInkCommand(id: string, engine: InkEngine | null = getActiveInkEngine()): boolean {
  const c = INK_COMMAND_MAP.get(id)
  if (!c) return false
  if (!engine) return false
  if (c.enabled && !c.enabled(engine)) return false
  void c.run(engine)
  return true
}
