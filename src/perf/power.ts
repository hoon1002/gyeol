/**
 * 전력 계측 (개발 빌드 전용 — main.tsx가 import.meta.env.DEV일 때만 동적 import 한다. 프로덕션 번들에는 없다).
 *
 * 콘솔:
 *   __gyeolPower.report()        지난 reset 뒤 누적 (표 출력 + 객체 반환)
 *   await __gyeolPower.measure(10)  reset → 10초 기다림 → report (탭을 앞에 띄우고 손 떼고 잴 것)
 *   __gyeolPower.reset()
 *   __gyeolPower.snapshot()      지금 돌아가는 CSS 애니메이션 · 보이는 backdrop-filter · 전력 힌트
 *
 * 재는 것: 초당 rAF 깨우기(프레임 수) · 그중 WebGL을 실제로 그린 프레임 · rAF 안 JS ms ·
 * setTimeout/setInterval 발화 수(등록한 곳별) · React 커밋 수·시간(Probe id별, 숨은 공간 표시) ·
 * GPU ms/프레임(EXT_disjoint_timer_query_webgl2, 가능할 때) · 긴 작업 · 네트워크 요청 · JS 힙.
 * 계측 자체의 비용: rAF·타이머 콜백마다 performance.now() 2번 + 타이머 등록 때 스택 1번(개발용이라 허용).
 */

type Num = Record<string, number>

interface ReactStat {
  commits: number
  ms: number
  hiddenCommits: number
}

interface Win {
  t0: number
  rafCallbacks: number
  rafFrames: number
  drawnFrames: number
  drawCalls: number
  drawsOutsideRaf: number
  rafJsMs: number
  maxRafJsMs: number
  timeoutFires: Num
  intervalFires: Num
  timerJsMs: number
  react: Record<string, ReactStat>
  gpuMs: number[]
  longTasks: number
  longTaskMs: number
  requests: string[]
  frameGaps: number[]
  /** measure() 동안 1초마다 본 '돌고 있는 CSS/WAAPI 애니메이션' 수 (합성 / 배치·칠하기) */
  animSamples: Array<{ compositor: number; main: number }>
}

const now = () => performance.now()

const fresh = (): Win => ({
  t0: now(),
  rafCallbacks: 0,
  rafFrames: 0,
  drawnFrames: 0,
  drawCalls: 0,
  drawsOutsideRaf: 0,
  rafJsMs: 0,
  maxRafJsMs: 0,
  timeoutFires: {},
  intervalFires: {},
  timerJsMs: 0,
  react: {},
  gpuMs: [],
  longTasks: 0,
  longTaskMs: 0,
  requests: [],
  frameGaps: [],
  animSamples: [],
})

let win = fresh()
let installed = false
/** 계측 자신의 대기는 세지 않도록 원래 setTimeout */
let rawTimeout = (fn: () => void, ms: number): number => window.setTimeout(fn, ms)

/* ---------- 등록한 곳 이름 (스택에서 이 파일·라이브러리 바깥의 첫 줄) ---------- */
function caller(): string {
  const st = new Error().stack?.split('\n') ?? []
  let lib = ''
  for (const line of st.slice(2)) {
    if (line.includes('/src/perf/')) continue
    const m = line.match(/(?:https?:\/\/[^/]+)?\/([^?:)\s]+)(?:\?[^:)]*)?:(\d+)/)
    if (!m) continue
    const file = m[1]!
    if (file.includes('node_modules') || file.startsWith('@')) {
      lib ||= file.replace(/.*node_modules\/(\.vite\/deps\/)?/, '').replace(/\.js$/, '')
      continue
    }
    return `${file.replace(/^src\//, '')}:${m[2]}`
  }
  return lib ? `lib:${lib}` : '?'
}

/* ---------- WebGL 그리기 감지 + GPU 시간 ---------- */
interface GpuCtx {
  gl: WebGL2RenderingContext
  ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null
  open: WebGLQuery | null
  pending: WebGLQuery[]
}
const ctxs = new Map<WebGL2RenderingContext, GpuCtx>()
let inRaf = false
let drewThisFrame = false
let gpuOn = false

function noteDraw(gl: WebGL2RenderingContext) {
  win.drawCalls++
  if (inRaf) drewThisFrame = true
  else win.drawsOutsideRaf++
  if (!ctxs.has(gl)) {
    let ext: GpuCtx['ext'] = null
    try {
      ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as GpuCtx['ext']
    } catch {
      ext = null
    }
    ctxs.set(gl, { gl, ext, open: null, pending: [] })
  }
}

function gpuFrameBoundary() {
  if (!gpuOn) return
  for (const c of ctxs.values()) {
    const { gl, ext } = c
    if (!ext || gl.isContextLost()) continue
    // 지난 쿼리 결과 회수
    const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT) as boolean
    while (c.pending.length) {
      const q = c.pending[0]!
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break
      const ns = gl.getQueryParameter(q, gl.QUERY_RESULT) as number
      if (!disjoint) win.gpuMs.push(ns / 1e6)
      gl.deleteQuery(q)
      c.pending.shift()
    }
    if (c.open) {
      gl.endQuery(ext.TIME_ELAPSED_EXT)
      c.pending.push(c.open)
      c.open = null
    }
    if (c.pending.length < 8) {
      const q = gl.createQuery()
      if (q) {
        gl.beginQuery(ext.TIME_ELAPSED_EXT, q)
        c.open = q
      }
    }
  }
}

function gpuStop() {
  for (const c of ctxs.values()) {
    if (c.open && c.ext && !c.gl.isContextLost()) {
      c.gl.endQuery(c.ext.TIME_ELAPSED_EXT)
      c.pending.push(c.open)
    }
    c.open = null
  }
}

function patchGl() {
  const P = WebGL2RenderingContext.prototype as unknown as Record<string, (...a: unknown[]) => unknown>
  for (const name of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'drawRangeElements']) {
    const orig = P[name]
    if (!orig) continue
    P[name] = function (this: WebGL2RenderingContext, ...a: unknown[]) {
      noteDraw(this)
      return orig.apply(this, a)
    }
  }
}

/* ---------- rAF ---------- */
let lastFrameT = -1

function patchRaf() {
  const orig = window.requestAnimationFrame.bind(window)
  window.requestAnimationFrame = (cb: FrameRequestCallback) =>
    orig((t) => {
      if (t !== lastFrameT) {
        // 새 프레임의 첫 콜백
        if (lastFrameT >= 0) {
          win.frameGaps.push(t - lastFrameT)
          if (drewThisFrame) win.drawnFrames++
        }
        drewThisFrame = false
        lastFrameT = t
        win.rafFrames++
        gpuFrameBoundary()
      }
      win.rafCallbacks++
      const s = now()
      inRaf = true
      try {
        cb(t)
      } finally {
        inRaf = false
        const d = now() - s
        win.rafJsMs += d
        if (d > win.maxRafJsMs) win.maxRafJsMs = d
      }
    })
}

/* ---------- 타이머 ---------- */
function patchTimers() {
  const st = window.setTimeout.bind(window)
  rawTimeout = (fn, ms) => st(fn, ms)
  const si = window.setInterval.bind(window)
  const wrap = (bucket: 'timeoutFires' | 'intervalFires', fn: unknown, label: string) =>
    typeof fn !== 'function'
      ? fn
      : (...a: unknown[]) => {
          const m = win[bucket]
          m[label] = (m[label] ?? 0) + 1
          const s = now()
          try {
            ;(fn as (...x: unknown[]) => void)(...a)
          } finally {
            win.timerJsMs += now() - s
          }
        }
  ;(window as unknown as { setTimeout: unknown }).setTimeout = (fn: unknown, ms?: number, ...a: unknown[]) =>
    st(wrap('timeoutFires', fn, caller()) as TimerHandler, ms, ...a)
  ;(window as unknown as { setInterval: unknown }).setInterval = (fn: unknown, ms?: number, ...a: unknown[]) =>
    si(wrap('intervalFires', fn, `${caller()} (${ms ?? 0}ms)`) as TimerHandler, ms, ...a)
}

/* ---------- React (Probe가 호출) ---------- */
function onReact(id: string, ms: number) {
  const r = (win.react[id] ??= { commits: 0, ms: 0, hiddenCommits: 0 })
  r.commits++
  r.ms += ms
  if (id.startsWith('/') && document.querySelector(`.space[data-path="${id}"][data-inactive]`)) r.hiddenCommits++
}

/* ---------- 관찰자 ---------- */
function observe() {
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        win.longTasks++
        win.longTaskMs += e.duration
      }
    }).observe({ type: 'longtask', buffered: false })
  } catch {
    /* 지원 안 함 */
  }
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) win.requests.push(e.name.replace(location.origin, ''))
    }).observe({ type: 'resource', buffered: false })
  } catch {
    /* 지원 안 함 */
  }
}

/* ---------- 보고 ---------- */
const r1 = (x: number) => Math.round(x * 10) / 10
const pct = (a: number[], p: number) => {
  if (!a.length) return 0
  const s = [...a].sort((x, y) => x - y)
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]!
}

function visible(el: Element): boolean {
  const c = el as Element & { checkVisibility?: (o?: object) => boolean }
  return c.checkVisibility ? c.checkVisibility({ visibilityProperty: true, opacityProperty: true }) : true
}

function snapshot() {
  const anims = document.getAnimations().filter((a) => a.playState === 'running')
  const rows = anims.map((a) => {
    const eff = a.effect as KeyframeEffect | null
    const el = eff?.target ?? null
    const timing = eff?.getComputedTiming()
    const name = (a as CSSAnimation).animationName ?? (a as CSSTransition).transitionProperty ?? a.id ?? 'waapi'
    return {
      name,
      target: el ? `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''}` : '-',
      infinite: timing?.iterations === Infinity,
      visible: el ? visible(el) : false,
    }
  })
  const blurs: Array<{ el: string; filter: string; area: number }> = []
  for (const el of document.querySelectorAll('body *')) {
    const f = getComputedStyle(el).backdropFilter
    if (!f || f === 'none' || !visible(el)) continue
    const r = el.getBoundingClientRect()
    if (r.width * r.height < 1) continue
    blurs.push({ el: `${el.tagName.toLowerCase()}.${String(el.className).trim().split(/\s+/).join('.')}`, filter: f, area: Math.round(r.width * r.height) })
  }
  const vp = innerWidth * innerHeight
  const nav = navigator as Navigator & { connection?: { saveData?: boolean } }
  return {
    animations: rows,
    infiniteVisible: rows.filter((r) => r.infinite && r.visible).length,
    infiniteHidden: rows.filter((r) => r.infinite && !r.visible).length,
    backdrop: blurs,
    backdropAreaPct: r1((100 * blurs.reduce((s, b) => s + b.area, 0)) / vp),
    hints: {
      hidden: document.hidden,
      focus: document.hasFocus(),
      dpr: devicePixelRatio,
      css: `${innerWidth}×${innerHeight}`,
      saveData: !!nav.connection?.saveData,
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      motion: document.documentElement.dataset.motion,
    },
  }
}

/** 합성 스레드에서 끝나는 속성 외(left·width·color…)는 프레임마다 메인 스레드 스타일·배치·칠하기를 부른다 */
const COMPOSITOR_PROPS = new Set(['opacity', 'transform', 'translate', 'scale', 'rotate', 'filter'])
function sampleAnims() {
  let compositor = 0
  let main = 0
  for (const a of document.getAnimations()) {
    if (a.playState !== 'running') continue
    const eff = a.effect as KeyframeEffect | null
    const props = new Set<string>()
    try {
      for (const k of eff?.getKeyframes() ?? []) for (const p of Object.keys(k)) if (!['offset', 'easing', 'composite', 'computedOffset'].includes(p)) props.add(p)
    } catch {
      /* 무시 */
    }
    const tp = (a as CSSTransition).transitionProperty
    if (tp) props.add(tp)
    if ([...props].every((p) => COMPOSITOR_PROPS.has(p))) compositor++
    else main++
  }
  win.animSamples.push({ compositor, main })
}

function report(print = true) {
  const sec = Math.max(0.001, (now() - win.t0) / 1000)
  const per = (n: number) => r1(n / sec)
  const sum = (m: Num) => Object.values(m).reduce((s, x) => s + x, 0)
  const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
  const sky = (window as Window & { __gyeolPerf?: { stats?: () => Record<string, unknown> } }).__gyeolPerf?.stats?.()
  const gpuAvail = [...ctxs.values()].some((c) => !!c.ext)
  const out = {
    seconds: r1(sec),
    rafFramesPerSec: per(win.rafFrames),
    drawnFramesPerSec: per(win.drawnFrames),
    drawCallsPerFrame: win.drawnFrames ? r1(win.drawCalls / win.drawnFrames) : 0,
    drawsOutsideRaf: win.drawsOutsideRaf,
    rafCallbacksPerSec: per(win.rafCallbacks),
    rafJsMsPerFrame: win.rafFrames ? r1(win.rafJsMs / win.rafFrames) : 0,
    rafJsMaxMs: r1(win.maxRafJsMs),
    frameGapP95Ms: r1(pct(win.frameGaps, 0.95)),
    timeoutsPerSec: per(sum(win.timeoutFires)),
    intervalsPerSec: per(sum(win.intervalFires)),
    wakeupsPerSec: per(win.rafFrames + sum(win.timeoutFires) + sum(win.intervalFires)),
    timerJsMsPerSec: per(win.timerJsMs),
    gpu: !gpuOn ? 'off (measure()에서 켜짐)' : !gpuAvail ? 'EXT_disjoint_timer_query_webgl2 없음' : win.gpuMs.length ? { frames: win.gpuMs.length, avgMs: r1(win.gpuMs.reduce((s, x) => s + x, 0) / win.gpuMs.length), p95Ms: r1(pct(win.gpuMs, 0.95)), msPerSec: per(win.gpuMs.reduce((s, x) => s + x, 0)) } : '표본 0',
    reactCommitsPerSec: per(Object.entries(win.react).filter(([k]) => k === 'root').reduce((s, [, v]) => s + v.commits, 0)),
    react: Object.fromEntries(Object.entries(win.react).map(([k, v]) => [k, { commits: v.commits, ms: r1(v.ms), hiddenCommits: v.hiddenCommits }])),
    longTasks: win.longTasks,
    longTaskMs: r1(win.longTaskMs),
    animSecMain: win.animSamples.filter((x) => x.main > 0).length,
    animSecCompositor: win.animSamples.filter((x) => x.compositor > 0).length,
    requests: win.requests.length,
    requestList: win.requests.slice(0, 20),
    heapMB: mem ? r1(mem.usedJSHeapSize / 1048576) : null,
    skyGpuMB: sky && typeof sky.memMB === 'number' ? sky.memMB : null,
    timeouts: { ...win.timeoutFires },
    intervals: { ...win.intervalFires },
  }
  if (print) {
    const { react, timeouts, intervals, requestList, ...head } = out
    console.groupCollapsed(`[결 전력] ${out.seconds}s · 그림 ${out.drawnFramesPerSec}fps · 깨우기 ${out.wakeupsPerSec}/s`)
    console.table(head)
    if (Object.keys(react).length) console.table(react)
    if (Object.keys(timeouts).length) console.table(timeouts)
    if (Object.keys(intervals).length) console.table(intervals)
    if (requestList.length) console.log('requests', requestList)
    console.groupEnd()
  }
  return out
}

function reset() {
  win = fresh()
  lastFrameT = -1
  drewThisFrame = false
}

async function measure(seconds = 10, opts: { gpu?: boolean } = {}) {
  gpuOn = opts.gpu !== false
  reset()
  for (let i = 1; i < seconds; i++) rawTimeout(sampleAnims, i * 1000 - 500)
  await new Promise<void>((res) => rawTimeout(res, seconds * 1000))
  const out = report()
  gpuStop()
  gpuOn = false
  return out
}

export function install(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  patchRaf()
  patchTimers()
  if (typeof WebGL2RenderingContext !== 'undefined') patchGl()
  observe()
  ;(window as Window & { __gyeolPowerReact?: typeof onReact }).__gyeolPowerReact = onReact
  ;(window as Window & { __gyeolPower?: unknown }).__gyeolPower = { report, reset, measure, snapshot, gpu: (on = true) => (gpuOn = on) }
}
