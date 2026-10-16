import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { FieldEngine, SKY_TIMING } from './sky/field'
import { FieldContext, setActiveEngine } from './context'
import { Stamp } from './components/Stamp'
import type { FieldProviderProps } from './types'
import './fx.css'

/**
 * 결 하늘 — 앱 루트에 한 번만 둔다. (v3: 은하수. 결 등고선 필드는 lab 전용으로만 남았다)
 *
 * 화면 전체에 캔버스 1개(WebGL2)를 document.body 바로 아래에 붙이고 rAF 루프 1개를 돌린다.
 * 화면이 바뀌어도 캔버스는 다시 만들지 않고 굽지도 않는다. 화면들은 <FieldMood>로 하늘 장면만 선언한다.
 *
 * ── 레이어 규칙 (꼭 지킬 것 — 프로토타입에서 실제로 난 버그) ──────────────────────
 *   html  { background: var(--bg-0) }            ← 바탕색은 html에만
 *   body  { background: transparent }           ← body에 배경을 칠하면 필드가 가려진다
 *   필드  position:fixed; inset:0; z-index:0; pointer-events:none   (이 컴포넌트가 만든다)
 *   앱 루트 { position: relative; z-index: 1 }  ← 위치·z-index가 없으면 글자가 필드 아래로 깔린다
 *   캔버스를 z-index:-1로 내리면 html 배경 뒤로 숨어 안 보인다.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * - level: 'rich' | 'calm' | 'off'. OS prefers-reduced-motion이면 언제나 'off'처럼 동작(정지 프레임 1장).
 * - theme: 바뀌면 CSS 변수(--grain-minor/--grain-major/--accent)를 다시 읽어 680ms 동안 색을 보간.
 * - tier: 'auto'면 GPU 이름으로 첫 등급을 정하고, 처음 120프레임 p95가 예산의 1.2배를 넘으면 한 단계 낮춘다.
 * - debug: 왼쪽 아래에 FPS·등급·해상도 표시.
 */
export function FieldProvider({ level, theme, tier = 'auto', debug = false, travel = 'fly', meteors = true, children }: FieldProviderProps) {
  const [engine] = useState(() => new FieldEngine())
  const hostRef = useRef<HTMLDivElement>(null)
  const hudRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    engine.configure?.({ level, theme, tier, debug, travel, meteors })
  }, [engine, level, theme, tier, debug, travel, meteors])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    engine.attach(host)
    setActiveEngine(engine)
    // UI CSS가 하늘과 같은 박자를 쓰도록 (design-v3-motion §3)
    const r = document.documentElement.style
    r.setProperty('--sky-nav-ms', SKY_TIMING.navMs + 'ms')
    r.setProperty('--sky-out-ms', SKY_TIMING.outMs + 'ms')
    r.setProperty('--sky-in-delay-ms', SKY_TIMING.inDelayMs + 'ms')
    r.setProperty('--sky-in-ms', SKY_TIMING.inMs + 'ms')
    r.setProperty('--sky-overlay-ms', SKY_TIMING.overlayMs + 'ms')
    r.setProperty('--sky-ease', SKY_TIMING.ease)
    return () => {
      engine.detach()
      setActiveEngine(null)
    }
  }, [engine])

  useEffect(() => {
    engine.setHud(debug ? hudRef.current : null)
    // 검증용: debug일 때만 콘솔에서 window.__gyeolField.stats() 로 볼 수 있다
    const w = window as Window & { __gyeolField?: FieldEngine }
    if (debug) w.__gyeolField = engine
    return () => {
      if (w.__gyeolField === engine) delete w.__gyeolField
    }
  }, [engine, debug])

  const body = typeof document !== 'undefined' ? document.body : null

  return (
    <FieldContext.Provider value={engine}>
      {children}
      {body &&
        createPortal(
          <>
            <div ref={hostRef} className="gx-field" data-gyeol-field="" aria-hidden="true" />
            <StampLayer engine={engine} />
            <CaptionLayer engine={engine} />
            {debug && <div ref={hudRef} className="gx-hud" aria-hidden="true" />}
          </>,
          body,
        )}
    </FieldContext.Provider>
  )
}

/** SkyCaption: 3초 숫자 캡션 (opacity만) */
function CaptionLayer({ engine }: { engine: FieldEngine }) {
  const items = useSyncExternalStore(engine.subscribeCaptions, engine.getCaptions, engine.getCaptions)
  if (!items.length) return null
  return (
    <div className="gx-caption-layer" aria-live="polite">
      {items.map((c) => (
        <div key={c.id} className="gx-caption" style={{ left: c.x, top: c.y }}>
          {c.text}
        </div>
      ))}
    </div>
  )
}

/** useSeal({ stamp })이 띄우는 도장들. 화면 좌표에 고정, 끝나면 스스로 사라진다 */
function StampLayer({ engine }: { engine: FieldEngine }) {
  const items = useSyncExternalStore(engine.subscribeStamps, engine.getStamps, engine.getStamps)
  if (!items.length) return null
  return (
    <div className="gx-stamp-layer" aria-live="polite">
      {items.map((s) => (
        <FloatingStamp key={s.id} item={s} onGone={() => engine.removeStamp(s.id)} />
      ))}
    </div>
  )
}

function FloatingStamp({ item, onGone }: { item: { x: number; y: number; text: string; sub?: string }; onGone: () => void }) {
  const [show, setShow] = useState(true)
  return (
    <div className="gx-stamp-at" style={{ left: item.x, top: item.y }}>
      <Stamp
        show={show}
        text={item.text}
        sub={item.sub}
        onDone={() => {
          setShow(false)
          window.setTimeout(onGone, 320)
        }}
      />
    </div>
  )
}
