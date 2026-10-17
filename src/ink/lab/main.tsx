/**
 * 결 손글씨 실험실 — 개발 전용 (http://127.0.0.1:5173/ink.html). 빌드에는 들어가지 않는다.
 * 사용자 DB를 쓰지 않는다: 시험용 Dexie DB 'gyeol-inklab' · 노트 'lab-note'.
 * 모든 도구 · 쪽 · PDF · 내보내기 · 합성 2,000획 · 성능 계측 창. CDP 시험은 window.__ink를 쓴다.
 */
import { StrictMode, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../../styles/tokens.css'
import '../../styles/base.css'
import './lab.css'
import { openInkLabDB } from '@/db/ink'
import type { PageTemplate } from '@/db/schema'
import { InkSurface } from '../InkSurface'
import type { InkEngine } from '../engine'
import { HL_COLORS, PEN_COLORS, TAPE_COLORS, WIDTHS } from '../palette'
import type { PageInfo, SelectionInfo, ToolName } from '../types'

const db = openInkLabDB('gyeol-inklab')
const NOTE = new URLSearchParams(location.search).get('note') || 'lab-note'

/* ---------- 프레임 계측 (rAF 간격 · 긴 프레임) ---------- */
const frames: number[] = []
let lastRaf = 0
let loafMax = 0
function rafLoop(t: number) {
  if (lastRaf) {
    frames.push(t - lastRaf)
    if (frames.length > 240) frames.shift()
  }
  lastRaf = t
  requestAnimationFrame(rafLoop)
}
requestAnimationFrame(rafLoop)
/** 긴 애니메이션 프레임 기록 (원인 찾기: 스크립트별 시간 · 렌더 시작) */
const loafs: Array<{ at: number; dur: number; block: number; render: number; style: number; scripts: string[] }> = []
try {
  new PerformanceObserver((l) => {
    for (const e of l.getEntries() as Array<PerformanceEntry & { blockingDuration?: number; renderStart?: number; styleAndLayoutStart?: number; scripts?: Array<{ invoker?: string; duration: number; sourceFunctionName?: string; sourceURL?: string }> }>) {
      loafMax = Math.max(loafMax, e.duration)
      loafs.push({
        at: Math.round(e.startTime),
        dur: Math.round(e.duration),
        block: Math.round(e.blockingDuration ?? 0),
        render: Math.round((e.startTime + e.duration) - (e.renderStart ?? e.startTime)),
        style: Math.round((e.startTime + e.duration) - (e.styleAndLayoutStart ?? e.startTime)),
        scripts: (e.scripts ?? []).map((s) => `${s.invoker ?? ''} ${Math.round(s.duration)}ms ${s.sourceFunctionName ?? ''} ${(s.sourceURL ?? '').split('/').pop()}`),
      })
      if (loafs.length > 50) loafs.shift()
    }
  }).observe({ type: 'long-animation-frame', buffered: false })
} catch {
  /* 없는 브라우저 */
}

/** 기록 창: start → stop 사이 rAF 간격 최댓값 */
const rec = { on: false, max: 0, n: 0, sum: 0, last: 0, over16: 0, over20: 0 }
function recLoop(t: number) {
  if (!rec.on) return
  if (rec.last) {
    const d = t - rec.last
    rec.max = Math.max(rec.max, d)
    rec.n++
    rec.sum += d
    if (d > 16.9) rec.over16++
    if (d > 20) rec.over20++
  }
  rec.last = t
  requestAnimationFrame(recLoop)
}
function recStart() {
  Object.assign(rec, { on: true, max: 0, n: 0, sum: 0, last: 0, over16: 0, over20: 0 })
  loafMax = 0
  requestAnimationFrame(recLoop)
}
function recStop() {
  rec.on = false
  return { maxFrame: +rec.max.toFixed(2), avgFrame: rec.n ? +(rec.sum / rec.n).toFixed(2) : 0, frames: rec.n, over16: rec.over16, over20: rec.over20, loafMax: +loafMax.toFixed(1) }
}

/** 넘기기 시험: 위에서 아래로 dur ms 동안 굴린다 (실제 이동 경로와 같은 view.scrollBy) */
async function scrollTest(eng: InkEngine, dur = 3000, pxPerFrame = 28) {
  const v = eng.view
  v.stop()
  recStart()
  eng.viewChanged(true)
  const t0 = performance.now()
  let dir = 1
  await new Promise<void>((res) => {
    const step = () => {
      const before = v.vy
      v.scrollBy(0, pxPerFrame * dir)
      if (v.vy === before) dir = -dir
      eng.viewChanged(true)
      if (performance.now() - t0 < dur) requestAnimationFrame(step)
      else res()
    }
    requestAnimationFrame(step)
  })
  eng.viewChanged(false)
  await new Promise((r) => setTimeout(r, 400))
  return recStop()
}

/** 확대 시험: 가운데를 붙든 채 100% → 300% → 100%를 dur ms 동안 (핀치와 같은 view.zoomAt) */
async function zoomTest(eng: InkEngine, dur = 3000) {
  const v = eng.view
  v.stop()
  recStart()
  eng.viewChanged(true)
  const t0 = performance.now()
  await new Promise<void>((res) => {
    const step = () => {
      const t = (performance.now() - t0) / dur
      const z = 1 + 2 * Math.sin(Math.min(1, t) * Math.PI)
      v.zoomAt(v.fit * z, v.W / 2, v.H / 2)
      eng.viewChanged(true)
      if (t < 1) requestAnimationFrame(step)
      else res()
    }
    requestAnimationFrame(step)
  })
  eng.viewChanged(false)
  await new Promise((r) => setTimeout(r, 800))
  return recStop()
}

declare global {
  interface Window {
    __ink?: {
      engine: InkEngine | null
      db: typeof db
      loafs: typeof loafs
      recStart: typeof recStart
      recStop: typeof recStop
      scrollTest: (dur?: number, px?: number) => Promise<ReturnType<typeof recStop>>
      zoomTest: (dur?: number) => Promise<ReturnType<typeof recStop>>
      reset: () => Promise<void>
    }
  }
}

function Lab() {
  const [eng, setEng] = useState<InkEngine | null>(null)
  const [tool, setTool] = useState<ToolName>('pen')
  const [pages, setPages] = useState<PageInfo[]>([])
  const [sel, setSel] = useState<SelectionInfo | null>(null)
  const [hist, setHist] = useState({ canUndo: false, canRedo: false })
  const [penOnly, setPenOnly] = useState(false)
  const [night, setNight] = useState(true)
  const [msg, setMsg] = useState('')
  const [stats, setStats] = useState('')
  const [, force] = useState(0)
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const [exportUrl, setExportUrl] = useState<{ url: string; name: string } | null>(null)
  const pdfIn = useRef<HTMLInputElement>(null)
  const imgIn = useRef<HTMLInputElement>(null)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', night ? 'dark' : 'light')
  }, [night])

  useEffect(() => {
    if (!eng) return
    const offs = [
      eng.on('tool', setTool),
      eng.on('pages', setPages),
      eng.on('selection', setSel),
      eng.on('history', setHist),
      eng.on('penOnly', setPenOnly),
      eng.on('style', () => force((x) => x + 1)),
      eng.on('pie', (p) => p.phase === 'open' && setMsg(`둥근 메뉴 열림 (${p.pointerType}) · 쪽 ${p.px.toFixed(0)},${p.py.toFixed(0)}`)),
      eng.on('undo', (u) => setMsg(`${u.kind} ${u.ok ? '✓' : '없음'} ${u.n > 1 ? '×' + u.n : ''}`)),
      eng.on('ui', (u) => setMsg(`UI 명령: ${u.id}`)),
      eng.on('error', (e) => setMsg('오류: ' + e.message)),
      eng.on('progress', (p) => setMsg(`${p.kind} ${p.done}/${p.total}`)),
    ]
    setPages(eng.pageInfos())
    setPenOnly(eng.penOnly)
    window.__ink = {
      engine: eng,
      db,
      loafs,
      recStart,
      recStop,
      scrollTest: (d, px) => scrollTest(eng, d, px),
      zoomTest: (d) => zoomTest(eng, d),
      reset: async () => {
        await db.delete()
        location.reload()
      },
    }
    const t = setInterval(() => {
      const s = eng.stats()
      const fr = frames.length ? Math.max(...frames.slice(-120)) : 0
      setStats(
        `획 ${s.strokes} · 쪽 ${s.pages}(읽음 ${s.loadedPages}, 보임 ${s.visiblePages}) · 캔버스 ${s.canvasMPx}MPx · 일감 ${s.jobs}\n` +
          `입력 JS ${s.inputAvg.toFixed(2)} / 최대 ${s.inputMax.toFixed(2)}ms (${s.inputEvents}점) · 입력→그림 ${s.latencyAvg.toFixed(2)} / ${s.latencyMax.toFixed(2)}ms\n` +
          `프레임 최장(2초) ${fr.toFixed(1)}ms · 엔진 프레임 작업 ${s.frameWorkAvg.toFixed(2)} / 최대 ${s.frameWorkMax.toFixed(2)}ms · LoAF ${loafMax.toFixed(0)}ms`,
      )
    }, 500)
    return () => {
      offs.forEach((f) => f())
      clearInterval(t)
    }
  }, [eng])

  // 썸네일 (서랍 대용 줄)
  useEffect(() => {
    if (!eng) return
    let dead = false
    const make = async (ids: string[]) => {
      for (const id of ids) {
        const c = await eng.thumbnail(id, 72)
        if (dead || !c) continue
        const url = c.toDataURL()
        setThumbs((t) => ({ ...t, [id]: url }))
      }
    }
    void make(pages.slice(0, 30).map((p) => p.id))
    const off = eng.on('thumb', ({ pageId }) => void make([pageId]))
    return () => {
      dead = true
      off()
    }
  }, [eng, pages])

  const run = async (label: string, f: () => unknown) => {
    setMsg(label + '…')
    try {
      const r = await f()
      setMsg(label + ' ✓' + (r !== undefined ? ' ' + JSON.stringify(r) : ''))
    } catch (e) {
      setMsg(label + ' ✗ ' + (e as Error).message)
    }
  }

  const cur = eng?.currentPage()
  const penW = eng ? (eng.pen.kind === 'pencil' ? WIDTHS.pencil.steps : WIDTHS.pen.steps) : WIDTHS.pen.steps

  return (
    <div className="lab">
      <div className="lab-bar" data-ink-ui="">
        <div className="row">
          {(['pen', 'highlighter', 'eraser', 'lasso', 'tape', 'text', 'hand'] as ToolName[]).map((t) => (
            <button key={t} className={tool === t ? 'on' : ''} onClick={() => eng?.setTool(t)}>
              {{ pen: '펜', highlighter: '형광', eraser: '지우개', lasso: '올가미', tape: '테이프', text: '글', hand: '손' }[t]}
            </button>
          ))}
          <span className="sep" />
          {(['ball', 'fountain', 'pencil'] as const).map((k) => (
            <button key={k} className={eng?.pen.kind === k ? 'on' : ''} onClick={() => (eng?.setPen({ kind: k }), force((x) => x + 1))}>
              {{ ball: '볼펜', fountain: '만년필', pencil: '연필' }[k]}
            </button>
          ))}
          <button className={eng?.shapeArmed ? 'on' : ''} onClick={() => (eng?.shapeOnce(!eng.shapeArmed), force((x) => x + 1))}>
            도형 1번
          </button>
          <span className="sep" />
          <button disabled={!hist.canUndo} onClick={() => eng?.undo()}>
            ↶
          </button>
          <button disabled={!hist.canRedo} onClick={() => eng?.redo()}>
            ↷
          </button>
        </div>
        <div className="row">
          {(tool === 'highlighter' ? HL_COLORS.map((h) => ({ hex: h, night: h })) : tool === 'tape' ? TAPE_COLORS : PEN_COLORS).map((c) => (
            <button
              key={c.hex}
              className={'sw' + ((tool === 'highlighter' ? eng?.hl.color : tool === 'tape' ? eng?.tape.color : eng?.pen.color) === c.hex ? ' on' : '')}
              style={{ background: night ? c.night : c.hex }}
              aria-label={c.hex}
              onClick={() => {
                if (!eng) return
                if (sel) eng.setSelectionColor(c.hex)
                else if (tool === 'highlighter') eng.setHighlighter({ color: c.hex })
                else if (tool === 'tape') eng.setTape({ color: c.hex })
                else eng.setPen({ color: c.hex })
                force((x) => x + 1)
              }}
            />
          ))}
          <span className="sep" />
          {(tool === 'highlighter' ? WIDTHS.highlighter.steps : tool === 'tape' ? WIDTHS.tape.steps : tool === 'eraser' ? WIDTHS.eraser.steps : penW).map((w) => (
            <button
              key={w}
              className={(tool === 'highlighter' ? eng?.hl.width : tool === 'tape' ? eng?.tape.width : tool === 'eraser' ? eng?.eraser.size : eng?.pen.width) === w ? 'on' : ''}
              onClick={() => {
                if (!eng) return
                if (tool === 'highlighter') eng.setHighlighter({ width: w })
                else if (tool === 'tape') eng.setTape({ width: w })
                else if (tool === 'eraser') eng.setEraser({ size: w })
                else eng.setPen({ width: w })
                force((x) => x + 1)
              }}
            >
              {w}
            </button>
          ))}
          {tool === 'eraser' && (
            <button onClick={() => (eng?.setEraser({ mode: eng.eraser.mode === 'stroke' ? 'partial' : 'stroke' }), force((x) => x + 1))}>{eng?.eraser.mode === 'stroke' ? '획 통째' : '부분'}</button>
          )}
          {tool === 'pen' && (
            <input type="range" min={0.5} max={8} step={0.1} value={eng?.pen.width ?? 2} onChange={(e) => (eng?.setPen({ width: +e.target.value }), force((x) => x + 1))} aria-label="미세 굵기" />
          )}
          {tool === 'highlighter' && (
            <button className={eng?.hl.straight ? 'on' : ''} onClick={() => (eng?.setHighlighter({ straight: !eng.hl.straight }), force((x) => x + 1))}>
              곧게
            </button>
          )}
        </div>
        <div className="row">
          <button onClick={() => eng?.addPage()}>쪽+ 뒤</button>
          <button onClick={() => eng?.addPage('end')}>쪽+ 끝</button>
          <button disabled={!cur || pages.length < 2} onClick={() => cur && eng?.deletePage(cur.id)}>
            쪽 지우기
          </button>
          <button disabled={!cur} onClick={() => cur && eng?.movePage(cur.id, Math.max(0, (pages.findIndex((p) => p.id === cur.id) ?? 0) - 1))}>
            쪽 ↑
          </button>
          <button disabled={!cur} onClick={() => cur && eng?.movePage(cur.id, (pages.findIndex((p) => p.id === cur.id) ?? 0) + 1)}>
            쪽 ↓
          </button>
          <select value={cur?.page.template ?? 'blank'} onChange={(e) => cur && eng?.setTemplate(cur.id, e.target.value as PageTemplate)} aria-label="쪽 틀">
            {(['blank', 'ruled', 'grid', 'dot', 'cornell'] as const).map((t) => (
              <option key={t} value={t}>
                {{ blank: '빈', ruled: '줄', grid: '모눈', dot: '점', cornell: '코넬' }[t]}
              </option>
            ))}
          </select>
          <span className="sep" />
          <button onClick={() => pdfIn.current?.click()}>PDF 가져오기</button>
          <input ref={pdfIn} type="file" accept="application/pdf" hidden onChange={(e) => e.target.files?.[0] && run('PDF', () => eng?.importPdf(e.target.files![0]!).then((r) => r.length + '쪽'))} />
          <button onClick={() => imgIn.current?.click()}>사진</button>
          <input ref={imgIn} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && run('사진', () => eng?.insertImage(e.target.files![0]!).then(() => undefined))} />
          <button
            onClick={() =>
              run('PDF 내보내기', async () => {
                const b = await eng!.exportPdf({ tapes: 'none' })
                setExportUrl({ url: URL.createObjectURL(b), name: 'gyeol-ink.pdf' })
                return Math.round(b.size / 1024) + 'KB'
              })
            }
          >
            PDF 내보내기
          </button>
          <button
            onClick={() =>
              run('PNG', async () => {
                const b = await eng!.exportPng()
                if (!b) return
                setExportUrl({ url: URL.createObjectURL(b), name: 'gyeol-page.png' })
                return Math.round(b.size / 1024) + 'KB'
              })
            }
          >
            쪽 PNG
          </button>
          {exportUrl && (
            <a href={exportUrl.url} download={exportUrl.name}>
              받기
            </a>
          )}
        </div>
        <div className="row">
          <button onClick={() => eng?.toggleAllTapes()}>테이프 모두 ⇄</button>
          <button onClick={() => eng?.setTapes(true, 'note', { onlyFlagged: true })}>헷갈린 것만</button>
          <button className={penOnly ? 'on' : ''} onClick={() => eng?.setFingerDraw(penOnly)}>
            {penOnly ? '펜만 쓰기' : '손가락 쓰기'}
          </button>
          <button className={eng?.prefs.scratch ? 'on' : ''} onClick={() => (eng?.setPrefs({ scratch: !eng.prefs.scratch }), force((x) => x + 1))}>
            긁어 지우기
          </button>
          <button onClick={() => setNight((n) => !n)}>{night ? '밤 종이' : '낮 종이'}</button>
          <button onClick={() => eng?.zoomFit()}>맞춤</button>
          <span className="sep" />
          <button onClick={() => run('합성 2,000획', () => eng?.debugSynth(2000).then((r) => r.ms.toFixed(0) + 'ms'))}>합성 2,000획 쪽</button>
          <button onClick={() => run('넘기기 시험', () => scrollTest(eng!))}>넘기기 시험</button>
          <button onClick={() => run('확대 시험', () => zoomTest(eng!))}>확대 시험</button>
          <button onClick={() => window.__ink?.reset()}>시험 DB 비우기</button>
        </div>
        {sel && (
          <div className="row selrow">
            고른 것: 획 {sel.strokes} · 물건 {sel.items}
            <button onClick={() => eng?.copySelection()}>복사</button>
            <button onClick={() => eng?.cutSelection()}>잘라내기</button>
            <button onClick={() => eng?.duplicateSelection()}>복제</button>
            <button onClick={() => eng?.coverSelection()}>가리기</button>
            <button onClick={() => eng?.deleteSelection()}>지우기</button>
            {sel.only === 'tape' && <button onClick={() => eng?.toggleFlag()}>헷갈림 {sel.flag ? '●' : '○'}</button>}
          </div>
        )}
        {!sel && eng?.hasClipboard && (
          <div className="row">
            <button onClick={() => eng?.paste()}>붙이기</button>
          </div>
        )}
        <div className="thumbs">
          {pages.map((p) => (
            <button key={p.id} className={cur?.id === p.id ? 'on' : ''} onClick={() => eng?.scrollToPage(p.id)} aria-label={`${p.n + 1}쪽`}>
              {thumbs[p.id] ? <img src={thumbs[p.id]} alt="" /> : <span>{p.n + 1}</span>}
              {p.tapes.total > 0 && (
                <i>
                  {p.tapes.revealed}/{p.tapes.total}
                </i>
              )}
            </button>
          ))}
        </div>
        <pre className="stats">{stats}</pre>
        <div className="msg">{msg}</div>
      </div>
      <div className="lab-paper">
        <InkSurface noteId={NOTE} db={db} ui={new URLSearchParams(location.search).has('ui')} onReady={setEng} />
      </div>
    </div>
  )
}

createRoot(document.getElementById('inklab')!).render(
  <StrictMode>
    <Lab />
  </StrictMode>,
)
