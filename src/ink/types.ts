/** 손글씨 엔진 — 공개 타입 (앱 · 도구 칸 UI가 쓰는 것). */
import type { PageTemplate } from '@/db/schema'
import type { InkDB } from '@/db/ink'

/** 고르는 도구. 사진 넣기는 동작(engine.insertImage), 도형은 펜의 '한 번 도형'(shapeOnce) */
export type ToolName = 'pen' | 'highlighter' | 'eraser' | 'lasso' | 'text' | 'tape' | 'hand'

/** 펜 결: 볼펜 · 만년필 · 연필 */
export type PenKind = 'ball' | 'fountain' | 'pencil'

export interface PenStyle {
  kind: PenKind
  /** 저장 색 '#RRGGBB' (흰 종이 기준) */
  color: string
  /** 굵기 pt */
  width: number
  /** 압력 켬 · 끔 (끄면 고른 굵기 그대로) */
  pressure: boolean
}

export interface HighlighterStyle {
  color: string
  width: number
  /** 그은 뒤 곧으면(또는 끝에서 300ms 멈추면) 직선으로 */
  straight: boolean
}

export interface EraserStyle {
  /** 획 통째 · 부분(닿은 구간만 잘라 나눔) */
  mode: 'stroke' | 'partial'
  /** 지름 pt (8 · 16 · 32, 막대 6–40) */
  size: number
}

export interface TapeStyle {
  color: string
  /** 테이프 높이 pt (14 · 22 · 32) */
  width: number
}

/** 펜만 쓰기: auto = 펜이 한 번이라도 오면 켜짐(이 기기에 기억), on/off = 강제 */
export type PenOnlyMode = 'auto' | 'on' | 'off'

export interface InkPrefs {
  /** 긁어 지우기 (기본 켬) */
  scratch: boolean
  /** 펜 길게 누르기 → 둥근 메뉴 (기본 켬) */
  penPie: boolean
}

export interface PageInfo {
  id: string
  index: number
  /** 노트 안 순번(0부터) */
  n: number
  template: PageTemplate
  w: number
  h: number
  pdf: boolean
  /** 테이프: 걷힌 수 / 전체 */
  tapes: { revealed: number; total: number; color: string | null }
  strokes: number
}

export interface SelectionInfo {
  pageId: string
  strokes: number
  items: number
  /** 고른 물건 종류 (하나만 골랐으면) */
  only: 'ink' | 'image' | 'text' | 'tape' | 'mixed'
  /** 호스트 기준 CSS px, 회전 상자를 감싼 사각형 */
  rect: { x: number; y: number; w: number; h: number }
  /** 고른 획이 모두 한 색이면 그 색 (섞였으면 null) */
  color: string | null
  /** 형광 획만 골랐는가 (색 팝오버가 형광 6색) */
  highlight: boolean
  /** 끄는 중 (선택 칸은 숨긴다) */
  dragging: boolean
  /** 고른 테이프의 헷갈림 표시 */
  flag: boolean | null
}

export interface ViewInfo {
  /** CSS px / pt */
  scale: number
  /** 폭 맞춤 배율 */
  fit: number
  /** 맞춤 대비 % */
  zoom: number
  /** 화면 세로 가운데 선이 지나는 쪽 순번 */
  page: number
  pages: number
  /** 넘기는 중(쪽 번호를 보일 때) */
  moving: boolean
}

export interface PieEvent {
  phase: 'open' | 'move' | 'up' | 'cancel'
  /** 호스트 기준 CSS px */
  x: number
  y: number
  pointerType: string
  pageId: string | null
  /** 쪽 좌표 (누른 점) */
  px: number
  py: number
}

export interface InkStats {
  strokes: number
  pages: number
  loadedPages: number
  visiblePages: number
  canvasMPx: number
  /** 펜 입력 처리 JS (ms / 이벤트) */
  inputAvg: number
  inputMax: number
  inputEvents: number
  /** 이벤트 시각 → 잉크 그리기 끝 (ms) */
  latencyAvg: number
  latencyMax: number
  /** 엔진 프레임 작업 (ms) */
  frameWorkMax: number
  frameWorkAvg: number
  jobs: number
}

export interface InkEvents {
  ready: void
  /** 문서가 바뀜 (저장 큐에 들어감) */
  change: { pageIds: string[] }
  history: { canUndo: boolean; canRedo: boolean }
  /** 되돌리기 확인 칩: ok = 했는가, n = 연속 횟수 */
  undo: { kind: 'undo' | 'redo'; ok: boolean; n: number }
  selection: SelectionInfo | null
  pages: PageInfo[]
  view: ViewInfo
  /** 쓰는 중(펜이 닿아 있거나 마지막 획 뒤 2초) */
  active: boolean
  /** 잉크가 처음 그려진 프레임 뒤 (도구 칸 접힘은 다음 rAF) · 획이 끝남 */
  inkstart: { tool: ToolName; x: number; y: number }
  inkend: { tool: ToolName; x: number; y: number }
  penOnly: boolean
  tool: ToolName
  /** 획 하나가 저장 큐에 들어감 (녹음 싱크 · 하늘 사건용) */
  stroke: { pageId: string; id: string; tool: string }
  /** 둥근 메뉴 (빈 곳 길게 누르기 · 오른쪽 클릭) */
  pie: PieEvent
  /** 펜·마우스 호버 (null = 떠남) */
  hover: { x: number; y: number; type: string } | null
  /** 왼쪽 가장자리 밀기 (손가락) */
  edgeswipe: { y: number }
  /** 쪽 그림이 새로 만들어짐 */
  thumb: { pageId: string }
  progress: { kind: 'pdf' | 'export'; done: number; total: number }
  /** 화면이 처리할 명령 (commands.ts의 ui: true) */
  ui: { id: string }
  /** 펜·지우개 설정이 키로 바뀜 (도구 칸이 다시 읽는다) */
  style: { tool: ToolName }
  error: Error
}

export interface InkEngineOptions {
  /** 엔진이 채우는 요소 (크기는 앱이 정한다) */
  host: HTMLElement
  noteId: string
  /** 기본: 앱 DB. 시험 페이지는 openInkLabDB() */
  db?: InkDB
  /** 새 노트의 첫 쪽 틀 */
  template?: PageTemplate
  penOnly?: PenOnlyMode
  /** 키보드(⌘Z 등)를 받을지 (기본 true) */
  keys?: boolean
  /** 쓰는 동안 :root[data-inking] (기본 true) */
  markInking?: boolean
  /** 'pad' = 손글씨 메모 칸: 쪽 하나, 확대·이동 없음, 종이 투명 */
  mode?: 'note' | 'pad'
  /** 'pad'의 쪽 크기 (pt = CSS px) */
  padSize?: [number, number]
  /** 밤 종이인가 (기본: html[data-theme] != light) */
  night?: boolean
  /** 홈 화면 앱(가장자리 밀기 켬) */
  standalone?: boolean
}
