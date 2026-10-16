/**
 * 설정 (design-v2 4-3): 한 열, 최대 너비 640. 섹션은 상자 없이 제목 + 행.
 * 모양(테마) · 움직임(모션) · 데이터(표시만) · 개발용(시각 고정 · 필드 등급 · FPS).
 */
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useMotionPrefs, useSeal, type MotionLevel } from '@/fx'
import { ActiveMood as FieldMood } from '@/app/keepAlive'
import { db } from '@/db/schema'
import { seedSample } from '@/db/seed'
import { switchTheme } from '@/lib/theme'
import { useSettings, type ClockPreset, type ThemePref, type TravelPref } from '@/stores/settings'
import { useUi } from '@/stores/ui'
import { useEffectiveMotion, useOsReducedMotion } from '@/shell/hooks'
import { Block, FocusLines } from './parts'

const CLOCKS: Array<[ClockPreset, string]> = [
  ['live', '실시간'],
  ['morning', '아침 · 08:10'],
  ['class', '수업 중 · 09:32'],
  ['gap', '공강 · 11:00'],
  ['before', '수업 직전 · 12:50'],
  ['night', '밤 · 22:10'],
  ['late', '새벽 · 01:40'],
  ['exam', '시험 D-3'],
  ['empty', '첫 실행 · 빈 상태'],
]

/** 세그먼트 컨트롤 (role=radiogroup, 좌우 화살표 이동) */
function Segmented<T extends string>({ label, value, options, onChange, disabled }: { label: string; value: T; options: Array<[T, string]>; onChange: (v: T, el: HTMLElement) => void; disabled?: boolean }) {
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    const i = options.findIndex(([v]) => v === value)
    const n = options[(i + (e.key === 'ArrowRight' ? 1 : -1) + options.length) % options.length]!
    const btn = e.currentTarget.querySelector<HTMLElement>(`[data-v="${n[0]}"]`)
    if (btn) {
      btn.focus()
      onChange(n[0], btn)
    }
  }
  return (
    <div className={`segmented${disabled ? ' is-disabled' : ''}`} role="radiogroup" aria-label={label} onKeyDown={onKey}>
      {options.map(([v, l]) => (
        <button key={v} type="button" role="radio" data-v={v} aria-checked={v === value} tabIndex={v === value ? 0 : -1} disabled={disabled} onClick={(e) => onChange(v, e.currentTarget)}>
          {l}
        </button>
      ))}
    </div>
  )
}

function Row({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="set-row">
      <div className="set-row-t">
        <p>{title}</p>
        {hint && <small>{hint}</small>}
      </div>
      <div className="set-row-c">{children}</div>
    </div>
  )
}

function useStorageInfo() {
  const [info, setInfo] = useState<{ usage: number | null; persisted: boolean | null; counts: string }>({ usage: null, persisted: null, counts: '' })
  useEffect(() => {
    let alive = true
    ;(async () => {
      let usage: number | null = null
      let persisted: boolean | null = null
      try {
        const est = await navigator.storage?.estimate?.()
        usage = est?.usage ?? null
        persisted = (await navigator.storage?.persisted?.()) ?? null
      } catch {
        /* noop */
      }
      let counts = ''
      try {
        const [n, c, f] = await Promise.all([db.notes.count(), db.cards.count(), db.focusSessions.count()])
        counts = `노트 ${n} · 카드 ${c} · 집중 기록 ${f}`
      } catch {
        counts = ''
      }
      if (alive) setInfo({ usage, persisted, counts })
    })()
    return () => {
      alive = false
    }
  }, [])
  return info
}

function fmtBytes(b: number | null): string {
  if (b === null) return '알 수 없음'
  if (b < 1024 * 1024) return `${Math.max(1, Math.round(b / 1024))}KB`
  return `${(b / 1024 / 1024).toFixed(1)}MB`
}

export function SettingsScreen() {
  const theme = useSettings((s) => s.theme)
  const setTheme = useSettings((s) => s.setTheme)
  const motion = useSettings((s) => s.motion)
  const setMotion = useSettings((s) => s.setMotion)
  const travel = useSettings((s) => s.travel)
  const setTravel = useSettings((s) => s.setTravel)
  const meteors = useSettings((s) => s.meteors)
  const setMeteors = useSettings((s) => s.setMeteors)
  const clock = useSettings((s) => s.clock)
  const setClock = useSettings((s) => s.setClock)
  const tier = useSettings((s) => s.tier)
  const setTier = useSettings((s) => s.setTier)
  const fps = useSettings((s) => s.fps)
  const setFps = useSettings((s) => s.setFps)
  const osReduced = useOsReducedMotion()
  const level = useEffectiveMotion()
  const prefs = useMotionPrefs()
  const storage = useStorageInfo()
  const showToast = useUi((s) => s.showToast)
  const seal = useSeal()
  const swatchRef = useRef<HTMLSpanElement>(null)
  const dev = import.meta.env.DEV || (typeof location !== 'undefined' && /[?&]dev\b/.test(location.search))

  return (
    <>
      <FieldMood preset="settings" knotRef={swatchRef} />
      <div className="settings">
        <Block>
          <span className="sr-only">설정</span>
        </Block>
        <Block>
          <FocusLines lines={['설정']} />
        </Block>

        <section className="set-sec" aria-labelledby="sec-look">
          <h2 id="sec-look">모양</h2>
          <Row title="하늘">
            <span className="swatch" ref={swatchRef} aria-hidden="true" />
            <Segmented<ThemePref>
              label="테마"
              value={theme}
              options={[['dark', '밤'], ['light', '낮'], ['system', '시스템']]}
              onChange={(v, el) => switchTheme(v, setTheme, { origin: el, animate: level !== 'off' })}
            />
          </Row>
        </section>

        <section className="set-sec" aria-labelledby="sec-motion">
          <h2 id="sec-motion">움직임</h2>
          <Row
            title="움직임"
            hint={osReduced ? '기기 설정 · 동작 줄이기' : undefined}
          >
            <Segmented<MotionLevel>
              label="모션"
              value={osReduced ? 'off' : motion}
              disabled={osReduced}
              options={[['rich', '풍부'], ['calm', '절제'], ['off', '정지']]}
              onChange={(v) => setMotion(v)}
            />
          </Row>
                  <Row title="공간 이동" hint={osReduced ? '기기 설정 · 동작 줄이기' : undefined}>
            <Segmented<TravelPref>
              label="공간 이동"
              value={osReduced ? 'off' : travel}
              disabled={osReduced}
              options={[['fly', '비행'], ['short', '짧게'], ['off', '끔']]}
              onChange={(v) => setTravel(v)}
            />
          </Row>
          <Row title="유성">
            <Segmented<'on' | 'off'>
              label="유성"
              value={meteors ? 'on' : 'off'}
              options={[['on', '켬'], ['off', '끔']]}
              onChange={(v) => setMeteors(v === 'on')}
            />
          </Row>
        </section>

        <section className="set-sec" aria-labelledby="sec-data">
          <h2 id="sec-data">데이터</h2>
          <Row title="이 기기" hint={storage.counts || undefined}>
            <span className="set-val">{fmtBytes(storage.usage)}</span>
          </Row>
          <Row title="영구 저장">
            <span className="set-val">{storage.persisted === null ? '알 수 없음' : storage.persisted ? '허용됨' : '요청함'}</span>
          </Row>
          <Row title="백업">
            <span className="set-val">없음</span>
          </Row>
        </section>

        {dev && (
          <section className="set-sec set-dev" aria-labelledby="sec-dev">
            <h2 id="sec-dev">개발용</h2>
            <Row title="시각 고정" hint="상황 바꾸기">
              <select className="select" value={clock} onChange={(e) => setClock(e.target.value as ClockPreset)} aria-label="시각 고정">
                {CLOCKS.map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </Row>
            <Row title="필드 등급" hint={`지금 ${prefs.tier} · ${Math.round(prefs.fps)}fps`}>
              <Segmented<'auto' | 'A' | 'B' | 'C'> label="필드 등급" value={tier} options={[['auto', '자동'], ['A', 'A'], ['B', 'B'], ['C', 'C']]} onChange={(v) => setTier(v)} />
            </Row>
            <Row title="FPS 표시">
              <button type="button" role="switch" aria-checked={fps} className={`switch${fps ? ' is-on' : ''}`} onClick={() => setFps(!fps)}>
                <span className="sr-only">FPS 표시</span>
              </button>
            </Row>
            <Row title="별 탄생" hint="시험">
              <button type="button" className="btn-ghost small" onClick={(e) => seal(e.currentTarget, { stamp: { text: '시험', sub: '인주 번짐' } })}>
                찍어 보기
              </button>
            </Row>
            <Row title="샘플 데이터" hint="2학기 7주차">
              <button
                type="button"
                className="btn-ghost small"
                onClick={() => {
                  void seedSample().then(() => showToast('샘플 넣음'))
                }}
              >
                다시 넣기
              </button>
            </Row>
          </section>
        )}
        <p className="set-foot mono">결 · v3</p>
      </div>
    </>
  )
}
