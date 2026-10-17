/**
 * 잉크 명령 한 곳 (design-ink 0-4 · 부록 A). 버튼 · 제스처 · 둥근 메뉴 · 키 · ⌘K가 모두 같은 id를 부른다.
 *
 * 형식 (앱 ⌘K 연결용):
 *   { id, name, aliases?, kbd?, keys?, icon?, group, run(engine), enabled?(engine), on?(engine), ui? }
 *   - name: ⌘K 이름(한 줄) · aliases: 찾기 별칭 · kbd: 줄 오른쪽에 쓰는 단축키(모노 11px)
 *   - ui: true = 화면(앱/도구 칸)이 처리한다 → run()은 engine 'ui' 이벤트 { id }를 낸다(서랍 · 제스처 보기 · 노트 닫기 …)
 *   - on: 켜고 끄는 명령의 지금 상태(⌘K 줄 끝 점)
 *   - engine 없이(⌘K가 노트 밖) 부를 수 있는 것은 noEngine: true (memo.*)
 *
 *   import { INK_COMMANDS, runInkCommand } from '@/ink'   // 앱은 동적 import
 *   runInkCommand('ink.undo')                              // 마지막으로 손댄 엔진에
 */
import type { PageTemplate } from '@/db/schema'
import type { InkEngine } from './engine'

export interface KeyMatch {
  /** KeyboardEvent.key (소문자 비교) 또는 code */
  key?: string
  code?: string
  mod?: boolean
  shift?: boolean | 'any'
  alt?: boolean
}

export type InkCommandGroup = 'tool' | 'insert' | 'edit' | 'page' | 'tape' | 'view' | 'file' | 'toggle' | 'note' | 'memo'

export interface InkCommand {
  id: string
  name: string
  aliases?: string[]
  kbd?: string
  keys?: KeyMatch[]
  /** 아이콘 이름 (src/ink/ui/icons.tsx · src/shell/icons.tsx) */
  icon?: string
  group: InkCommandGroup
  ui?: boolean
  noEngine?: boolean
  run(e: InkEngine): unknown
  enabled?(e: InkEngine): boolean
  on?(e: InkEngine): boolean
}

export function matchKey(e: KeyboardEvent, keys: KeyMatch[]): boolean {
  const mod = e.metaKey || e.ctrlKey
  for (const k of keys) {
    if (!!k.mod !== mod) continue
    if (k.shift !== 'any' && !!k.shift !== e.shiftKey) continue
    if (!!k.alt !== e.altKey) continue
    if (k.code && e.code === k.code) return true
    if (k.key && e.key.toLowerCase() === k.key.toLowerCase()) return true
  }
  return false
}

const ui = (id: string) => (e: InkEngine) => e.emit('ui', { id })
const hasSel = (e: InkEngine) => !!e.sel
const PEN_CYCLE = ['ball', 'fountain', 'pencil'] as const
const TEMPLATES: Array<[PageTemplate, string]> = [
  ['blank', '빈'],
  ['ruled', '줄'],
  ['grid', '모눈'],
  ['dot', '점'],
  ['cornell', '코넬'],
]

function penKind(e: InkEngine, kind: 'ball' | 'fountain' | 'pencil'): void {
  e.setPen({ kind })
  e.setTool('pen')
  e.emit('style', { tool: 'pen' })
}

export const INK_COMMANDS: InkCommand[] = [
  /* 도구 */
  {
    id: 'ink.tool.pen',
    name: '펜',
    aliases: ['볼펜', 'pen'],
    kbd: 'P',
    keys: [{ code: 'KeyP' }],
    icon: 'pen',
    group: 'tool',
    run: (e) => {
      if (e.tool === 'pen') penKind(e, PEN_CYCLE[(PEN_CYCLE.indexOf(e.pen.kind) + 1) % 3]!)
      else {
        e.setTool('pen')
        e.emit('style', { tool: 'pen' })
      }
    },
  },
  { id: 'ink.tool.fountain', name: '만년필', aliases: ['펜'], icon: 'fountain', group: 'tool', run: (e) => penKind(e, 'fountain') },
  { id: 'ink.tool.pencil', name: '연필', aliases: ['펜'], icon: 'pencil', group: 'tool', run: (e) => penKind(e, 'pencil') },
  { id: 'ink.tool.highlighter', name: '형광펜', aliases: ['하이라이터'], kbd: 'H', keys: [{ code: 'KeyH' }], icon: 'highlighter', group: 'tool', run: (e) => e.setTool('highlighter') },
  {
    id: 'ink.tool.eraser',
    name: '지우개',
    kbd: 'E',
    keys: [{ code: 'KeyE' }],
    icon: 'eraser',
    group: 'tool',
    run: (e) => {
      if (e.tool === 'eraser') e.setEraser({ mode: e.eraser.mode === 'stroke' ? 'partial' : 'stroke' })
      else e.setTool('eraser')
      e.emit('style', { tool: 'eraser' })
    },
  },
  {
    id: 'ink.eraser.partial',
    name: '부분 지우개',
    icon: 'eraserPart',
    group: 'tool',
    run: (e) => {
      e.setEraser({ mode: 'partial' })
      e.setTool('eraser')
      e.emit('style', { tool: 'eraser' })
    },
  },
  { id: 'ink.tool.lasso', name: '올가미', aliases: ['선택'], kbd: 'L', keys: [{ code: 'KeyL' }], icon: 'lasso', group: 'tool', run: (e) => e.setTool('lasso') },
  { id: 'ink.tool.tape', name: '테이프', aliases: ['가리개', '암기'], kbd: 'T', keys: [{ code: 'KeyT' }], icon: 'tape', group: 'tool', run: (e) => e.setTool('tape') },
  { id: 'ink.tool.hand', name: '손(이동)', aliases: ['이동', '스크롤'], icon: 'hand', group: 'tool', run: (e) => e.setTool('hand') },
  { id: 'ink.color.1', name: '색 칸 1', kbd: '1', keys: [{ key: '1' }], icon: 'dot', group: 'tool', ui: true, run: ui('ink.color.1') },
  { id: 'ink.color.2', name: '색 칸 2', kbd: '2', keys: [{ key: '2' }], icon: 'dot', group: 'tool', ui: true, run: ui('ink.color.2') },
  { id: 'ink.color.3', name: '색 칸 3', kbd: '3', keys: [{ key: '3' }], icon: 'dot', group: 'tool', ui: true, run: ui('ink.color.3') },
  { id: 'ink.width.down', name: '가늘게', aliases: ['굵기'], kbd: '[', keys: [{ key: '[' }], icon: 'width', group: 'tool', ui: true, run: ui('ink.width.down') },
  { id: 'ink.width.up', name: '굵게', aliases: ['굵기'], kbd: ']', keys: [{ key: ']' }], icon: 'width', group: 'tool', ui: true, run: ui('ink.width.up') },

  /* 넣기 */
  { id: 'ink.shape.once', name: '도형', aliases: ['직선', '사각형', '원', '화살표', '삼각형'], kbd: 'S', keys: [{ code: 'KeyS' }], icon: 'shape', group: 'insert', run: (e) => e.shapeOnce(!e.shapeArmed), on: (e) => e.shapeArmed },
  { id: 'ink.insert.text', name: '글 상자', aliases: ['텍스트', '글자'], kbd: 'X', keys: [{ code: 'KeyX' }], icon: 'text', group: 'insert', run: (e) => e.insertText() },
  {
    id: 'ink.insert.image',
    name: '사진 넣기',
    aliases: ['이미지', '그림'],
    icon: 'image',
    group: 'insert',
    run: async (e) => {
      const f = await e.pickFile('image/*')
      if (f) await e.insertImage(f)
    },
  },
  { id: 'ink.paste', name: '붙이기', aliases: ['붙여넣기'], kbd: '⌘V', keys: [{ key: 'v', mod: true }], icon: 'paste', group: 'edit', run: (e) => e.paste() },

  /* 고친 것 */
  { id: 'ink.undo', name: '되돌리기', aliases: ['실행 취소'], kbd: '⌘Z', keys: [{ key: 'z', mod: true }], icon: 'undo', group: 'edit', run: (e) => e.undo(), enabled: (e) => e.history.canUndo },
  { id: 'ink.redo', name: '다시하기', aliases: ['다시 실행'], kbd: '⇧⌘Z', keys: [{ key: 'z', mod: true, shift: true }, { key: 'y', mod: true }], icon: 'redo', group: 'edit', run: (e) => e.redo(), enabled: (e) => e.history.canRedo },
  { id: 'ink.copy', name: '복사', kbd: '⌘C', keys: [{ key: 'c', mod: true }], icon: 'copy', group: 'edit', run: (e) => e.copySelection(), enabled: hasSel },
  { id: 'ink.cut', name: '잘라내기', kbd: '⌘X', keys: [{ key: 'x', mod: true }], icon: 'cut', group: 'edit', run: (e) => e.cutSelection(), enabled: hasSel },
  { id: 'ink.duplicate', name: '복제', kbd: '⌘D', keys: [{ key: 'd', mod: true }], icon: 'duplicate', group: 'edit', run: (e) => e.duplicateSelection(), enabled: hasSel },
  { id: 'ink.delete', name: '고른 것 지우기', kbd: 'Delete', keys: [{ key: 'Delete' }, { key: 'Backspace' }], icon: 'trash', group: 'edit', run: (e) => e.deleteSelection(), enabled: hasSel },
  { id: 'ink.selectAll', name: '이 쪽 모두 고르기', kbd: '⌘A', keys: [{ key: 'a', mod: true }], icon: 'lasso', group: 'edit', run: (e) => e.selectAll() },
  { id: 'ink.cover', name: '고른 곳 가리기', aliases: ['테이프'], icon: 'tape', group: 'tape', run: (e) => e.coverSelection(), enabled: hasSel },

  /* 쪽 */
  { id: 'ink.page.add', name: '쪽 추가', aliases: ['새 쪽'], icon: 'pageAdd', group: 'page', run: (e) => e.addPage() },
  ...TEMPLATES.map(
    ([t, n]): InkCommand => ({
      id: `ink.page.template.${t}`,
      name: `쪽 틀: ${n}`,
      aliases: ['템플릿', '틀'],
      icon: 'template',
      group: 'page',
      run: (e) => {
        const p = e.currentPage()
        if (p) e.setTemplate(p.id, t)
      },
      on: (e) => e.currentPage()?.page.template === t,
    }),
  ),
  {
    id: 'ink.page.duplicate',
    name: '쪽 복제',
    icon: 'duplicate',
    group: 'page',
    run: (e) => {
      const p = e.currentPage()
      if (p) return e.duplicatePage(p.id)
    },
  },
  {
    id: 'ink.page.delete',
    name: '쪽 지우기',
    icon: 'trash',
    group: 'page',
    run: (e) => {
      const p = e.currentPage()
      if (p) e.deletePage(p.id)
    },
    enabled: (e) => e.doc.pages.length > 1,
  },
  { id: 'ink.page.next', name: '다음 쪽', kbd: 'PageDown', keys: [{ key: 'PageDown' }], icon: 'down', group: 'view', run: (e) => e.nextPage(1) },
  { id: 'ink.page.prev', name: '앞 쪽', kbd: 'PageUp', keys: [{ key: 'PageUp' }], icon: 'up', group: 'view', run: (e) => e.nextPage(-1) },
  { id: 'ink.drawer', name: '쪽 서랍', aliases: ['쪽 보기', '썸네일'], kbd: 'G', keys: [{ code: 'KeyG' }], icon: 'drawer', group: 'page', ui: true, run: ui('ink.drawer') },

  /* 파일 */
  {
    id: 'ink.pdf.import',
    name: 'PDF 가져오기',
    icon: 'pdfIn',
    group: 'file',
    run: async (e) => {
      const f = await e.pickFile('application/pdf')
      if (f) await e.importPdf(f)
    },
  },
  { id: 'ink.export.pdf', name: 'PDF로 내보내기', aliases: ['공유', '인쇄'], icon: 'share', group: 'file', ui: true, run: ui('ink.export.pdf') },
  { id: 'ink.export.png', name: '이 쪽 그림으로 저장', aliases: ['PNG', '공유'], icon: 'image', group: 'file', ui: true, run: ui('ink.export.png') },

  /* 테이프 */
  {
    id: 'ink.tape.reveal.page',
    name: '이 쪽 테이프 모두 걷기',
    icon: 'tape',
    group: 'tape',
    run: (e) => e.setTapes(false, 'page'),
  },
  { id: 'ink.tape.cover.page', name: '이 쪽 테이프 다시 붙이기', icon: 'tape', group: 'tape', run: (e) => e.setTapes(true, 'page') },
  { id: 'ink.tape.toggle.page', name: '이 쪽 테이프 걷기·붙이기', kbd: '⇧T', keys: [{ code: 'KeyT', shift: true }], icon: 'tape', group: 'tape', run: (e) => e.toggleAllTapes() },
  { id: 'ink.tape.reveal.note', name: '노트 테이프 모두 걷기', kbd: '⌥⇧T', keys: [{ code: 'KeyT', shift: true, alt: true }], icon: 'tape', group: 'tape', run: (e) => e.setTapes(false, 'note') },
  { id: 'ink.tape.cover.note', name: '노트 테이프 다시 붙이기', icon: 'tape', group: 'tape', run: (e) => e.setTapes(true, 'note') },
  { id: 'ink.tape.cover.unsure', name: '헷갈린 테이프만 붙이기', icon: 'unsure', group: 'tape', run: (e) => e.setTapes(true, 'note', { onlyFlagged: true }) },
  { id: 'ink.tape.flag', name: '헷갈림 표시', icon: 'unsure', group: 'tape', run: (e) => e.toggleFlag(), enabled: (e) => e.selectionInfo?.only === 'tape' },

  /* 켜고 끄기 */
  { id: 'ink.toggle.finger', name: '손가락으로 쓰기', icon: 'finger', group: 'toggle', run: (e) => e.setFingerDraw(e.penOnly), on: (e) => !e.penOnly },
  { id: 'ink.toggle.scratch', name: '긁어 지우기', icon: 'scratch', group: 'toggle', run: (e) => e.setPrefs({ scratch: !e.prefs.scratch }), on: (e) => e.prefs.scratch },
  { id: 'ink.toggle.penPie', name: '펜 길게 누르기 메뉴', icon: 'pie', group: 'toggle', run: (e) => e.setPrefs({ penPie: !e.prefs.penPie }), on: (e) => e.prefs.penPie },
  { id: 'ink.toggle.pillCollapsed', name: '도구 칸 늘 접기', icon: 'bead', group: 'toggle', ui: true, run: ui('ink.toggle.pillCollapsed') },

  /* 보기 */
  { id: 'ink.zoom.fit', name: '맞춤', aliases: ['100%'], kbd: '⌘0', keys: [{ key: '0', mod: true }], icon: 'fit', group: 'view', run: (e) => e.zoomFit() },
  { id: 'ink.zoom.in', name: '확대', kbd: '⌘=', keys: [{ key: '=', mod: true, shift: 'any' }, { key: '+', mod: true, shift: 'any' }], icon: 'zoomIn', group: 'view', run: (e) => e.zoomBy(1.25) },
  { id: 'ink.zoom.out', name: '축소', kbd: '⌘−', keys: [{ key: '-', mod: true }], icon: 'zoomOut', group: 'view', run: (e) => e.zoomBy(0.8) },

  /* 노트 */
  { id: 'ink.rename', name: '노트 이름 바꾸기', aliases: ['제목'], icon: 'rename', group: 'note', ui: true, run: ui('ink.rename') },
  { id: 'ink.close', name: '노트 닫기', icon: 'close', group: 'note', ui: true, run: ui('ink.close') },
  { id: 'ink.gestures', name: '제스처 보기', aliases: ['도움말'], kbd: '?', keys: [{ key: '?', shift: 'any' }], icon: 'help', group: 'note', ui: true, run: ui('ink.gestures') },

  /* 메모 (메모 칸이 처리 — 엔진 없이도 ⌘K에 나온다) */
  { id: 'memo.new.ink', name: '손글씨 메모', icon: 'memoInk', group: 'memo', ui: true, noEngine: true, run: ui('memo.new.ink') },
  { id: 'memo.new.check', name: '체크리스트 메모', icon: 'memoCheck', group: 'memo', ui: true, noEngine: true, run: ui('memo.new.check') },
  { id: 'memo.new.voice', name: '음성 메모', icon: 'mic', group: 'memo', ui: true, noEngine: true, run: ui('memo.new.voice') },
]

export const INK_COMMAND_MAP: ReadonlyMap<string, InkCommand> = new Map(INK_COMMANDS.map((c) => [c.id, c]))
