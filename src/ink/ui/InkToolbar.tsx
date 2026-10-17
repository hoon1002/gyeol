/**
 * 손글씨 화면 UI (design-ink 2 · 3 · 4-2 · 5 · 6 · 7-5): 도구 칸(펼침/구슬, 네 가장자리) · 색/굵기/옵션 팝오버 · 더 보기 줄 ·
 * 둥근 메뉴 · 선택 칸 · 쪽 번호 · 되돌리기 칩 · 테이프 칩 · 쪽 서랍. 모든 동작은 INK_COMMANDS id 또는 엔진 메서드를 부른다.
 * 떠 있는 것은 blur 없이 --surface-2 96%, transform · opacity · clip-path로만 움직인다. Esc · 두 손가락 탭은 맨 위 층만 닫는다(layers.ts).
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { useHint } from '@/shell/hints'
import { IconEraser, IconLasso, IconMore, IconPlus, IconSearch, IconTrash } from '@/shell/icons'
import { tip } from '@/shell/Tip'
import { closeTopLayer, isLayerOpen, pushLayer } from '@/shell/layers'
import { getInkMeta, setInkMeta } from '@/db/ink'
import type { PageTemplate } from '@/db/schema'
import type { InkEngine } from '../engine'
import { INK_COMMAND_MAP } from '../commands'
import { INK_THRESHOLDS as T } from '../input/thresholds'
import { HL_COLORS, HL_SLOTS, inkColor, PEN_COLORS, PEN_SLOTS, TAPE_COLORS, TAPE_SLOTS, tapeColor, WIDTHS } from '../palette'
import type { PageInfo, PieEvent, SelectionInfo, ToolName, ViewInfo } from '../types'
import { IconColorDot, IconCopy, IconCut, IconDrawer, IconDuplicate, IconFinger, IconFountain, IconHighlighter, IconImage, IconInkPen, IconPageAdd, IconPaste, IconPdfIn, IconPencil, IconRedo, IconScratch, IconShape, IconShare, IconTape, IconTemplate, IconTextBox, IconUndoInk, IconUnsure, IconEraserPart } from './icons'
import './ink-ui.css'

type Edge = 'top' | 'bottom' | 'left' | 'right'
interface Dock {
  edge: Edge
  t: number
}
interface Tools {
  pen: { slots: string[]; sel: number; width: number; kind: 'ball' | 'fountain' | 'pencil'; pressure: boolean }
  hl: { slots: string[]; sel: number; width: number; straight: boolean }
  tape: { slots: string[]; sel: number; width: number }
  eraser: { mode: 'stroke' | 'partial'; size: number }
}
const DEF_TOOLS: Tools = {
  pen: { slots: [...PEN_SLOTS], sel: 0, width: 2, kind: 'ball', pressure: true },
  hl: { slots: [...HL_SLOTS], sel: 0, width: 12, straight: true },
  tape: { slots: [...TAPE_SLOTS], sel: 0, width: 22 },
  eraser: { mode: 'stroke', size: 16 },
}
const TOOL_ICON: Record<'pen' | 'highlighter' | 'eraser' | 'lasso' | 'tape', (k: Tools) => ReactNode> = {
  pen: (k) => (k.pen.kind === 'fountain' ? <IconFountain /> : k.pen.kind === 'pencil' ? <IconPencil /> : <IconInkPen />),
  highlighter: () => <IconHighlighter />,
  eraser: (k) => (k.eraser.mode === 'partial' ? <IconEraserPart /> : <IconEraser />),
  lasso: () => <IconLasso />,
  tape: () => <IconTape />,
}
const TOOL_NAME: Record<string, string> = { pen: '펜', highlighter: '형광펜', eraser: '지우개', lasso: '올가미', tape: '테이프' }
const KIND_NAME = { ball: '볼펜', fountain: '만년필', pencil: '연필' } as const
const TEMPLATE_NAME: Record<PageTemplate, string> = { blank: '빈', ruled: '줄', grid: '모눈', dot: '점', cornell: '코넬' }

const phone = () => innerWidth < 600
const dockKey = () => (phone() ? 'phone' : innerWidth > innerHeight ? 'land' : 'port')
const run = (id: string, e: InkEngine) => void INK_COMMAND_MAP.get(id)?.run(e)
/** 엔진마다: 열린 서랍 닫기 (선택 층이 위에 쌓였어도 서랍이 먼저 닫히게) */
const drawerClose = new WeakMap<InkEngine, () => void>()

/** 층(layers.ts)에 올렸다 내린다 */
function useLayer(open: boolean, id: string, close: () => void | boolean) {
  const c = useRef(close)
  c.current = close
  useEffect(() => {
    if (!open) return
    return pushLayer({ id, close: () => c.current() as void | boolean })
  }, [open, id])
}

export interface InkToolbarProps {
  engine: InkEngine
  /** 노트 제목 (없으면 DB에서 읽는다) */
  title?: string
  /** 이름 바꾸기 (없으면 notes.title을 직접 고친다) */
  onRename?: (title: string) => void
  /** 내보내기 결과 (없으면 공유 시트 · 내려받기) */
  onExport?: (kind: 'pdf' | 'png', blob: Blob) => void
}

export function InkToolbar({ engine: e, title, onRename, onExport }: InkToolbarProps) {
  const [tool, setTool] = useState<ToolName>(e.tool)
  const [k, setK] = useState<Tools>(DEF_TOOLS)
  const [dock, setDock] = useState<Dock>({ edge: phone() ? 'bottom' : 'top', t: 0.5 })
  const [bead, setBead] = useState(false)
  const [pop, setPop] = useState<null | 'color' | 'width' | 'opts' | 'more' | 'slots'>(null)
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null)
  const [, force] = useState(0)
  const pillRef = useRef<HTMLDivElement>(null)
  const st = useRef({ lastEnd: [0, 0] as [number, number], idleMs: 2400, autoOpenAt: 0, quickResume: 0, collapsedPin: false, timer: 0 })

  // 저장된 도구 · 자리
  useEffect(() => {
    void getInkMeta<Tools | null>(e.db, 'ink.tools', null).then((v) => v && setK({ ...DEF_TOOLS, ...v }))
    void getInkMeta<Dock | null>(e.db, 'ink.dock.' + dockKey(), null).then((v) => v && setDock(v))
  }, [e])

  // 엔진에 반영
  useEffect(() => {
    e.setPen({ color: k.pen.slots[k.pen.sel] ?? PEN_SLOTS[0], width: k.pen.width, kind: k.pen.kind, pressure: k.pen.pressure })
    e.textColor = k.pen.slots[0] ?? PEN_SLOTS[0]!
    e.setHighlighter({ color: k.hl.slots[k.hl.sel] ?? HL_SLOTS[0], width: k.hl.width, straight: k.hl.straight })
    e.setTape({ color: k.tape.slots[k.tape.sel] ?? TAPE_SLOTS[0], width: k.tape.width })
    e.setEraser({ mode: k.eraser.mode, size: k.eraser.size })
  }, [e, k])
  const save = (n: Tools) => {
    setK(n)
    void setInkMeta(e.db, 'ink.tools', n)
  }

  // 엔진 이벤트: 도구 · 키로 바뀐 설정 · 쓰기 시작/끝(접힘) · UI 명령
  useEffect(() => {
    const s = st.current
    const offs = [
      e.on('tool', (t) => setTool(t)),
      e.on('style', () => {
        setK((cur) => ({ ...cur, pen: { ...cur.pen, kind: e.pen.kind }, eraser: { ...cur.eraser, mode: e.eraser.mode } }))
      }),
      e.on('inkstart', () => {
        setPop(null)
        // 첫 프레임은 잉크에게: 다음 rAF에 접는다
        requestAnimationFrame(() => {
          if (performance.now() - s.autoOpenAt < 1500) {
            s.quickResume++
            if (s.quickResume >= 3) s.idleMs = 6000
          } else s.quickResume = 0
          setBead(true)
        })
        clearTimeout(s.timer)
      }),
      e.on('inkend', ({ x, y }) => {
        s.lastEnd = [x, y]
        clearTimeout(s.timer)
        const tryOpen = () => {
          if (e.isActive && e.input.penDown) return
          const r = pillRef.current?.getBoundingClientRect()
          const host = e.host.getBoundingClientRect()
          if (r) {
            const px = s.lastEnd[0] + host.left, py = s.lastEnd[1] + host.top
            const dx = Math.max(r.left - px, 0, px - r.right), dy = Math.max(r.top - py, 0, py - r.bottom)
            if (Math.hypot(dx, dy) < 160) return
          }
          if (s.collapsedPin) return
          s.autoOpenAt = performance.now()
          setBead(false)
        }
        s.timer = window.setTimeout(tryOpen, s.idleMs)
      }),
      e.on('hover', (h) => {
        if (!h || !bead || !pillRef.current) return
        const r = pillRef.current.getBoundingClientRect()
        const host = e.host.getBoundingClientRect()
        const d = Math.hypot(h.x + host.left - (r.left + r.width / 2), h.y + host.top - (r.top + r.height / 2))
        if (h.type === 'pen' && d < 96) setBead(false)
      }),
      e.on('ui', ({ id }) => {
        if (id === 'ink.toggle.pillCollapsed') {
          s.collapsedPin = !s.collapsedPin
          setBead(s.collapsedPin)
        } else if (id.startsWith('ink.color.')) {
          const i = Number(id.slice(-1)) - 1
          setK((cur) => {
            const n = { ...cur }
            if (e.tool === 'highlighter') n.hl = { ...n.hl, sel: i }
            else if (e.tool === 'tape') n.tape = { ...n.tape, sel: i }
            else n.pen = { ...n.pen, sel: i }
            void setInkMeta(e.db, 'ink.tools', n)
            return n
          })
        } else if (id === 'ink.width.up' || id === 'ink.width.down') {
          setK((cur) => stepWidth(cur, e.tool, id === 'ink.width.up' ? 1 : -1, e))
        }
      }),
    ]
    return () => {
      offs.forEach((f) => f())
      clearTimeout(s.timer)
    }
  }, [e, bead])

  // 두·세 손가락 탭은 맨 위 층을 먼저 닫는다 (되돌리기 안 함)
  useEffect(() => {
    e.interceptTap = () => (isLayerOpen() ? (closeTopLayer(), true) : false)
    return () => {
      e.interceptTap = null
    }
  }, [e])

  useLayer(pop !== null, 'ink-pop', () => setPop(null))

  const pick = (t: ToolName) => {
    if (e.tool === t && t !== 'lasso') setPop(pop === 'opts' ? null : 'opts')
    else {
      e.setTool(t)
      setPop(null)
    }
  }
  const vertical = dock.edge === 'left' || dock.edge === 'right'

  // 끌어 옮기기: 6px 넘으면 끌기, 놓으면 가장 가까운 가장자리
  const dragRef = useRef<{ id: number; x0: number; y0: number; on: boolean } | null>(null)
  const onPillDown = (ev: React.PointerEvent) => {
    dragRef.current = { id: ev.pointerId, x0: ev.clientX, y0: ev.clientY, on: false }
  }
  const onPillMove = (ev: React.PointerEvent) => {
    const d = dragRef.current
    if (!d || d.id !== ev.pointerId) return
    if (!d.on && Math.hypot(ev.clientX - d.x0, ev.clientY - d.y0) > T.tapMove) {
      d.on = true
      ;(ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId)
      setPop(null)
    }
    if (d.on) setDrag({ x: ev.clientX, y: ev.clientY })
  }
  const onPillUp = (ev: React.PointerEvent) => {
    const d = dragRef.current
    dragRef.current = null
    if (!d?.on) return
    ev.preventDefault()
    const host = e.host.getBoundingClientRect()
    const x = ev.clientX - host.left, y = ev.clientY - host.top
    const dists: Array<[Edge, number]> = [
      ['top', y],
      ['bottom', host.height - y],
      ['left', phone() ? 1e9 : x],
      ['right', phone() ? 1e9 : host.width - x],
    ]
    dists.sort((a, b) => a[1] - b[1])
    const edge = dists[0]![0]
    const t = edge === 'top' || edge === 'bottom' ? x / host.width : y / host.height
    const nd = { edge, t: Math.max(0.08, Math.min(0.92, t)) }
    setDock(nd)
    setDrag(null)
    void setInkMeta(e.db, 'ink.dock.' + dockKey(), nd)
  }
  const swallowClick = (ev: React.MouseEvent) => {
    if (drag) ev.stopPropagation()
  }

  const curColor = tool === 'highlighter' ? k.hl.slots[k.hl.sel]! : tool === 'tape' ? k.tape.slots[k.tape.sel]! : k.pen.slots[k.pen.sel]!
  const shown = (hex: string) => (tool === 'tape' ? tapeColor(hex, e.night) : tool === 'highlighter' ? hex : inkColor(hex, e.night))
  const dotColor = tool === 'eraser' || tool === 'lasso' ? 'var(--text-1)' : shown(curColor)
  const mid = tool === 'pen' || tool === 'highlighter' || tool === 'tape' || tool === 'text' ? 'color' : tool === 'eraser' ? 'eraser' : 'none'
  // 좁은 화면(폰 390): 도구 5 + 지금 색 하나 + ⋯ 만 (설계 11장). 색 3 · 굵기는 위 줄로
  const narrow = e.view.W < 480 && !vertical

  const style: React.CSSProperties = drag
    ? { left: drag.x - e.host.getBoundingClientRect().left, top: drag.y - e.host.getBoundingClientRect().top, transform: 'translate(-50%, -50%) scale(1.04)' }
    : dock.edge === 'top'
      ? { left: `${dock.t * 100}%`, top: 10, transform: 'translateX(-50%)' }
      : dock.edge === 'bottom'
        ? { left: `${dock.t * 100}%`, bottom: 12, transform: 'translateX(-50%)' }
        : dock.edge === 'left'
          ? { left: 12, top: `${dock.t * 100}%`, transform: 'translateY(-50%)' }
          : { right: 12, top: `${dock.t * 100}%`, transform: 'translateY(-50%)' }

  return (
    <>
      <div
        ref={pillRef}
        className={'ink-pill' + (bead ? ' is-bead' : '') + (vertical ? ' is-vert' : '') + (drag ? ' is-drag' : '') + ' at-' + dock.edge}
        style={style}
        data-ink-ui=""
        role="toolbar"
        aria-label="도구"
        onPointerDown={onPillDown}
        onPointerMove={onPillMove}
        onPointerUp={onPillUp}
        onClickCapture={swallowClick}
        onMouseEnter={() => bead && !st.current.collapsedPin && setBead(false)}
      >
        {bead ? (
          <button className="ink-bead" {...tip(TOOL_NAME[tool] ?? '도구')} onClick={() => setBead(false)} style={{ ['--dot' as string]: dotColor }}>
            {TOOL_ICON[(tool in TOOL_ICON ? tool : 'pen') as keyof typeof TOOL_ICON](k)}
            <i className="ink-dot" />
            {e.shapeArmed && <i className="ink-tri" />}
          </button>
        ) : (
          <>
            <div className="ink-tools">
              {(['pen', 'highlighter', 'eraser', 'lasso', 'tape'] as const).map((t) => (
                <button key={t} className={'ink-btn' + (tool === t ? ' is-on' : '')} {...tip(TOOL_NAME[t]!, { kbd: { pen: 'P', highlighter: 'H', eraser: 'E', lasso: 'L', tape: 'T' }[t] })} aria-pressed={tool === t} onClick={() => pick(t)} style={{ ['--dot' as string]: tool === t ? dotColor : 'transparent' }}>
                  {TOOL_ICON[t](k)}
                  <i className="ink-dot" />
                </button>
              ))}
            </div>
            {mid !== 'none' && <i className="ink-sep" />}
            {mid === 'color' && narrow && (
              <button className={'ink-btn' + (pop === 'slots' ? ' is-on' : '')} {...tip('색 · 굵기')} onClick={() => setPop(pop === 'slots' ? null : 'slots')}>
                <IconColorDot color={shown(curColor)} size={20} ring />
              </button>
            )}
            {mid === 'color' && !narrow && (
              <div className="ink-mid">
                {(tool === 'highlighter' ? k.hl.slots : tool === 'tape' ? k.tape.slots : k.pen.slots).map((hex, i) => {
                  const sel = (tool === 'highlighter' ? k.hl.sel : tool === 'tape' ? k.tape.sel : k.pen.sel) === i
                  return (
                    <button
                      key={i}
                      className="ink-btn ink-sw"
                      {...tip('색 ' + (i + 1), { kbd: String(i + 1) })}
                      aria-pressed={sel}
                      onClick={() => {
                        if (sel) return setPop(pop === 'color' ? null : 'color')
                        const n = { ...k }
                        if (tool === 'highlighter') n.hl = { ...n.hl, sel: i }
                        else if (tool === 'tape') n.tape = { ...n.tape, sel: i }
                        else n.pen = { ...n.pen, sel: i }
                        save(n)
                      }}
                    >
                      <IconColorDot color={shown(hex)} size={20} ring={sel} />
                    </button>
                  )
                })}
                <button className="ink-btn" {...tip('굵기', { kbd: '[ ]' })} onClick={() => setPop(pop === 'width' ? null : 'width')}>
                  <i className="ink-wdot" style={{ width: widthDot(k, tool), height: widthDot(k, tool), background: dotColor }} />
                </button>
              </div>
            )}
            {mid === 'eraser' && (
              <div className="ink-mid">
                <button className={'ink-btn' + (k.eraser.mode === 'stroke' ? ' is-on' : '')} {...tip('획 지우개')} onClick={() => save({ ...k, eraser: { ...k.eraser, mode: 'stroke' } })}>
                  <IconEraser />
                </button>
                <button className={'ink-btn' + (k.eraser.mode === 'partial' ? ' is-on' : '')} {...tip('부분 지우개')} onClick={() => save({ ...k, eraser: { ...k.eraser, mode: 'partial' } })}>
                  <IconEraserPart />
                </button>
                <button className="ink-btn" {...tip('크기', { kbd: '[ ]' })} onClick={() => setPop(pop === 'width' ? null : 'width')}>
                  <i className="ink-wdot is-ring" style={{ width: widthDot(k, 'eraser'), height: widthDot(k, 'eraser') }} />
                </button>
              </div>
            )}
            <i className="ink-sep" />
            <button className={'ink-btn' + (pop === 'more' ? ' is-on' : '')} {...tip('더 보기')} onClick={() => setPop(pop === 'more' ? null : 'more')}>
              <IconMore />
            </button>
          </>
        )}
        {pop === 'slots' && !bead && (
          <div className={'ink-pop ink-seg at-' + dock.edge}>
            {(tool === 'highlighter' ? k.hl.slots : tool === 'tape' ? k.tape.slots : k.pen.slots).map((hex, i) => (
              <button
                key={i}
                className="ink-btn ink-sw"
                aria-label={'색 ' + (i + 1)}
                onClick={() => {
                  const n = { ...k }
                  if (tool === 'highlighter') n.hl = { ...n.hl, sel: i }
                  else if (tool === 'tape') n.tape = { ...n.tape, sel: i }
                  else n.pen = { ...n.pen, sel: i }
                  save(n)
                }}
              >
                <IconColorDot color={shown(hex)} size={20} ring={(tool === 'highlighter' ? k.hl.sel : tool === 'tape' ? k.tape.sel : k.pen.sel) === i} />
              </button>
            ))}
            <button className="ink-btn" aria-label="색 고르기" onClick={() => setPop('color')}>
              <IconMore />
            </button>
            <button className="ink-btn" aria-label="굵기" onClick={() => setPop('width')}>
              <i className="ink-wdot" style={{ width: widthDot(k, tool), height: widthDot(k, tool), background: dotColor }} />
            </button>
          </div>
        )}
        {pop && pop !== 'slots' && !bead && <Popover kind={pop} engine={e} tool={tool} k={k} save={save} close={() => setPop(null)} vertical={vertical} edge={dock.edge} />}
      </div>
      <RadialMenu engine={e} />
      <SelectionBar engine={e} />
      <PageNumber engine={e} />
      <UndoChip engine={e} edge={dock.edge} />
      <TapeChips engine={e} />
      <PageDrawer engine={e} title={title} onRename={onRename} />
      <ExportPop engine={e} onExport={onExport} />
      <InkHints engine={e} edge={dock.edge} />
      <PenOnlyMark engine={e} pill={pillRef} />
      {void force}
    </>
  )
}

function widthDot(k: Tools, tool: ToolName): number {
  const [w, steps] = tool === 'highlighter' ? [k.hl.width, WIDTHS.highlighter.steps] : tool === 'tape' ? [k.tape.width, WIDTHS.tape.steps] : tool === 'eraser' ? [k.eraser.size, WIDTHS.eraser.steps] : [k.pen.width, k.pen.kind === 'pencil' ? WIDTHS.pencil.steps : WIDTHS.pen.steps]
  const i = steps.reduce((bi, s, j) => (Math.abs(s - w) < Math.abs(steps[bi]! - w) ? j : bi), 0)
  return [6, 10, 14][i]!
}

function stepWidth(k: Tools, tool: ToolName, d: 1 | -1, e: InkEngine): Tools {
  const n = { ...k }
  const next = (steps: readonly number[], w: number) => {
    const i = steps.reduce((bi, s, j) => (Math.abs(s - w) < Math.abs(steps[bi]! - w) ? j : bi), 0)
    return steps[Math.max(0, Math.min(steps.length - 1, i + d))]!
  }
  if (tool === 'highlighter') n.hl = { ...n.hl, width: next(WIDTHS.highlighter.steps, n.hl.width) }
  else if (tool === 'tape') n.tape = { ...n.tape, width: next(WIDTHS.tape.steps, n.tape.width) }
  else if (tool === 'eraser') n.eraser = { ...n.eraser, size: next(WIDTHS.eraser.steps, n.eraser.size) }
  else n.pen = { ...n.pen, width: next(n.pen.kind === 'pencil' ? WIDTHS.pencil.steps : WIDTHS.pen.steps, n.pen.width) }
  void setInkMeta(e.db, 'ink.tools', n)
  return n
}

/* ---------- 팝오버 (색 · 굵기 · 도구 옵션 · 더 보기) ---------- */

function Popover({ kind, engine: e, tool, k, save, close, edge }: { kind: 'color' | 'width' | 'opts' | 'more'; engine: InkEngine; tool: ToolName; k: Tools; save: (n: Tools) => void; close: () => void; vertical: boolean; edge: Edge }) {
  const [fine, setFine] = useState(false)
  const longT = useRef(0)
  const cls = 'ink-pop at-' + edge
  if (kind === 'more') {
    const items: Array<[string, string, ReactNode, boolean?]> = [
      ['ink.search', '찾기', <IconSearch key="s" />],
      ['ink.shape.once', '도형', <IconShape key="h" />, e.shapeArmed],
      ['ink.insert.text', '글 상자', <IconTextBox key="t" />],
      ['ink.insert.image', '사진', <IconImage key="i" />],
      ['ink.drawer', '쪽 서랍', <IconDrawer key="d" />],
      ['ink.toggle.finger', '손가락으로 쓰기', <IconFinger key="f" />, !e.penOnly],
      ['ink.toggle.scratch', '긁어 지우기', <IconScratch key="c" />, e.prefs.scratch],
      ['ink.export.pdf', '내보내기', <IconShare key="x" />],
    ]
    return (
      <div className={cls + ' ink-more'} role="menu">
        {items.map(([id, name, icon, on]) => (
          <button
            key={id}
            className={'ink-btn' + (on ? ' is-toggled' : '')}
            {...tip(name, { kbd: INK_COMMAND_MAP.get(id)?.kbd })}
            onClick={() => {
              if (id === 'ink.search') e.emit('ui', { id: 'ink.search' })
              else run(id, e)
              if (id === 'ink.insert.text' || id === 'ink.insert.image') e.emit('ui', { id: 'hint.pie' })
              close()
            }}
          >
            {icon}
          </button>
        ))}
      </div>
    )
  }
  if (kind === 'opts') {
    return (
      <div className={cls}>
        <div className="ink-pop-name">{tool === 'pen' ? KIND_NAME[k.pen.kind] : TOOL_NAME[tool] ?? ''}</div>
        {tool === 'pen' && (
          <div className="ink-seg">
            {(['ball', 'fountain', 'pencil'] as const).map((kd) => (
              <button key={kd} className={'ink-btn' + (k.pen.kind === kd ? ' is-on' : '')} {...tip(KIND_NAME[kd])} onClick={() => save({ ...k, pen: { ...k.pen, kind: kd, width: kd === 'pencil' ? WIDTHS.pencil.steps[1] : k.pen.kind === 'pencil' ? WIDTHS.pen.steps[1] : k.pen.width } })}>
                {kd === 'ball' ? <IconInkPen /> : kd === 'fountain' ? <IconFountain /> : <IconPencil />}
              </button>
            ))}
            <i className="ink-sep" />
            <button className={'ink-btn' + (k.pen.pressure ? ' is-toggled' : '')} {...tip('압력')} onClick={() => save({ ...k, pen: { ...k.pen, pressure: !k.pen.pressure } })}>
              <IconFountain />
            </button>
          </div>
        )}
        {tool === 'highlighter' && (
          <div className="ink-seg">
            <button className={'ink-btn' + (k.hl.straight ? ' is-toggled' : '')} {...tip('곧게')} onClick={() => save({ ...k, hl: { ...k.hl, straight: !k.hl.straight } })}>
              <IconHighlighter />
            </button>
          </div>
        )}
        {tool === 'eraser' && (
          <div className="ink-seg">
            <button className={'ink-btn' + (e.prefs.eraserReturn ? ' is-toggled' : '')} {...tip('다 지우면 이전 도구로')} onClick={() => (e.setPrefs({ eraserReturn: !e.prefs.eraserReturn }), close())}>
              <IconUndoInk />
            </button>
          </div>
        )}
      </div>
    )
  }
  if (kind === 'width') {
    const key = tool === 'highlighter' ? 'highlighter' : tool === 'tape' ? 'tape' : tool === 'eraser' ? 'eraser' : k.pen.kind === 'pencil' ? 'pencil' : 'pen'
    const spec = WIDTHS[key]
    const cur = tool === 'highlighter' ? k.hl.width : tool === 'tape' ? k.tape.width : tool === 'eraser' ? k.eraser.size : k.pen.width
    const set = (w: number) => {
      const n = { ...k }
      if (tool === 'highlighter') n.hl = { ...n.hl, width: w }
      else if (tool === 'tape') n.tape = { ...n.tape, width: w }
      else if (tool === 'eraser') n.eraser = { ...n.eraser, size: w }
      else n.pen = { ...n.pen, width: w }
      save(n)
    }
    return (
      <div className={cls}>
        <div className="ink-seg">
          {spec.steps.map((w, i) => (
            <button
              key={w}
              className={'ink-btn' + (Math.abs(cur - w) < 0.01 ? ' is-on' : '')}
              {...tip(['가늘게', '보통', '굵게'][i]!)}
              onClick={() => {
                if (!fine) {
                  set(w)
                  close()
                }
              }}
              onPointerDown={() => (longT.current = window.setTimeout(() => setFine(true), T.fingerLongMs))}
              onPointerUp={() => clearTimeout(longT.current)}
              onPointerLeave={() => clearTimeout(longT.current)}
            >
              <i className="ink-wdot" style={{ width: [6, 10, 14][i], height: [6, 10, 14][i], background: tool === 'eraser' ? 'transparent' : 'currentColor' }} />
            </button>
          ))}
        </div>
        {fine && <input className="ink-range" type="range" min={spec.min} max={spec.max} step={0.1} value={cur} onChange={(ev) => set(+ev.target.value)} aria-label="굵기" />}
      </div>
    )
  }
  // 색 팝오버
  const list = tool === 'highlighter' ? HL_COLORS.map((h) => ({ hex: h, show: h })) : tool === 'tape' ? TAPE_COLORS.map((s) => ({ hex: s.hex, show: e.night ? s.night : s.hex })) : PEN_COLORS.map((s) => ({ hex: s.hex, show: e.night ? s.night : s.hex }))
  const setSlot = (hex: string) => {
    const n = { ...k }
    if (tool === 'highlighter') n.hl = { ...n.hl, slots: n.hl.slots.map((c, i) => (i === n.hl.sel ? hex : c)) }
    else if (tool === 'tape') n.tape = { ...n.tape, slots: n.tape.slots.map((c, i) => (i === n.tape.sel ? hex : c)) }
    else n.pen = { ...n.pen, slots: n.pen.slots.map((c, i) => (i === n.pen.sel ? hex : c)) }
    save(n)
    close()
  }
  return (
    <div className={cls + ' ink-colors' + (list.length > 6 ? ' is-12' : '')}>
      {list.map((c) => (
        <button key={c.hex} className="ink-btn ink-sw" aria-label={c.hex} onClick={() => setSlot(c.hex)}>
          <IconColorDot color={c.show} size={28} />
        </button>
      ))}
      {tool !== 'highlighter' && tool !== 'tape' && (
        <label className="ink-btn ink-custom" {...tip('직접')}>
          <input type="color" onChange={(ev) => setSlot(ev.target.value.toUpperCase())} />
        </label>
      )}
    </div>
  )
}

/* ---------- 둥근 메뉴 (3장) ---------- */

const PIE: Array<{ id: string; name: string; icon: ReactNode }> = [
  { id: 'paste', name: '붙이기', icon: <IconPaste /> },
  { id: 'text', name: '글 상자', icon: <IconTextBox /> },
  { id: 'image', name: '사진', icon: <IconImage /> },
  { id: 'page', name: '쪽 추가', icon: <IconPageAdd /> },
  { id: 'template', name: '쪽 틀', icon: <IconTemplate /> },
  { id: 'shape', name: '도형', icon: <IconShape /> },
]

function RadialMenu({ engine: e }: { engine: InkEngine }) {
  const [m, setM] = useState<{ x: number; y: number; at: PieEvent; pinned: boolean; hot: number } | null>(null)
  const [tpl, setTpl] = useState<{ x: number; y: number; pageId: string } | null>(null)
  const R = phone() ? 76 : 88, C = phone() ? 26 : 28
  const close = () => setM(null)
  useLayer(!!m, 'ink-pie', close)
  useLayer(!!tpl, 'ink-tpl', () => setTpl(null))
  const wedge = (x: number, y: number, cx: number, cy: number) => {
    const dx = x - cx, dy = y - cy
    if (Math.hypot(dx, dy) < C) return -1
    const a = (Math.atan2(dx, -dy) * 180) / Math.PI
    return Math.round(((a + 360) % 360) / 60) % 6
  }
  const act = (i: number, p: PieEvent) => {
    close()
    const at = p.pageId ? { pageId: p.pageId, x: p.px, y: p.py } : undefined
    const id = PIE[i]?.id
    if (id === 'paste') void e.paste(at)
    else if (id === 'text') void e.insertText(at)
    else if (id === 'image') void e.pickFile('image/*').then((f) => f && e.insertImage(f, at))
    else if (id === 'page') e.addPage(p.pageId ?? undefined)
    else if (id === 'template' && p.pageId) setTpl({ x: p.x, y: p.y, pageId: p.pageId })
    else if (id === 'shape') e.shapeOnce(true)
  }
  useEffect(
    () =>
      e.on('pie', (p) => {
        const host = e.host.getBoundingClientRect()
        if (p.phase === 'open') {
          const x = Math.max(R + 12, Math.min(host.width - R - 12, p.x)), y = Math.max(R + 12, Math.min(host.height - R - 12, p.y))
          setM({ x, y, at: p, pinned: p.pointerType === 'mouse', hot: -1 })
        } else if (p.phase === 'move') setM((cur) => (cur ? { ...cur, hot: wedge(p.x, p.y, cur.x, cur.y) } : cur))
        else if (p.phase === 'up')
          setM((cur) => {
            if (!cur) return cur
            const i = Number.isFinite(p.x) ? wedge(p.x, p.y, cur.x, cur.y) : -1
            if (i >= 0) {
              queueMicrotask(() => act(i, cur.at))
              return null
            }
            return { ...cur, pinned: true, hot: -1 }
          })
        else if (p.phase === 'cancel') setM(null)
      }),
    [e],
  )
  return (
    <>
      {m && (
        <div className="ink-pie-scrim" data-ink-ui="" onPointerDown={(ev) => ev.target === ev.currentTarget && close()}>
          <div className="ink-pie" style={{ left: m.x - R, top: m.y - R, width: R * 2, height: R * 2 }} role="menu" aria-label="둥근 메뉴">
            {PIE.map((w, i) => {
              const a = (i * 60 * Math.PI) / 180
              const r = phone() ? 50 : 58
              return (
                <button key={w.id} className={'ink-pie-btn' + (m.hot === i ? ' is-hot' : '')} style={{ left: R + Math.sin(a) * r - 22, top: R - Math.cos(a) * r - 22 }} {...tip(w.name)} onClick={() => act(i, m.at)}>
                  {w.icon}
                </button>
              )
            })}
            <button className="ink-pie-mid" style={{ left: R - C, top: R - C, width: C * 2, height: C * 2 }} aria-label="취소" onClick={close}>
              <i />
            </button>
          </div>
        </div>
      )}
      {tpl && (
        <div className="ink-pop ink-tpl-row" data-ink-ui="" style={{ left: tpl.x, top: tpl.y }}>
          {(['blank', 'ruled', 'grid', 'dot', 'cornell'] as const).map((t) => (
            <button
              key={t}
              className={'ink-tpl' + (e.doc.byId.get(tpl.pageId)?.page.template === t ? ' is-on' : '')}
              {...tip(TEMPLATE_NAME[t])}
              onClick={() => {
                e.setTemplate(tpl.pageId, t)
                setTpl(null)
              }}
            >
              <TemplateArt t={t} />
            </button>
          ))}
        </div>
      )}
    </>
  )
}

function TemplateArt({ t }: { t: PageTemplate }) {
  return (
    <svg width="40" height="56" viewBox="0 0 40 56" aria-hidden="true">
      <rect x=".5" y=".5" width="39" height="55" rx="3" fill="var(--surface-3)" stroke="var(--border)" />
      {t === 'ruled' && [12, 18, 24, 30, 36, 42, 48].map((y) => <path key={y} d={`M4 ${y}h32`} stroke="var(--text-3)" strokeWidth=".6" />)}
      {t === 'grid' && [...[8, 14, 20, 26, 32].map((x) => <path key={'x' + x} d={`M${x} 4v48`} stroke="var(--text-3)" strokeWidth=".5" />), ...[8, 14, 20, 26, 32, 38, 44, 50].map((y) => <path key={'y' + y} d={`M4 ${y}h32`} stroke="var(--text-3)" strokeWidth=".5" />)]}
      {t === 'dot' && [8, 14, 20, 26, 32].flatMap((x) => [8, 14, 20, 26, 32, 38, 44, 50].map((y) => <circle key={x + '-' + y} cx={x} cy={y} r=".7" fill="var(--text-3)" />))}
      {t === 'cornell' && (
        <g stroke="var(--text-3)" strokeWidth=".7">
          <path d="M1 10h38M13 10v34M1 44h38" />
        </g>
      )}
    </svg>
  )
}

/* ---------- 선택 칸 (6장) ---------- */

function SelectionBar({ engine: e }: { engine: InkEngine }) {
  const [s, setS] = useState<SelectionInfo | null>(e.selectionInfo)
  const [colors, setColors] = useState(false)
  const [more, setMore] = useState(false)
  const [copied, setCopied] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  useEffect(() => e.on('selection', (v) => setS(v)), [e])
  useEffect(() => {
    if (!s) {
      setColors(false)
      setMore(false)
    }
  }, [s])
  useLayer(!!s, 'ink-sel', () => {
    const d = drawerClose.get(e)
    if (d) {
      d()
      return false
    }
    e.clearSelection()
  })
  useLayoutEffect(() => {
    if (!s || !ref.current) return setPos(null)
    const w = ref.current.offsetWidth, h = ref.current.offsetHeight
    const W = e.view.W, H = e.view.H
    let y = s.rect.y - 12 - h
    if (y < 64) y = s.rect.y + s.rect.h + 12
    if (y + h > H - 12) y = 64
    const x = Math.max(12, Math.min(W - 12 - w, s.rect.x + s.rect.w / 2 - w / 2))
    setPos({ x, y })
  }, [s, e])
  if (!s) return null
  const tape = s.only === 'tape'
  return (
    <div ref={ref} className={'ink-sel' + (s.dragging ? ' is-drag' : '')} data-ink-ui="" style={pos ? { left: pos.x, top: pos.y } : { visibility: 'hidden' }} role="toolbar" aria-label="고른 것">
      {tape ? (
        <button className={'ink-btn' + (s.flag ? ' is-toggled' : '')} {...tip('헷갈림')} onClick={() => e.toggleFlag()}>
          <IconUnsure />
        </button>
      ) : s.only !== 'image' ? (
        <button className="ink-btn" {...tip('색')} onClick={() => setColors(!colors)}>
          <IconColorDot color={s.color ? (s.highlight ? s.color : inkColor(s.color, e.night)) : 'conic-gradient(red, blue)'} size={20} />
        </button>
      ) : null}
      {!tape && (
        <button className="ink-btn" {...tip('가리기')} onClick={() => e.coverSelection()}>
          <IconTape />
        </button>
      )}
      <button
        className="ink-btn"
        {...tip('복사', { kbd: '⌘C' })}
        onClick={() => {
          e.copySelection()
          setCopied(true)
          setTimeout(() => setCopied(false), 300)
        }}
      >
        {copied ? '✓' : <IconCopy />}
      </button>
      <button className="ink-btn" {...tip('복제', { kbd: '⌘D' })} onClick={() => e.duplicateSelection()}>
        <IconDuplicate />
      </button>
      <button className="ink-btn" {...tip('지우기', { kbd: 'Delete' })} onClick={() => e.deleteSelection()}>
        <IconTrash />
      </button>
      {!tape && (
        <button className="ink-btn" {...tip('더 보기')} onClick={() => setMore(!more)}>
          <IconMore />
        </button>
      )}
      {colors && (
        <div className="ink-pop ink-colors is-12 at-top">
          {(s.highlight ? HL_COLORS.map((h) => ({ hex: h, night: h })) : PEN_COLORS).map((c) => (
            <button
              key={c.hex}
              className="ink-btn ink-sw"
              aria-label={c.hex}
              onClick={() => {
                e.setSelectionColor(c.hex)
                setColors(false)
              }}
            >
              <IconColorDot color={e.night ? c.night : c.hex} size={28} />
            </button>
          ))}
        </div>
      )}
      {more && (
        <div className="ink-pop at-top ink-seg">
          <button className="ink-btn" {...tip('잘라내기', { kbd: '⌘X' })} onClick={() => e.cutSelection()}>
            <IconCut />
          </button>
          <button
            className="ink-btn"
            {...tip('그림으로 저장')}
            onClick={() =>
              void e.selectionPng().then((b) => {
                if (!b) return
                const a = document.createElement('a')
                a.href = URL.createObjectURL(b)
                a.download = 'gyeol-ink.png'
                a.click()
                setTimeout(() => URL.revokeObjectURL(a.href), 2000)
              })
            }
          >
            <IconImage />
          </button>
          {s.items > 0 && (
            <>
              <button className="ink-btn" {...tip('맨 앞으로')} onClick={() => e.arrangeSelection('front')}>
                ⤒
              </button>
              <button className="ink-btn" {...tip('맨 뒤로')} onClick={() => e.arrangeSelection('back')}>
                ⤓
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

/* ---------- 쪽 번호 · 되돌리기 칩 · 테이프 칩 ---------- */

function PageNumber({ engine: e }: { engine: InkEngine }) {
  const [v, setV] = useState<ViewInfo | null>(null)
  const [show, setShow] = useState(phone())
  const t = useRef(0)
  useEffect(
    () =>
      e.on('view', (info) => {
        setV(info)
        if (phone()) return setShow(true)
        if (info.moving) {
          setShow(true)
          clearTimeout(t.current)
          t.current = window.setTimeout(() => setShow(false), 900)
        }
      }),
    [e],
  )
  if (!v || v.pages < 1) return null
  return (
    <button className={'ink-pageno' + (show ? ' is-on' : '') + (phone() ? ' is-phone' : '')} data-ink-ui="" {...tip('쪽 서랍', { kbd: 'G' })} onClick={() => e.emit('ui', { id: 'ink.drawer' })}>
      {v.page + 1} / {v.pages}
    </button>
  )
}

function UndoChip({ engine: e, edge }: { engine: InkEngine; edge: Edge }) {
  const [c, setC] = useState<{ kind: 'undo' | 'redo'; ok: boolean; n: number; key: number } | null>(null)
  const t = useRef(0)
  useEffect(
    () =>
      e.on('undo', (u) => {
        setC({ ...u, key: performance.now() })
        clearTimeout(t.current)
        t.current = window.setTimeout(() => setC(null), 800)
      }),
    [e],
  )
  if (!c) return null
  return (
    <div key={c.key} className={'ink-undo at-' + edge + (c.ok ? '' : ' is-wall')} data-ink-ui="" aria-live="polite">
      {c.kind === 'undo' ? <IconUndoInk size={16} /> : <IconRedo size={16} />}
      {c.n > 1 && <b>{c.n}</b>}
    </div>
  )
}

function TapeChips({ engine: e }: { engine: InkEngine }) {
  const [pages, setPages] = useState<PageInfo[]>(e.pageInfos())
  const [, setTick] = useState(0)
  useEffect(() => {
    const a = e.on('pages', setPages)
    const b = e.on('view', () => setTick((x) => x + 1))
    return () => {
      a()
      b()
    }
  }, [e])
  const v = e.view
  const [i0, i1] = v.range(0)
  if (i0 < 0) return null
  const out: ReactNode[] = []
  for (let i = i0; i <= i1; i++) {
    const b = v.boxes[i]
    const p = pages.find((x) => x.id === b?.id)
    if (!b || !p || !p.tapes.total) continue
    const [sx, sy] = v.toScreen(b.x + b.w, b.y)
    const outside = v.W - sx >= 56 + 8
    const all = p.tapes.revealed === p.tapes.total
    out.push(
      <button
        key={p.id}
        className={'ink-tapechip' + (all ? ' is-done' : '')}
        data-ink-ui=""
        style={{ left: outside ? sx + 8 : sx - 8, top: Math.max(8, sy + 8), transform: outside ? 'none' : 'translateX(-100%)' }}
        {...tip(all ? '다시 붙이기' : '모두 걷기', { kbd: '⇧T' })}
        onClick={() => e.toggleAllTapes(p.id)}
      >
        <IconTape size={16} />
        <span>
          {p.tapes.revealed}/{p.tapes.total}
        </span>
      </button>,
    )
  }
  return <>{out}</>
}

/* ---------- 쪽 서랍 (5장) ---------- */

function PageDrawer({ engine: e, title, onRename }: { engine: InkEngine; title?: string; onRename?: (t: string) => void }) {
  const [open, setOpen] = useState(false)
  const [pages, setPages] = useState<PageInfo[]>(e.pageInfos())
  const [cur, setCur] = useState(0)
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const [menu, setMenu] = useState<string | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [name, setName] = useState(title ?? '')
  const [editing, setEditing] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const q = useRef<{ list: string[]; busy: boolean }>({ list: [], busy: false })
  useLayer(open, 'ink-drawer', () => setOpen(false))
  useEffect(() => {
    if (!open) return
    drawerClose.set(e, () => setOpen(false))
    return () => {
      drawerClose.delete(e)
    }
  }, [open, e])
  useEffect(() => {
    if (title !== undefined) setName(title)
    else void e.db.notes.get(e.noteId).then((n) => n && setName(n.title))
  }, [e, title])
  // 썸네일: 보이는 근처부터, 쉴 때 하나씩 (200쪽 넘는 PDF도 막히지 않게)
  const pump = () => {
    const s = q.current
    if (s.busy) return
    const id = s.list.shift()
    if (!id) return
    s.busy = true
    const idle = (window as Window & { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number }).requestIdleCallback ?? ((f: () => void) => window.setTimeout(f, 16))
    idle(
      () =>
        void e.thumbnail(id, 240).then(
          (c) => {
            if (c) setThumbs((t) => ({ ...t, [id]: c.toDataURL('image/png') }))
            s.busy = false
            pump()
          },
          () => {
            s.busy = false
            pump()
          },
        ),
      { timeout: 500 },
    )
  }
  const want = (id: string) => {
    const s = q.current
    if (!s.list.includes(id)) s.list.unshift(id)
    pump()
  }
  useEffect(() => {
    const offs = [
      e.on('pages', setPages),
      e.on('view', (v) => setCur(v.page)),
      e.on('ui', ({ id }) => {
        if (id === 'ink.drawer') setOpen((o) => !o)
        if (id === 'ink.rename') {
          setOpen(true)
          setEditing(true)
        }
      }),
      e.on('edgeswipe', () => setOpen(true)),
      e.on('thumb', ({ pageId }) =>
        setThumbs((t) => {
          if (!(pageId in t)) return t
          const n = { ...t }
          delete n[pageId]
          return n
        }),
      ),
    ]
    return () => offs.forEach((f) => f())
  }, [e])
  useEffect(() => {
    const root = listRef.current
    if (!open || !root || typeof IntersectionObserver !== 'function') return
    const io = new IntersectionObserver(
      (ents) => {
        for (const en of ents) {
          const id = (en.target as HTMLElement).dataset.page
          if (en.isIntersecting && id && !thumbs[id]) want(id)
        }
      },
      { root, rootMargin: '600px' },
    )
    root.querySelectorAll('[data-page]').forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [open, pages, thumbs])
  const rename = (t: string) => {
    setEditing(false)
    const v = t.trim()
    if (!v || v === name) return
    setName(v)
    if (onRename) onRename(v)
    else void e.db.notes.update(e.noteId, { title: v, updatedAt: Date.now() }).catch(() => {})
  }
  if (!open) return null
  const W = phone() ? undefined : innerWidth > 1200 ? 196 : 168
  const onThumbDown = (id: string, ev: React.PointerEvent) => {
    const y0 = ev.clientY
    const t0 = performance.now()
    let lifted = false
    const lift = window.setTimeout(() => {
      lifted = true
      setDragId(id)
    }, ev.pointerType === 'mouse' ? 0 : 300)
    const menuT = window.setTimeout(() => setMenu(id), 650)
    const move = (m: PointerEvent) => {
      if (Math.abs(m.clientY - y0) > T.tapMove) clearTimeout(menuT)
      if (!lifted && Math.abs(m.clientY - y0) > T.tapMove && performance.now() - t0 < 300) {
        clearTimeout(lift)
        cleanup()
      }
    }
    const up = (u: PointerEvent) => {
      clearTimeout(lift)
      clearTimeout(menuT)
      cleanup()
      setDragId(null)
      if (lifted && Math.abs(u.clientY - y0) > 20 && listRef.current) {
        const items = [...listRef.current.querySelectorAll<HTMLElement>('[data-page]')]
        let to = items.findIndex((el) => u.clientY < el.getBoundingClientRect().top + el.offsetHeight / 2)
        if (to < 0) to = items.length
        const from = pages.findIndex((p) => p.id === id)
        e.movePage(id, to > from ? to - 1 : to)
      } else if (Math.abs(u.clientY - y0) <= T.tapMove && performance.now() - t0 < 650) {
        e.scrollToPage(id)
        if (phone()) setOpen(false)
      }
    }
    const cleanup = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  return (
    <aside className={'ink-drawer' + (phone() ? ' is-phone' : '')} data-ink-ui="" style={W ? { width: W } : undefined} aria-label="쪽 서랍">
      <div className="ink-drawer-head">
        {editing ? (
          <input
            className="ink-drawer-title"
            defaultValue={name}
            autoFocus
            aria-label="노트 이름"
            onKeyDown={(ev) => {
              if (ev.nativeEvent.isComposing || ev.keyCode === 229) return
              if (ev.key === 'Enter') rename((ev.target as HTMLInputElement).value)
              if (ev.key === 'Escape') {
                ev.stopPropagation()
                setEditing(false)
              }
            }}
            onBlur={(ev) => rename(ev.target.value)}
          />
        ) : (
          <button className="ink-drawer-title" {...tip('이름 바꾸기')} onClick={() => setEditing(true)}>
            {name || '\u00a0'}
          </button>
        )}
        <button className="ink-btn" {...tip('PDF 가져오기')} onClick={() => run('ink.pdf.import', e)}>
          <IconPdfIn size={20} />
        </button>
        <button className="ink-btn" {...tip('내보내기')} onClick={() => e.emit('ui', { id: 'ink.export.open' })}>
          <IconShare size={20} />
        </button>
      </div>
      <div className="ink-drawer-list" ref={listRef}>
        {pages.map((p, i) => (
          <div key={p.id} data-page={p.id} className={'ink-thumb' + (i === cur ? ' is-cur' : '') + (dragId === p.id ? ' is-lift' : '')} onPointerDown={(ev) => onThumbDown(p.id, ev)}>
            <div className="ink-thumb-img" style={{ aspectRatio: `${p.w} / ${p.h}` }}>
              {thumbs[p.id] && <img src={thumbs[p.id]} alt="" draggable={false} />}
              {p.tapes.total > 0 && <i className="ink-thumb-tape" style={{ background: tapeColor(p.tapes.color, e.night) }} />}
            </div>
            <span>{i + 1}</span>
            {menu === p.id && (
              <div className="ink-pop ink-seg ink-thumb-menu" onPointerDown={(ev) => ev.stopPropagation()}>
                <button className="ink-btn" {...tip('쪽 복제')} onClick={() => (void e.duplicatePage(p.id), setMenu(null))}>
                  <IconDuplicate />
                </button>
                <button className="ink-btn" {...tip('뒤에 새 쪽')} onClick={() => (e.addPage(p.id), setMenu(null))}>
                  <IconPageAdd />
                </button>
                <button className="ink-btn" disabled={pages.length < 2} {...tip('쪽 지우기')} onClick={() => (e.deletePage(p.id), setMenu(null))}>
                  <IconTrash />
                </button>
                {(['blank', 'ruled', 'grid', 'dot', 'cornell'] as const).map((t) => (
                  <button key={t} className={'ink-tpl is-small' + (p.template === t ? ' is-on' : '')} {...tip(TEMPLATE_NAME[t])} onClick={() => (e.setTemplate(p.id, t), setMenu(null))}>
                    <TemplateArt t={t} />
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
        <button className="ink-thumb-add" {...tip('쪽 추가')} onClick={() => e.addPage('end')}>
          <IconPlus />
        </button>
      </div>
    </aside>
  )
}

/* ---------- 내보내기 (5-4): PDF 전체 · 이 쪽 그림, 테이프 뺌(기본)/포함 ---------- */

async function deliver(blob: Blob, name: string, kind: 'pdf' | 'png', onExport?: (kind: 'pdf' | 'png', blob: Blob) => void): Promise<void> {
  if (onExport) return onExport(kind, blob)
  const file = new File([blob], name, { type: blob.type })
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  if (ios && nav.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] })
      return
    } catch {
      /* 취소 → 내려받기 */
    }
  }
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 4000)
}

function ExportPop({ engine: e, onExport }: { engine: InkEngine; onExport?: (kind: 'pdf' | 'png', blob: Blob) => void }) {
  const [open, setOpen] = useState(false)
  const [tapes, setTapes] = useState<'none' | 'hidden'>('none')
  const [busy, setBusy] = useState<null | 'pdf' | 'png'>(null)
  const [done, setDone] = useState(0)
  const [fail, setFail] = useState(0)
  useLayer(open, 'ink-export', () => setOpen(false))
  const go = async (kind: 'pdf' | 'png', t: 'none' | 'hidden' = tapes) => {
    if (busy) return
    setBusy(kind)
    setDone(0)
    setFail(0)
    let ok = false
    try {
      const stamp = new Date().toISOString().slice(0, 10)
      if (kind === 'pdf') await deliver(await e.exportPdf({ tapes: t }), `gyeol-${stamp}.pdf`, 'pdf', onExport)
      else {
        const b = await e.exportPng(undefined, { tapes: t })
        if (!b) throw new Error('no page')
        await deliver(b, `gyeol-${stamp}.png`, 'png', onExport)
      }
      ok = true
    } catch (err) {
      e.emit('error', err instanceof Error ? err : new Error(String(err)))
      setFail((n) => n + 1)
    } finally {
      setBusy(null)
      if (ok) setTimeout(() => setOpen(false), 300)
    }
  }
  useEffect(() => {
    const offs = [
      e.on('ui', ({ id }) => {
        if (id === 'ink.export.open') setOpen((o) => !o)
        else if (id === 'ink.export.pdf' || id === 'ink.export.png') {
          setOpen(true)
          void go(id === 'ink.export.pdf' ? 'pdf' : 'png', 'none')
        }
      }),
      e.on('progress', (p) => p.kind === 'export' && setDone(p.done / Math.max(1, p.total))),
    ]
    return () => offs.forEach((f) => f())
  })
  if (!open) return null
  const arc = (on: boolean) =>
    on ? (
      <svg className="ink-arc" viewBox="0 0 48 48" aria-hidden="true">
        <circle cx="24" cy="24" r="21" pathLength="100" style={{ strokeDasharray: `${Math.max(4, done * 100)} 100` }} />
      </svg>
    ) : null
  return (
    <div key={fail} className={'ink-pop ink-export' + (fail ? ' is-fail' : '')} data-ink-ui="" role="dialog" aria-label="내보내기">
      <span className="ink-sr" aria-live="polite">{fail ? '내보낼 수 없어요' : busy ? '만드는 중' : ''}</span>
      <button className="ink-btn" {...tip('PDF 전체')} onClick={() => void go('pdf')}>
        <IconShare />
        {arc(busy === 'pdf')}
      </button>
      <button className="ink-btn" {...tip('이 쪽 그림')} onClick={() => void go('png')}>
        <IconImage />
        {arc(busy === 'png')}
      </button>
      <i className="ink-sep" />
      <button className={'ink-btn' + (tapes === 'hidden' ? ' is-toggled' : '')} {...tip(tapes === 'hidden' ? '테이프 포함' : '테이프 뺌')} aria-pressed={tapes === 'hidden'} onClick={() => setTapes(tapes === 'none' ? 'hidden' : 'none')}>
        <IconTape />
      </button>
    </div>
  )
}

/* ---------- 첫 회 무음 안내 (4-5): 그림만, 한 번 열 때 하나 ---------- */

const bump = (k: string): number => {
  try {
    const n = Number(localStorage.getItem(k) ?? '0') + 1
    localStorage.setItem(k, String(n))
    return n
  } catch {
    return 0
  }
}
const OPP: Record<Edge, Edge> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }
const Fin = ({ x, y, c = 'ih-tap' }: { x: number; y: number; c?: string }) => <circle className={c} cx={x} cy={y} r="6" />
const ART: Record<string, ReactNode> = {
  'ink-undo': (
    <>
      <path className="ih-draw" d="M14 46c12-18 26-18 38 0s26 18 38 0" />
      <Fin x={52} y={30} c="ih-tap ih-late" />
      <Fin x={70} y={30} c="ih-tap ih-late" />
    </>
  ),
  'ink-pie': (
    <>
      <Fin x={60} y={36} />
      <circle className="ih-ring" cx="60" cy="36" r="16" />
      {[0, 60, 120, 180, 240, 300].map((a) => (
        <circle key={a} className="ih-pie" cx={60 + Math.sin((a * Math.PI) / 180) * 26} cy={36 - Math.cos((a * Math.PI) / 180) * 26} r="2" />
      ))}
    </>
  ),
  'ink-tape': (
    <>
      <path d="M16 36h88" opacity=".4" />
      <rect className="ih-tape" x="30" y="28" width="60" height="16" rx="1" />
      <Fin x={60} y={36} />
    </>
  ),
  'ink-drawer': (
    <>
      <Fin x={10} y={36} c="ih-swipe" />
      {[0, 1, 2].map((i) => (
        <rect key={i} className="ih-thumb" x={14 + i * 4} y={14 + i * 16} width="18" height="12" rx="1.5" style={{ animationDelay: `${i * 80}ms` }} />
      ))}
    </>
  ),
  'ink-scratch': (
    <>
      <path className="ih-word" d="M24 38c6-10 10 6 16-2s8-8 14 2 10-6 16 0 8 6 14-2" />
      <path className="ih-zig" d="M22 30l10 14 8-14 10 14 8-14 10 14 8-14 10 14" />
    </>
  ),
}
const HINT_LABEL: Record<string, string> = {
  'ink-undo': '두 손가락으로 톡 치면 되돌리기',
  'ink-pie': '빈 곳을 길게 누르면 둥근 메뉴',
  'ink-tape': '테이프를 누르면 걷히고 다시 붙는다',
  'ink-drawer': '왼쪽 가장자리에서 밀면 쪽 서랍',
  'ink-scratch': '펜으로 긁으면 그 아래 획이 지워진다',
}

function HintCard({ id, active, edge, onShow }: { id: string; active: boolean; edge: Edge; onShow: (id: string) => void }) {
  const h = useHint(id, active)
  useEffect(() => {
    if (h.visible) onShow(id)
  }, [h.visible, id, onShow])
  if (!h.visible) return null
  return (
    <div className={'ink-hint at-' + OPP[edge]} data-ink-ui="" role="img" aria-label={HINT_LABEL[id]} onPointerDown={h.dismiss}>
      <svg viewBox="0 0 120 72" width="120" height="72" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {ART[id]}
      </svg>
    </div>
  )
}

function InkHints({ engine: e, edge }: { engine: InkEngine; edge: Edge }) {
  const [c, setC] = useState({ 'ink-undo': false, 'ink-pie': false, 'ink-tape': false, 'ink-drawer': false, 'ink-scratch': false } as Record<string, boolean>)
  const [shown, setShown] = useState<string | null>(null)
  const on = (k: string) => setC((x) => (x[k] ? x : { ...x, [k]: true }))
  useEffect(() => {
    if (bump('gyeol.ink.opens') >= 3) on('ink-pie')
    const offs = [
      e.on('inkend', () => on('ink-undo')),
      e.on('pages', (ps) => {
        if (ps.some((p) => p.tapes.total > 0)) on('ink-tape')
        if (ps.length >= 2 && e.standalone) on('ink-drawer')
      }),
      e.on('tool', (t) => t === 'eraser' && bump('gyeol.ink.eraserPicks') >= 3 && on('ink-scratch')),
      e.on('ui', ({ id }) => id === 'hint.pie' && on('ink-pie')),
    ]
    return () => offs.forEach((f) => f())
  }, [e])
  return (
    <>
      {Object.keys(ART).map((id) => (
        <HintCard key={id} id={id} active={!!c[id] && (!shown || shown === id)} edge={edge} onShow={setShown} />
      ))}
    </>
  )
}

/** 펜이 처음 감지될 때: 카드 없이 구슬 옆 손가락 아이콘에 사선, 1.2초에 흐려진다 */
function PenOnlyMark({ engine: e, pill }: { engine: InkEngine; pill: RefObject<HTMLDivElement | null> }) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null)
  useEffect(
    () =>
      e.on('penOnly', (v) => {
        if (!v) return
        try {
          if (localStorage.getItem('gyeol.ink.penOnlyShown')) return
          localStorage.setItem('gyeol.ink.penOnlyShown', '1')
        } catch {
          return
        }
        const r = pill.current?.getBoundingClientRect()
        const h = e.host.getBoundingClientRect()
        if (!r) return
        setAt({ x: r.right - h.left + 8, y: r.top - h.top + r.height / 2 })
        setTimeout(() => setAt(null), 1400)
      }),
    [e, pill],
  )
  if (!at) return null
  return (
    <div className="ink-penonly" style={{ left: at.x, top: at.y }} aria-hidden="true">
      <IconFinger size={20} />
      <svg className="ink-penonly-slash" viewBox="0 0 24 24" width="20" height="20">
        <path d="M5 19L19 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </div>
  )
}
