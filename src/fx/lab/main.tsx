/**
 * 결 모션 실험실 — 개발 전용 (http://127.0.0.1:5173/lab.html). 빌드에는 들어가지 않는다.
 * 모든 프리셋 전환, 물결, 인주, 와이프, 데이터 고리, 등급 강제, FPS, 테마, 연출 컴포넌트를 눌러 본다.
 */
import { StrictMode, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import '../../styles/tokens.css'
import './lab.css'
import {
  ContourRibbon,
  CountUp,
  FieldMood,
  FieldProvider,
  FocusRing,
  GyeolRings,
  MOODS,
  RevealText,
  RippleSurface,
  Stamp,
  useFieldData,
  useFieldPause,
  useFieldTransition,
  useIdle,
  useMotionPrefs,
  useRipple,
  useSeal,
} from '../index'
import type { MoodName, MotionLevel, ThemeName, Tier } from '../index'
import { useFieldEngine } from '../context'
import type { FieldStats } from '../engine/engine'

const PRESETS: MoodName[] = ['landing', 'today', 'notes', 'graph', 'review', 'planner', 'focus', 'settings']

const COPY: Record<MoodName, { ko: string; eye: string; lines: [string, string]; note: string }> = {
  landing: { ko: '첫 화면', eye: '포인터가 옹이', lines: ['쓰고, 잇고,', '남긴다.'], note: '마우스나 펜을 움직여 보세요. 옹이가 손끝을 따라옵니다.' },
  today: { ko: '오늘', eye: '목요일 오전 9:32 · 7주차', lines: ['일반물리 수업 중이에요.', '43분 남았어요.'], note: '옹이 둘레 인주 고리 = 오늘 집중 세트. 20초 손을 떼면 숨 쉽니다.' },
  notes: { ko: '노트', eye: '거의 정지 · 세로 결', lines: ['이어서 쓰기 —', '엔트로피와 제2법칙'], note: '괘선 같은 세로 결. 옹이가 없어 종이처럼 조용합니다.' },
  graph: { ko: '그래프', eye: '옹이 3개 · 성운', lines: ['엔트로피가', '노트 2개와 이어져 있어요.'], note: '옹이가 여럿인 분위기에서는 포인터가 네 번째 별이 됩니다.' },
  review: { ko: '복습', eye: '카드 자리에 옹이', lines: ['13장 · 약 8분', '지금 시작하면 9시 40분.'], note: '평가할 때마다 작은 물결, 끝나면 인주 도장.' },
  planner: { ko: '플래너', eye: '가로 시간 축', lines: ['이번 주,', '수업 9개 · 마감 2개'], note: '결이 가로로 길게 흐릅니다. 옹이 = 지금 시각.' },
  focus: { ko: '집중', eye: '가운데 옹이 · 6초 숨', lines: ['숨을 고르고', '25분만 집중해요.'], note: '느리고 어둡게. 가운데 옹이가 6초 주기로 숨 쉽니다.' },
  settings: { ko: '설정', eye: '미리보기 견본', lines: ['모양과 움직임,', '내 손에 맞게.'], note: '테마를 바꾸면 필드 색이 680ms 동안 함께 바뀝니다.' },
}

const TINTS: Array<{ label: string; css: string | undefined }> = [
  { label: '인주', css: undefined },
  { label: '물리', css: 'var(--s-phys)' },
  { label: '수학', css: 'var(--s-math)' },
  { label: '화학', css: 'var(--s-chem)' },
  { label: '경제', css: 'var(--s-econ)' },
  { label: '영어', css: 'var(--s-eng)' },
]

function Lab() {
  const [level, setLevel] = useState<MotionLevel>('rich')
  const [theme, setTheme] = useState<ThemeName>('dark')
  const [tier, setTier] = useState<'auto' | Tier>('auto')
  const [hud, setHud] = useState(true)
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])
  return (
    <FieldProvider level={level} theme={theme} tier={tier} debug={hud}>
      <Stage level={level} setLevel={setLevel} theme={theme} setTheme={setTheme} tier={tier} setTier={setTier} hud={hud} setHud={setHud} />
    </FieldProvider>
  )
}

interface StageProps {
  level: MotionLevel
  setLevel: (l: MotionLevel) => void
  theme: ThemeName
  setTheme: (t: ThemeName) => void
  tier: 'auto' | Tier
  setTier: (t: 'auto' | Tier) => void
  hud: boolean
  setHud: (v: boolean) => void
}

function Stage(p: StageProps) {
  const [preset, setPreset] = useState<MoodName>('today')
  const [pin, setPin] = useState(false)
  const [transitionMs, setTransitionMs] = useState(900)
  const [rings, setRings] = useState(5)
  const [load, setLoad] = useState(0.4)
  const [pressure, setPressure] = useState(0)
  const [tint, setTint] = useState<string | undefined>(undefined)
  const [ink, setInk] = useState(false)
  const [typing, setTyping] = useState(false)
  const [overlay, setOverlay] = useState(false)
  const [panelOpen, setPanelOpen] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 1100)
  const knotRef = useRef<HTMLSpanElement>(null)
  const heroBtn = useRef<HTMLButtonElement>(null)

  const transition = useFieldTransition()
  const ripple = useRipple()
  const seal = useSeal()
  const engine = useFieldEngine()
  const prefs = useMotionPrefs()

  useFieldData({ rings: preset === 'today' || preset === 'landing' || preset === 'focus' ? rings : undefined, load, pressure, tint })
  useFieldPause(ink, 'ink')
  useFieldPause(typing, 'typing')
  useFieldPause(overlay, 'overlay')

  const idx = PRESETS.indexOf(preset)
  const go = (next: MoodName, origin?: Element) => {
    if (next === preset) return
    const dir = PRESETS.indexOf(next) >= idx ? 'forward' : 'back'
    void transition(() => setPreset(next), { origin, direction: dir })
  }
  const step = (d: 1 | -1, origin?: Element) => go(PRESETS[(idx + d + PRESETS.length) % PRESETS.length]!, origin)

  const mood = MOODS[preset]
  const copy = COPY[preset]

  return (
    <div className="lab" data-panel={panelOpen ? 'open' : 'closed'}>
      <FieldMood preset={preset} knotRef={pin ? knotRef : undefined} transitionMs={transitionMs} />

      <RippleSurface as="main" className="lab-main">
        <header className="lab-top">
          <span className="brand">
            <Symbol />
            <b>결</b>
            <span className="brand-sub">모션 실험실</span>
          </span>
          <span className="lab-tag mono">GYEOL FX · M0</span>
        </header>

        <div data-gx-vt-root="">
          <section className="hero">
            <p className="eyebrow mono">
              <span className="eyebrow-n">{String(idx + 1).padStart(2, '0')} / 08</span> {preset} · {copy.eye}
            </p>
            <div className="hero-head">
              <RevealText as="h1" className="focus-lines" lines={copy.lines} swapKey={preset} />
              <span className="knot-anchor" ref={knotRef} aria-hidden="true" data-on={pin ? '1' : '0'} />
            </div>
            <p className="hero-note">{copy.note}</p>
            <div className="acts">
              <button
                ref={heroBtn}
                type="button"
                className="btn"
                onClick={(e) => {
                  setRings((r) => Math.min(9, r + 1))
                  seal(e.currentTarget, { stamp: { text: '1세트', sub: '25분 집중' } })
                }}
              >
                세트 끝 — 인주 찍기
              </button>
              <button type="button" className="quiet" onClick={(e) => step(1, e.currentTarget)}>
                다음 공간으로 →
              </button>
            </div>
            <dl className="params mono">
              <div><dt>speed</dt><dd>{mood.speed.toFixed(2)}</dd></div>
              <div><dt>step</dt><dd>{mood.step.toFixed(3)}</dd></div>
              <div><dt>aniso</dt><dd>{mood.aniso[0]} · {mood.aniso[1]}</dd></div>
              <div><dt>knot</dt><dd>{mood.knots ? `${mood.knots.length}개` : mood.knot ? mood.knot.join(' · ') : '없음'}</dd></div>
            </dl>
          </section>
        </div>

        <Showcase />

        <footer className="lab-foot mono">
          레이어: html 배경 --bg-0 · body transparent · 필드 fixed z0 · 앱 루트 relative z1 — 화면 아무 곳이나 눌러 보세요
        </footer>
      </RippleSurface>

      <button type="button" className="panel-toggle" onClick={() => setPanelOpen((v) => !v)} aria-expanded={panelOpen}>
        {panelOpen ? '조절판 접기' : '조절판'}
      </button>

      <aside className="panel" aria-label="실험 조절판">
        <Group title="분위기" hint="FieldMood · 900ms in-out 보간">
          <div className="chips chips-8">
            {PRESETS.map((name, i) => (
              <button key={name} type="button" className="chip" aria-pressed={name === preset} onClick={(e) => go(name, e.currentTarget)}>
                <span className="mono chip-n">{String(i + 1).padStart(2, '0')}</span>
                {COPY[name].ko}
              </button>
            ))}
          </div>
          <Row label="보간 시간">
            <Seg value={String(transitionMs)} options={[['400', '400'], ['900', '900'], ['1200', '1200']]} onChange={(v) => setTransitionMs(Number(v))} />
          </Row>
          <Toggle label="옹이를 문장 옆 요소에 고정 (knotRef)" on={pin} set={setPin} />
        </Group>

        <Group title="결 와이프" hint="useFieldTransition · 물결 + uPhase ±1 + View Transition">
          <div className="btn-row">
            <button type="button" className="pbtn" onClick={(e) => step(-1, e.currentTarget)}>← 이전 공간</button>
            <button type="button" className="pbtn" onClick={(e) => step(1, e.currentTarget)}>다음 공간 →</button>
          </div>
        </Group>

        <Group title="손길" hint="물결 520px/s · 2.6s · 동시 4개 / 인주 10초 1회">
          <div className="btn-row">
            <button type="button" className="pbtn" onClick={() => ripple(window.innerWidth * 0.5, window.innerHeight * 0.5)}>가운데 물결</button>
            <button type="button" className="pbtn" onClick={() => ripple(window.innerWidth * (0.2 + Math.random() * 0.6), window.innerHeight * (0.2 + Math.random() * 0.6), { accent: true, strength: 1.3 })}>
              인주색 물결
            </button>
          </div>
          <div className="btn-row">
            <button type="button" className="pbtn" onClick={() => knotRef.current && seal(knotRef.current.isConnected && pin ? knotRef.current : { x: window.innerWidth * 0.7, y: window.innerHeight * 0.44 })}>
              인주 번짐
            </button>
            <button type="button" className="pbtn" onClick={(e) => seal(e.currentTarget, { stamp: { text: '복습 끝', sub: '내일 2장' } })}>인주 + 도장</button>
          </div>
          <SealCooldown />
        </Group>

        <Group title="데이터" hint="useFieldData → 고리 · 밀도 · 속도 · 색조">
          <Row label={`고리 ${rings}겹`}>
            <div className="stepper">
              <button type="button" onClick={() => setRings((r) => Math.max(0, r - 1))} aria-label="고리 빼기">−</button>
              <button type="button" onClick={() => setRings((r) => Math.min(9, r + 1))} aria-label="고리 더하기">+</button>
            </div>
          </Row>
          <Slider label="할 일 양 (load → 밀도)" value={load} set={setLoad} />
          <Slider label="시간 압박 (pressure → 속도)" value={pressure} set={setPressure} />
          <div className="chips">
            {TINTS.map((t) => (
              <button key={t.label} type="button" className="chip chip-dot" aria-pressed={tint === t.css} onClick={() => setTint(t.css)}>
                <i style={{ background: t.css ?? 'var(--accent)' }} />
                {t.label}
              </button>
            ))}
          </div>
          {!(preset === 'today' || preset === 'landing' || preset === 'focus') && <p className="hint">고리는 오늘·첫 화면·집중에서만 보입니다.</p>}
        </Group>

        <Group title="정지" hint="useFieldPause · 0.35로 흐려지고 렌더 정지, 1.5초 뒤 재개">
          <Toggle label="필기 중 (ink)" on={ink} set={setInk} />
          <Toggle label="오버레이 (⌘K: 밝기 60% · 0.5배 · 30fps)" on={overlay} set={setOverlay} />
          <textarea
            className="type-box"
            rows={2}
            placeholder="여기에 입력하면 'typing' 정지"
            onFocus={() => setTyping(true)}
            onBlur={() => setTyping(false)}
          />
        </Group>

        <Group title="시스템" hint="가드레일 · 성능 등급">
          <Row label="모션">
            <Seg value={p.level} options={[['rich', '풍부'], ['calm', '절제'], ['off', '끔']]} onChange={(v) => p.setLevel(v as MotionLevel)} />
          </Row>
          {prefs.reduced && p.level !== 'off' && <p className="hint">기기 설정(동작 줄이기)에 따라 '끔'으로 동작 중</p>}
          <Row label="테마">
            <Seg value={p.theme} options={[['dark', '다크'], ['light', '라이트']]} onChange={(v) => p.setTheme(v as ThemeName)} />
          </Row>
          <Row label="등급">
            <Seg value={p.tier} options={[['auto', '자동'], ['A', 'A'], ['B', 'B'], ['C', 'C']]} onChange={(v) => p.setTier(v as 'auto' | Tier)} />
          </Row>
          <Toggle label="FPS 표시 (debug)" on={p.hud} set={p.setHud} />
          <div className="btn-row">
            <button type="button" className="pbtn" onClick={() => engine?.simulateContextLoss()}>컨텍스트 손실 시험</button>
            <Force2d />
          </div>
        </Group>

        <Group title="상태" hint="참고값 — 숨은 창에서는 rAF가 느려진다">
          <Stats />
        </Group>
      </aside>
    </div>
  )
}

function Showcase() {
  return (
    <div className="show">
      <Chapter n="01" eyebrow="FocusRing" title={['원형 링이 줄어들고', '궤도 빛이 끝을 돈다.']}>
        <RingDemo />
      </Chapter>
      <Chapter n="02" eyebrow="CountUp · Stamp" title={['숫자는 한 번 세고,', '끝은 인주로 찍는다.']}>
        <CountStampDemo />
      </Chapter>
      <Chapter n="03" eyebrow="GyeolRings" title={['이번 주 결.', '어제의 나보다 18% 더.']}>
        <GyeolRings
          items={[
            { size: 1.8, color: 'var(--s-phys)' },
            { size: 2.6, color: 'var(--s-math)' },
            { size: 1.2, color: 'var(--s-phys)' },
            { size: 2.2, color: 'var(--s-chem)' },
            { size: 0, color: 'var(--border-strong)' },
            { size: 0, color: 'var(--border-strong)' },
            { size: 0, color: 'var(--border-strong)' },
          ]}
          grow
        />
        <p className="cap mono">월 1.8h · 화 2.6h · 수 1.2h · 목 2.2h · 금 — · 토 — · 일 —</p>
      </Chapter>
      <Chapter n="04" eyebrow="ContourRibbon" title={['오늘은 수업 3개,', '집중 5세트.']}>
        <RibbonDemo />
      </Chapter>
    </div>
  )
}

function Chapter({ n, eyebrow, title, children }: { n: string; eyebrow: string; title: ReactNode[]; children: ReactNode }) {
  return (
    <section className="chap">
      <p className="eyebrow mono">
        <span className="eyebrow-n">{n}</span> {eyebrow}
      </p>
      <RevealText as="h2" className="chap-title" lines={title} trigger="inView" />
      <div className="chap-body">{children}</div>
    </section>
  )
}

function RingDemo() {
  const TOTAL = 25000
  const [state, setState] = useState<'idle' | 'running' | 'paused' | 'done'>('idle')
  const [elapsed, setElapsed] = useState(0)
  const seal = useSeal()
  const ringRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (state !== 'running') return
    const t0 = performance.now() - elapsed
    const id = window.setInterval(() => {
      const e = performance.now() - t0
      if (e >= TOTAL) {
        setElapsed(TOTAL)
        setState('done')
        if (ringRef.current) seal(ringRef.current, { stamp: { text: '1세트', sub: '25초 시연' } })
      } else setElapsed(e)
    }, 1000)
    return () => window.clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])
  const remain = Math.max(0, TOTAL - elapsed)
  const ss = Math.ceil(remain / 1000)
  return (
    <div className="ring-demo">
      <div ref={ringRef} className="ring-holder">
        <FocusRing progress={elapsed / TOTAL} size={260} state={state} drawIn>
          <span className="ring-time mono">00:{String(ss).padStart(2, '0')}</span>
          <span className="ring-sub">{state === 'idle' ? '숨 고르고 시작' : state === 'running' ? '집중 중 · 1초마다 갱신' : state === 'paused' ? '잠시 멈춤' : '1세트 끝'}</span>
        </FocusRing>
      </div>
      <div className="btn-row">
        {state !== 'running' && state !== 'done' && (
          <button type="button" className="pbtn" onClick={() => setState('running')}>{state === 'paused' ? '이어서' : '시작'}</button>
        )}
        {state === 'running' && <button type="button" className="pbtn" onClick={() => setState('paused')}>일시정지</button>}
        <button
          type="button"
          className="pbtn"
          onClick={() => {
            setElapsed(0)
            setState('idle')
          }}
        >
          처음으로
        </button>
        <button type="button" className="pbtn" onClick={() => setState('done')}>바로 끝</button>
      </div>
    </div>
  )
}

function CountStampDemo() {
  const [k, setK] = useState(0)
  const [stamp, setStamp] = useState(false)
  const [value, setValue] = useState(13)
  return (
    <div className="duo">
      <div className="card">
        <p className="big">
          <CountUp key={k} value={value} className="big-num" />
          <span className="big-unit">장</span>
        </p>
        <p className="card-sub">약 {Math.max(1, Math.round(value * 0.6))}분 · 기억률 <CountUp key={'r' + k} value={91} format={(n) => `${Math.round(n)}%`} /></p>
        <div className="btn-row">
          <button type="button" className="pbtn" onClick={() => setK((x) => x + 1)}>다시 세기</button>
          <button
            type="button"
            className="pbtn"
            onClick={() => {
              setValue(Math.round(8 + Math.random() * 40))
              setK((x) => x + 1)
            }}
          >
            다른 값
          </button>
        </div>
      </div>
      <div className="card card-stamp">
        <p className="card-k">복습 0장</p>
        <p className="card-sub">오늘 복습 끝 · 내일 2장</p>
        <div className="btn-row">
          <button type="button" className="pbtn" onClick={() => setStamp(true)} disabled={stamp}>도장 찍기</button>
        </div>
        <Stamp show={stamp} text="복습 끝" sub="내일 2장" onDone={() => window.setTimeout(() => setStamp(false), 600)} />
      </div>
    </div>
  )
}

function RibbonDemo() {
  const [h, setH] = useState(9.53)
  const day = (hh: number) => {
    const d = new Date(2026, 9, 16, 0, 0, 0)
    d.setMinutes(Math.round(hh * 60))
    return d
  }
  const segments = useMemo(
    () => [
      { start: day(9), end: day(10.25), kind: 'class' as const, color: 'var(--s-phys)' },
      { start: day(13), end: day(14.25), kind: 'class' as const, color: 'var(--s-math)' },
      { start: day(15), end: day(17), kind: 'class' as const, color: 'var(--s-chem)' },
      { start: day(10.4), end: day(10.8), kind: 'focus' as const, color: 'var(--accent)' },
      { start: day(11), end: day(11.4), kind: 'focus' as const, color: 'var(--accent)' },
      { start: day(14.4), end: day(14.8), kind: 'focus' as const, color: 'var(--accent)' },
      { start: day(19), end: day(19.4), kind: 'focus' as const, color: 'var(--accent)' },
      { start: day(19.6), end: day(20), kind: 'focus' as const, color: 'var(--accent)' },
    ],
    [],
  )
  const now = useMemo(() => day(h), [h])
  return (
    <div className="ribbon-demo">
      <ContourRibbon segments={segments} now={now} />
      <label className="slider">
        <span>지금 시각 {now.getHours()}:{String(now.getMinutes()).padStart(2, '0')}</span>
        <input type="range" min={8} max={22} step={0.05} value={h} onChange={(e) => setH(Number(e.target.value))} />
      </label>
    </div>
  )
}

/* ---------- 조절판 부품 ---------- */

function Group({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="group">
      <h3>
        {title}
        {hint && <small>{hint}</small>}
      </h3>
      <div className="group-body">{children}</div>
    </section>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="row">
      <span className="row-l">{label}</span>
      {children}
    </div>
  )
}

function Seg({ value, options, onChange }: { value: string; options: Array<[string, string]>; onChange: (v: string) => void }) {
  return (
    <div className="seg" role="radiogroup">
      {options.map(([v, l]) => (
        <button key={v} type="button" role="radio" aria-checked={v === value} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  )
}

function Toggle({ label, on, set }: { label: string; on: boolean; set: (v: boolean) => void }) {
  return (
    <button type="button" className="toggle" role="switch" aria-checked={on} onClick={() => set(!on)}>
      <span className="toggle-t" aria-hidden="true">
        <i />
      </span>
      {label}
    </button>
  )
}

function Slider({ label, value, set }: { label: string; value: number; set: (v: number) => void }) {
  return (
    <label className="slider">
      <span>
        {label} <b className="mono">{value.toFixed(2)}</b>
      </span>
      <input type="range" min={0} max={1} step={0.01} value={value} onChange={(e) => set(Number(e.target.value))} />
    </label>
  )
}

function Force2d() {
  const engine = useFieldEngine()
  const [on, setOn] = useState(false)
  return (
    <button
      type="button"
      className="pbtn"
      aria-pressed={on}
      onClick={() => {
        engine?.force2d(!on)
        setOn(!on)
      }}
    >
      {on ? 'WebGL2로 돌아가기' : '2D 정지 프레임 보기'}
    </button>
  )
}

function SealCooldown() {
  const engine = useFieldEngine()
  const [left, setLeft] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => setLeft(engine?.sealCooldownLeft() ?? 0), 250)
    return () => window.clearInterval(id)
  }, [engine])
  return (
    <p className="hint">
      {left > 0 ? `다음 인주 번짐까지 ${(left / 1000).toFixed(1)}초 (도장은 상한 없음) ` : '인주 번짐 가능 '}
      {left > 0 && (
        <button type="button" className="link" onClick={() => engine?.resetSealCooldown()}>
          상한 초기화
        </button>
      )}
    </p>
  )
}

function Stats() {
  const engine = useFieldEngine()
  const idle20 = useIdle(20000)
  const idle120 = useIdle(120000)
  const [s, setS] = useState<FieldStats | null>(null)
  useEffect(() => {
    const id = window.setInterval(() => setS(engine?.stats() ?? null), 500)
    return () => window.clearInterval(id)
  }, [engine])
  if (!s) return <p className="hint">측정 중…</p>
  return (
    <dl className="stats mono">
      <div><dt>fps</dt><dd>{s.running ? s.fps : 0}</dd></div>
      <div><dt>등급</dt><dd>{s.tier} {s.tierAuto ? '(자동)' : '(고정)'}</dd></div>
      <div><dt>내부 해상도</dt><dd>{s.res.toFixed(2)}× · {s.megapixels.toFixed(2)}MP</dd></div>
      <div><dt>JS / 프레임</dt><dd>{s.jsMs.toFixed(3)}ms</dd></div>
      <div><dt>p95 간격</dt><dd>{s.p95 ? s.p95.toFixed(1) + 'ms' : '–'}</dd></div>
      <div><dt>렌더</dt><dd>{s.render === 'webgl2' ? 'WebGL2' : 'Canvas 2D 정지'}</dd></div>
      <div><dt>모드</dt><dd>{s.mode}{s.paused ? ' · 일시정지' : ''}{s.running ? ' · 루프' : ' · 멈춤'}</dd></div>
      <div><dt>무입력</dt><dd>{idle120 ? '깊은 대기 (30fps)' : idle20 ? '숨 쉬는 중' : '활동 중'}</dd></div>
      <div className="wide"><dt>GPU</dt><dd title={s.renderer}>{s.renderer || '–'}</dd></div>
    </dl>
  )
}

function Symbol() {
  return (
    <svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1.7">
        <path d="M16.2 3.2c7.4.1 12.7 5.6 12.6 12.8-.1 7.3-5.7 12.8-12.9 12.8C8.6 28.8 3.2 23.3 3.2 16 3.3 8.6 8.8 3.1 16.2 3.2z" />
        <path d="M17.3 8c4.7 0 8 3.4 8 8s-3.5 8-8.2 8c-4.6 0-7.9-3.5-7.9-8 .1-4.6 3.5-8 8.1-8z" />
        <path d="M18.6 12.6c2.1 0 3.6 1.5 3.6 3.5 0 2.1-1.6 3.6-3.7 3.6-2 0-3.5-1.6-3.5-3.6 0-2 1.6-3.5 3.6-3.5z" />
      </g>
      <circle cx="18.7" cy="16.1" r="1.3" fill="var(--accent)" />
    </svg>
  )
}

createRoot(document.getElementById('lab')!).render(
  <StrictMode>
    <Lab />
  </StrictMode>,
)
