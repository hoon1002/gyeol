/**
 * 결 — 은하수 시제품 (http://127.0.0.1:5173/galaxy.html). 개발 전용, 앱 빌드에 들어가지 않는다.
 * 문구·구도·색은 team/design-v3.md (§2 하늘, §3 색, §4-2 문구, §5 모션, §6 데이터 별, §7 화면 설계).
 *
 * URL 옵션: ?scene=today-night|today-class|today-class-day|focus|review|graph|notes|hero|cover
 *           &ui=0(글·UI 숨김, 데이터 별은 남김)  &chrome=0(시연 메뉴 숨김)  &still=1(동작 줄이기 흉내)
 *           &meteors=0  &tier=A|B|C  &hud=1(FPS)  &seed=숫자(기본 1016)
 *  장면 이미지용: &virtual=1180x820&res=2&k=1&ox=0&oy=0&freeze=30
 *           (가상 화면 크기로 그리고, css px당 res배 내부 해상도, 화면에는 k배로 펼쳐 ox·oy부터 보여 준다 → 조각을 이어 붙인다)
 */
import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import './galaxy.css'
import { Sky, type SkyStats, type SpecialStar, type Tier } from './sky/sky'
import { deviceOf, type SceneName } from './sky/compositions'
import { C, DOCK, SCENE_COPY, examStar, graphStars, makeGraph, reviewStars, todayStarPositions, type DockId } from './scenes'

const SCENES: SceneName[] = ['today-class', 'today-night', 'today-class-day', 'focus', 'review', 'graph', 'notes', 'hero', 'cover']

function useViewport() {
  const [vp, setVp] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }))
  useEffect(() => {
    const on = () => setVp({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return vp
}

function useReducedMotion() {
  const q = '(prefers-reduced-motion: reduce)'
  const [r, setR] = useState(() => window.matchMedia(q).matches)
  useEffect(() => {
    const mq = window.matchMedia(q)
    const on = () => setR(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return r
}

/** 화면마다 하늘의 데이터 층 (v3 §6) */
function dataStars(scene: SceneName, w: number, h: number, now: number, relit: number, relitAt: number): SpecialStar[] {
  const today = (n: number, k = 1, born = -1): SpecialStar[] =>
    todayStarPositions(n, w, h).map(([x, y], i) => ({
      x,
      y,
      L: 220 * k,
      color: C.gold,
      mode: i === born ? 'birth' : 'still',
      t0: i === born ? now + 0.6 : undefined,
    }))
  switch (scene) {
    case 'today-class':
    case 'today-class-day':
      return [...today(2), examStar(w, h)]
    case 'today-night':
      return [...today(5), examStar(w, h)]
    case 'focus': {
      const pts = todayStarPositions(6, w, h)
      const [nx, ny] = pts[5]!
      return [...today(5, 0.6), { x: nx, y: ny, L: 220, color: C.gold, mode: 'focus' as const }]
    }
    case 'review':
      return reviewStars(w, h, relit, now, relitAt)
    case 'graph':
      return graphStars(makeGraph(w, h))
    default:
      return []
  }
}

function App() {
  const params = useMemo(() => new URLSearchParams(location.search), [])
  const initial = (params.get('scene') as SceneName) || 'today-night'
  const [scene, setScene] = useState<SceneName>(SCENES.includes(initial) ? initial : 'today-night')
  const [shown, setShown] = useState<SceneName>(scene)
  const [fade, setFade] = useState<'in' | 'out'>('in')
  const [ui, setUi] = useState(params.get('ui') !== '0')
  const chrome = params.get('chrome') !== '0'
  const [menu, setMenu] = useState(false)
  const [meteors, setMeteors] = useState(params.get('meteors') !== '0')
  const [still, setStill] = useState(params.get('still') === '1')
  const [tier, setTier] = useState<'auto' | Tier>((params.get('tier') as Tier) || 'auto')
  const [hud, setHud] = useState(params.get('hud') === '1')
  const [stats, setStats] = useState<SkyStats | null>(null)
  const [failed, setFailed] = useState(false)
  const osReduced = useReducedMotion()
  const reduced = still || osReduced
  const realVp = useViewport()
  const virtual = useMemo(() => {
    const m = /^(\d+)x(\d+)$/.exec(params.get('virtual') ?? '')
    if (!m) return null
    return {
      w: Number(m[1]),
      h: Number(m[2]),
      res: Number(params.get('res')) || 2,
      k: Number(params.get('k')) || 1,
      ox: Number(params.get('ox')) || 0,
      oy: Number(params.get('oy')) || 0,
    }
  }, [params])
  const freeze = params.get('freeze') != null ? Number(params.get('freeze')) || 30 : null
  const vp = virtual ? { w: virtual.w, h: virtual.h } : realVp
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const skyRef = useRef<Sky | null>(null)
  const seed = Number(params.get('seed')) || 1016

  // 집중: 25분 중 15:00 남음(시연)
  const TOTAL = 25 * 60
  const [elapsed, setElapsed] = useState(10 * 60)
  const [running, setRunning] = useState(params.get('focus') !== 'idle')
  // 복습
  const [relit, setRelit] = useState(0)
  const [relitAt, setRelitAt] = useState(0)
  const [reviewing, setReviewing] = useState(false)

  /* 하늘 */
  useEffect(() => {
    const cv = canvasRef.current
    if (!cv) return
    let sky: Sky
    try {
      sky = new Sky(cv, { seed, tier, reduced, meteors, freeze })
    } catch {
      setFailed(true)
      return
    }
    skyRef.current = sky
    sky.onStats = setStats
    sky.setScene(scene, true)
    sky.resize(vp.w, vp.h, virtual?.res ?? 0)
    ;(window as Window & { __sky?: Sky }).__sky = sky
    return () => {
      sky.destroy()
      skyRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!virtual) skyRef.current?.resize(vp.w, vp.h)
  }, [vp.w, vp.h, virtual])
  useEffect(() => skyRef.current?.setReduced(reduced), [reduced])
  useEffect(() => skyRef.current?.setMeteors(meteors), [meteors])
  useEffect(() => skyRef.current?.setTier(tier), [tier])

  /* 화면 전환: 하늘은 노출만 900ms 보간, 내용은 나감 160ms → 들어옴 280ms (이동 0) */
  useEffect(() => {
    skyRef.current?.setScene(scene)
    if (scene === shown) return
    if (reduced) {
      setShown(scene)
      return
    }
    setFade('out')
    const t = window.setTimeout(() => {
      setShown(scene)
      setFade('in')
    }, 160)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene])

  /* 데이터 별 */
  const focusP = elapsed / TOTAL
  useEffect(() => {
    const sky = skyRef.current
    if (!sky) return
    sky.setSpecial(dataStars(scene, vp.w, vp.h, sky.now(), relit, relitAt))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, vp.w, vp.h, relit])
  useEffect(() => skyRef.current?.setFocus(focusP), [focusP])
  useEffect(() => {
    if (!running || shown !== 'focus') return
    const id = window.setInterval(() => setElapsed((e) => Math.min(TOTAL, e + 1)), 1000)
    return () => window.clearInterval(id)
  }, [running, shown, TOTAL])

  // 복습 시연: 평가할 때마다 별 하나가 다시 빛난다 (0.7초 간격)
  useEffect(() => {
    if (!reviewing) return
    if (relit >= 13) {
      setReviewing(false)
      return
    }
    const t = window.setTimeout(() => {
      setRelitAt(skyRef.current?.now() ?? 0)
      setRelit((r) => r + 1)
    }, relit === 0 ? 150 : 700)
    return () => window.clearTimeout(t)
  }, [reviewing, relit])

  /* 포인터·펜: 근처 별이 밝아질 뿐(위치 이동 0). 누르면 그 자리 별빛이 잠깐 밝아진다 */
  useEffect(() => {
    const move = (e: PointerEvent) => skyRef.current?.pointer(e.clientX, e.clientY, e.pointerType)
    const out = (e: PointerEvent) => {
      if (!e.relatedTarget) skyRef.current?.pointerLeave()
    }
    window.addEventListener('pointermove', move, { passive: true })
    window.addEventListener('pointerout', out, { passive: true })
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerout', out)
    }
  }, [])
  const onStageDown = useCallback((e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button, a, .menu')) return
    skyRef.current?.tap(e.clientX, e.clientY)
  }, [])

  const go = (s: SceneName) => {
    setMenu(false)
    if (s !== scene) setScene(s)
  }
  const goDock = (id: DockId) => {
    if (id === 'today') go(scene === 'today-class' || scene === 'today-class-day' ? scene : 'today-night')
    else if (id === 'planner') return
    else go(id)
  }

  const dev = deviceOf(vp.w, vp.h)
  const phone = dev === 'phone'
  const copy = SCENE_COPY[shown]
  const day = shown === 'today-class-day'
  const focusing = shown === 'focus' && running
  const activeDock: DockId = shown === 'today-class' || shown === 'today-night' || shown === 'today-class-day' ? 'today' : (shown as DockId)

  /* 글자 (v3 §7) */
  let body: ReactNode = null
  if (shown === 'focus') {
    const remain = TOTAL - elapsed
    const mmss = `${String(Math.floor(remain / 60)).padStart(2, '0')}:${String(remain % 60).padStart(2, '0')}`
    body = (
      <section className="g-fx" data-fade={fade}>
        <p className="g-fx-noun">{copy.noun}</p>
        <p className="g-timer" role="timer" aria-label={`남은 시간 ${Math.ceil(remain / 60)}분`}>
          {mmss}
        </p>
        <div className="g-line g-line-focus" aria-hidden="true">
          <i style={{ width: `${focusP * 100}%` }} />
        </div>
        {running ? (
          <button type="button" className="g-glass-b" aria-label="일시정지" onClick={() => setRunning(false)}>
            <PauseIcon />
          </button>
        ) : (
          <div className="g-row">
            <button type="button" className="g-star-b" onClick={() => setRunning(true)}>
              {elapsed > 0 ? '이어서' : '시작'}
            </button>
            {elapsed === 0 && <span className="g-meta">25 · 50 · 90</span>}
            {elapsed > 0 && (
              <button
                type="button"
                className="g-quiet"
                onClick={() => {
                  setElapsed(0)
                  setRunning(false)
                }}
              >
                끝내기
              </button>
            )}
          </div>
        )}
      </section>
    )
  } else if (shown !== 'hero' && shown !== 'cover') {
    let noun = copy.noun
    let meta = copy.meta
    let action = copy.action
    let onAction: (() => void) | undefined
    if (shown === 'review') {
      const left = 13 - relit
      if (left <= 0) {
        noun = '복습 끝'
        meta = '내일 2장'
        action = '한 번 더'
        onAction = () => setRelit(0)
      } else {
        meta = `${left}장 · ${Math.max(1, Math.round(left * 0.6))}분`
        action = reviewing ? '다시 빛나는 중' : '시작'
        onAction = () => setReviewing(true)
      }
    } else if (shown === 'today-night') onAction = () => go('focus')
    else if (shown === 'today-class' || shown === 'today-class-day' || shown === 'graph') onAction = () => go('notes')
    body = (
      <section className={`g-focus g-focus-${shown}`} data-fade={fade} aria-label={copy.aria}>
        <h1 className="g-noun">{noun}</h1>
        <p className="g-meta">{meta}</p>
        {copy.progress != null && (
          <div className="g-line" role="img" aria-label={copy.aria}>
            <i style={{ width: `${copy.progress * 100}%` }} />
          </div>
        )}
        <div className="g-row">
          <button type="button" className="g-star-b" onClick={onAction} disabled={shown === 'review' && reviewing}>
            {action}
          </button>
          {copy.aux === 'mic' && (
            <button type="button" className="g-icon-b" aria-label="녹음하며 쓰기">
              <MicIcon />
            </button>
          )}
          {copy.aux === 'plus' && (
            <button type="button" className="g-icon-b" aria-label="새 노트">
              <PlusIcon />
            </button>
          )}
        </div>
      </section>
    )
  }

  const stageStyle: CSSProperties | undefined = virtual
    ? { left: -virtual.ox, top: -virtual.oy, width: virtual.w * virtual.k, height: virtual.h * virtual.k, right: 'auto', bottom: 'auto' }
    : undefined

  return (
    <div className="g-root" data-dev={dev} data-ui={ui ? '1' : '0'} data-day={day ? '1' : '0'} data-focusing={focusing ? '1' : '0'} onPointerDown={onStageDown}>
      <div className="g-stage" style={stageStyle}>
        <canvas ref={canvasRef} className="g-sky" aria-hidden="true" />
        {failed && <div className="g-fallback" aria-hidden="true" />}
        <DataLayer scene={shown} w={vp.w} h={vp.h} fade={fade} />
      </div>

      {ui && (
        <>
          <header className="g-top">
            <Mark />
            <button type="button" className="g-lens">
              <i />
              전체
            </button>
            <span className="g-top-r">
              <button type="button" className="g-icon-b g-search" aria-label="검색">
                <SearchIcon />
              </button>
              <button type="button" className="g-profile" aria-label="시연 메뉴" aria-expanded={menu} onClick={() => chrome && setMenu((m) => !m)}>
                도
              </button>
            </span>
          </header>

          {body}

          {copy.horizon && shown !== 'focus' && (
            <p className="g-horizon" data-fade={fade} aria-label={copy.aria}>
              {copy.horizon.map((it, i) => (
                <span key={i}>
                  {it.dot && <i style={{ background: it.dot }} />}
                  {it.text}
                </span>
              ))}
            </p>
          )}

          {shown === 'notes' && <PaperPreview fade={fade} />}

          <nav className="g-dock" aria-label="공간">
            {DOCK.filter((d) => !phone || d.phone).map((d) => (
              <button key={d.id} type="button" className="g-dock-b" aria-current={activeDock === d.id ? 'page' : undefined} aria-label={d.label} onClick={() => goDock(d.id)}>
                <DockIcon id={d.id} />
              </button>
            ))}
            <span className="g-dock-sep" />
            <button type="button" className="g-dock-b" aria-label="검색·명령">
              <SearchIcon />
            </button>
          </nav>
        </>
      )}

      {chrome && menu && (
        <div className="menu g-menu" role="dialog" aria-label="시연 메뉴">
          <MenuGroup title="장면">
            <div className="g-grid">
              {SCENES.map((s) => (
                <button key={s} type="button" className="g-chip" aria-pressed={scene === s} onClick={() => go(s)}>
                  {s}
                </button>
              ))}
            </div>
          </MenuGroup>
          <MenuGroup title="움직임">
            <Toggle on={meteors} set={setMeteors} label="유성 (평균 3분 1회, 오늘에서만)" />
            <button type="button" className="g-chip wide" onClick={() => skyRef.current?.meteorNow()} disabled={!meteors || reduced}>
              지금 유성 하나
            </button>
            <Toggle on={still} set={setStill} label={osReduced ? '정지 (기기 설정 · 동작 줄이기)' : '정지 장면 보기'} />
            <Toggle on={ui} set={setUi} label="글 보이기" />
          </MenuGroup>
          <MenuGroup title="성능">
            <div className="g-seg">
              {(['auto', 'A', 'B', 'C'] as const).map((t) => (
                <button key={t} type="button" aria-pressed={tier === t} onClick={() => setTier(t)}>
                  {t === 'auto' ? '자동' : t}
                </button>
              ))}
            </div>
            <Toggle on={hud} set={setHud} label="FPS 표시" />
          </MenuGroup>
        </div>
      )}

      {hud && stats && (
        <div className="g-hud" aria-hidden="true">
          {stats.fps} fps · 등급 {stats.tier} · {stats.res.toFixed(2)}× {stats.megapixels.toFixed(1)}MP · 별 {(stats.stars / 1000).toFixed(0)}k (매 프레임 {stats.bright}) · 별가루 {stats.dust} · 굽기 {stats.bakeMs.toFixed(0)}ms · js {stats.jsMs.toFixed(2)}ms
        </div>
      )}
    </div>
  )
}

/** 하늘 위 선 · 성운 (별 자체는 WebGL이 그린다) */
function DataLayer({ scene, w, h, fade }: { scene: SceneName; w: number; h: number; fade: 'in' | 'out' }) {
  const graph = useMemo(() => (scene === 'graph' ? makeGraph(w, h) : null), [scene, w, h])
  const today = useMemo(() => (scene === 'today-night' ? todayStarPositions(5, w, h) : null), [scene, w, h])
  if (!graph && !today) return null
  return (
    <svg className="g-data" data-fade={fade} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        {graph?.clusters.map((c, i) => (
          <radialGradient key={i} id={`neb${i}`}>
            <stop offset="0" stopColor={c.color} stopOpacity="0.08" />
            <stop offset="1" stopColor={c.color} stopOpacity="0" />
          </radialGradient>
        ))}
      </defs>
      {graph?.clusters.map((c, i) => (
        <ellipse key={i} cx={c.x * w} cy={c.y * h} rx={c.r * 1.15} ry={c.r * 0.85} fill={`url(#neb${i})`} />
      ))}
      {graph?.edges.map(([a, b], i) => {
        const p = graph.nodes[a]!
        const q = graph.nodes[b]!
        const sel = p.selected || q.selected
        return <line key={i} x1={p.x * w} y1={p.y * h} x2={q.x * w} y2={q.y * h} className={sel ? 'sel' : undefined} />
      })}
      {today &&
        today.slice(1).map(([x, y], i) => {
          const [px, py] = today[i]!
          return <line key={i} className="today" x1={px * w} y1={py * h} x2={x * w} y2={y * h} />
        })}
    </svg>
  )
}

function PaperPreview({ fade }: { fade: 'in' | 'out' }) {
  return (
    <figure className="g-paper" data-fade={fade} aria-label="엔트로피와 열역학 제2법칙 미리보기">
      <svg viewBox="0 0 460 580" aria-hidden="true">
        <g fill="none" stroke="#EEECE6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity=".88">
          <path d="M46 92c10-18 20-30 26-30M60 64l-6 32m18-34-8 34M90 82h18m-14 10h16M130 74c6-6 16-6 16 4 0 12-18 18-18 18h22" />
          <path d="M168 86h20m-10-10v20M212 66c-10 0-14 26 2 26s12-26-2-26zM236 96l20-34m-18 8 22 6M270 70v26m0-26 14 0" />
          <path d="M46 160c20 0 40-4 60 0s38 6 60 0M190 150l10 10-10 10M220 160c14-10 28-10 40 0s26 10 40 0" opacity=".8" />
          <path d="M46 230c6-10 16-14 22-6s0 22 10 22 14-20 24-20 10 18 20 18M150 240h40m30-16v34M216 236c8 0 14 6 14 12M260 226c-8 8-8 24 4 26s14-18 2-24" opacity=".75" />
          <path d="M60 330c40-20 90-20 130 0s90 20 130 0" opacity=".45" />
        </g>
      </svg>
      <figcaption>p.4</figcaption>
    </figure>
  )
}

function MenuGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="g-mg">
      <h2>{title}</h2>
      {children}
    </section>
  )
}

function Toggle({ on, set, label }: { on: boolean; set: (v: boolean) => void; label: string }) {
  return (
    <button type="button" className="g-toggle" role="switch" aria-checked={on} onClick={() => set(!on)}>
      <i />
      {label}
    </button>
  )
}

/** 심볼 v3: 57° 사선 위에 작아지는 별 5개, 맨 위는 별빛 금, 끝에 인주 낙관 점 */
function Mark() {
  const pts = [0, 1, 2, 3, 4].map((i) => [20 - i * 3.3, 4 + i * 5.1, 1.9 - i * 0.28] as const)
  return (
    <svg viewBox="0 0 26 30" width="24" height="28" aria-label="결" role="img" className="g-mark">
      {pts.map(([x, y, r], i) => (
        <circle key={i} cx={x} cy={y} r={r} fill={i === 0 ? '#F3D29A' : '#F2EFE8'} opacity={i === 0 ? 1 : 0.85 - i * 0.12} />
      ))}
      <circle cx="4" cy="28" r="1.3" fill="#FF8F78" />
    </svg>
  )
}

const ic = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="6" {...ic} />
      <path d="m15 15 4.5 4.5" {...ic} />
    </svg>
  )
}
function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <rect x="9" y="3.5" width="6" height="11" rx="3" {...ic} />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5" {...ic} />
    </svg>
  )
}
function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path d="M12 5v14M5 12h14" {...ic} />
    </svg>
  )
}
function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path d="M9 6v12M15 6v12" {...ic} strokeWidth={2} />
    </svg>
  )
}
function DockIcon({ id }: { id: DockId }) {
  switch (id) {
    case 'today':
      return (
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <rect x="4" y="4" width="7" height="9" rx="2" {...ic} />
          <rect x="13" y="4" width="7" height="5" rx="2" {...ic} />
          <rect x="13" y="11" width="7" height="9" rx="2" {...ic} />
          <rect x="4" y="15" width="7" height="5" rx="2" {...ic} />
        </svg>
      )
    case 'notes':
      return (
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path d="M14.5 4.5 19.5 9.5 9 20H4v-5z" {...ic} />
        </svg>
      )
    case 'graph':
      return (
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path d="M6 17 11 7l7 4" {...ic} opacity=".6" />
          <circle cx="6" cy="17" r="1.6" fill="currentColor" />
          <circle cx="11" cy="7" r="1.6" fill="currentColor" />
          <circle cx="18" cy="11" r="1.6" fill="currentColor" />
        </svg>
      )
    case 'review':
      return (
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <rect x="5" y="7" width="12" height="13" rx="2" {...ic} />
          <path d="M8 4h11v13" {...ic} opacity=".6" />
        </svg>
      )
    case 'planner':
      return (
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <rect x="4" y="5.5" width="16" height="14" rx="2" {...ic} />
          <path d="M4 10h16M9 3.5v4M15 3.5v4" {...ic} />
        </svg>
      )
    case 'focus':
      return (
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path d="M12 4v4M12 8l3 3" {...ic} />
          <path d="M5 13a7 7 0 0 0 14 0" {...ic} />
        </svg>
      )
  }
}

// 개발 서버 HMR로 이 파일이 다시 실행돼도 루트를 하나만 쓴다
const host = document.getElementById('galaxy') as HTMLElement & { __root?: ReturnType<typeof createRoot> }
host.__root ??= createRoot(host)
host.__root.render(
  <StrictMode>
    <App />
  </StrictMode>,
)
