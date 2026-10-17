/**
 * 설정 시트의 본문 (M1: 장소가 아니라 시트 — 틀·열기·닫기·포커스 가두기는 src/shell/SettingsSheet.tsx).
 * 섹션은 상자 없이 제목 + 행: 모양(테마) · 움직임(모션 · 은하 회전 · 공간 이동) · 데이터(표시만) · 개발용.
 */
import { useEffect, useRef, useState, type ComponentType, type KeyboardEvent, type ReactNode } from 'react'
import { useMotionPrefs, useSeal, type MotionLevel } from '@/fx'
import { useActive } from '@/app/keepAlive'
import { db } from '@/db/schema'
import { hasSamples, removeSamples, seedSample } from '@/db/seed'
import { useLiveQuery } from 'dexie-react-hooks'
import { BackupCard } from '@/capture/BackupCard'
import { tip } from '@/shell/Tip'
import { resetHints } from '@/shell/hints'
import { announce } from '@/shell/announce'
import { IconBright, IconFresh, IconNewCard, IconRest, IconTarget, IconAuto, IconFade, IconFlat, IconLock, IconMoon, IconMotion, IconOrbit, IconOrbitOff, IconOrbitSlow, IconReplay, IconSample, IconShield, IconStorage, IconSun, IconTheme, IconTrash, IconTravel, IconTravelShort, IconWave1, IconWave3 } from '@/shell/icons'
import { useCapture } from '@/capture/store'
import { switchTheme } from '@/lib/theme'
import { useSettings, type ClockPreset, type RotationPref, type ThemePref, type TravelPref } from '@/stores/settings'
import { useUi } from '@/stores/ui'
import { useEffectiveMotion, useOsReducedMotion } from '@/shell/hooks'

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

/**
 * '지금 A · 30fps' — 하늘이 매초 fps를 알리므로 이 잎만 다시 그린다(전에는 설정 화면 전체가 숨은 채로 매초 다시 그려졌다).
 * 숨은 공간이면 마지막 글을 그대로 둔다.
 */
function TierHint() {
  const prefs = useMotionPrefs()
  const active = useActive()
  const text = `지금 ${prefs.tier} · ${Math.round(prefs.fps)}fps`
  const last = useRef(text)
  if (active) last.current = text
  return <>{last.current}</>
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

export const THEME_NAME: Record<ThemePref, string> = { dark: '밤', light: '낮', system: '시스템' }
export const ROTATION_NAME: Record<RotationPref, string> = { on: '켬', slow: '느리게', off: '끔' }

type Ico = ComponentType<{ size?: number }>

/** 아이콘 행: 맨 앞 20px 아이콘(툴팁 = 행 이름) + 컨트롤. 잠긴 행은 자물쇠 */
function IRow({ icon: I, label, lock, children }: { icon: Ico; label: string; lock?: string; children: ReactNode }) {
  return (
    <div className="set-row is-icon">
      <span className="set-ico" tabIndex={0} {...tip(lock ? `${label} · 잠김` : label)}>
        <I size={20} />
      </span>
      <div className="set-row-c">
        {lock && (
          <span className="set-lock" tabIndex={0} {...tip(lock)}>
            <IconLock size={16} />
          </span>
        )}
        {children}
      </div>
    </div>
  )
}

/** 아이콘 세그먼트 (role=radiogroup). 바꾸면 값 낱말이 아래에 1.2초 */
function SegIcon<T extends string>({ label, value, options, onChange, disabled }: { label: string; value: T; options: Array<[T, string, Ico]>; onChange: (v: T, el: HTMLElement) => void; disabled?: boolean }) {
  const [flash, setFlash] = useState<{ word: string; n: number } | null>(null)
  const pick = (v: T, word: string, el: HTMLElement) => {
    if (v === value) return
    setFlash((f) => ({ word, n: (f?.n ?? 0) + 1 }))
    announce(`${label} ${word}`)
    onChange(v, el)
  }
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    const i = options.findIndex(([v]) => v === value)
    const n = options[(i + (e.key === 'ArrowRight' ? 1 : -1) + options.length) % options.length]!
    const btn = e.currentTarget.querySelector<HTMLElement>(`[data-v="${n[0]}"]`)
    if (btn) {
      btn.focus()
      pick(n[0], n[1], btn)
    }
  }
  return (
    <div className={`seg-ico${disabled ? ' is-disabled' : ''}`} role="radiogroup" aria-label={label} onKeyDown={onKey}>
      {options.map(([v, word, I]) => (
        <button key={v} type="button" role="radio" data-v={v} aria-checked={v === value} tabIndex={v === value ? 0 : -1} disabled={disabled} {...tip(word)} onClick={(e) => pick(v, word, e.currentTarget)}>
          <I size={20} />
        </button>
      ))}
      {flash && (
        <span key={flash.n} className="seg-word" aria-hidden="true">
          {flash.word}
        </span>
      )}
    </div>
  )
}

/** 숫자 세그먼트 (role=radiogroup) — 바꾸면 값 낱말 1.2초 */
function SegNum({ label, value, options, onChange, fmt = String }: { label: string; value: number; options: number[]; onChange: (v: number) => void; fmt?: (v: number) => string }) {
  const [flash, setFlash] = useState<{ w: string; n: number } | null>(null)
  const pick = (v: number) => {
    if (v === value) return
    setFlash((f) => ({ w: fmt(v), n: (f?.n ?? 0) + 1 }))
    announce(`${label} ${fmt(v)}`)
    onChange(v)
  }
  return (
    <div className="seg-ico seg-num" role="radiogroup" aria-label={label} onKeyDown={(e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
      e.preventDefault()
      const i = options.indexOf(value)
      const n = options[(i + (e.key === 'ArrowRight' ? 1 : -1) + options.length) % options.length]!
      pick(n)
      ;(e.currentTarget.querySelector(`[data-v="${n}"]`) as HTMLElement | null)?.focus()
    }}>
      {options.map((v) => (
        <button key={v} type="button" role="radio" data-v={v} aria-checked={v === value} tabIndex={v === value ? 0 : -1} onClick={() => pick(v)}>
          <span className="mono">{v}</span>
        </button>
      ))}
      {flash && <span key={flash.n} className="seg-word" aria-hidden="true">{flash.w}</span>}
    </div>
  )
}

const WEEK = ['일', '월', '화', '수', '목', '금', '토']

/** 설정 '기억' 단원 (design-m4 7장): 목표 기억률 · 새 카드 하루(길게 = 전체 상한) · 쉬는 요일 · 기억 밝기 · 새 출발 */
function MemorySection() {
  const retention = useSettings((s) => s.retention)
  const setRetention = useSettings((s) => s.setRetention)
  const newPerDay = useSettings((s) => s.newPerDay)
  const setNewPerDay = useSettings((s) => s.setNewPerDay)
  const maxPerDay = useSettings((s) => s.maxPerDay)
  const setMaxPerDay = useSettings((s) => s.setMaxPerDay)
  const restDays = useSettings((s) => s.restDays)
  const setRestDays = useSettings((s) => s.setRestDays)
  const bright = useSettings((s) => s.memoryBrightness)
  const setBright = useSettings((s) => s.setMemoryBrightness)
  const [cap, setCap] = useState(false)
  const long = useRef(0)
  return (
    <section className="set-sec" aria-labelledby="sec-memory">
      <h2 id="sec-memory" className="sr-only">기억</h2>
      <IRow icon={IconTarget} label="목표 기억률">
        <SegNum label="목표 기억률" value={Math.round(retention * 100)} options={[85, 87, 90, 92, 95]} fmt={(v) => `${v}%`} onChange={(v) => setRetention(v / 100)} />
      </IRow>
      <IRow icon={IconNewCard} label={cap ? '하루 전체 상한' : '새 카드 하루 · 길게 = 전체'}>
        <span
          className="seg-hold"
          data-radial=""
          onPointerDown={() => {
            long.current = window.setTimeout(() => setCap((v) => !v), 500)
          }}
          onPointerUp={() => clearTimeout(long.current)}
          onPointerLeave={() => clearTimeout(long.current)}
          onContextMenu={(e) => e.preventDefault()}
        >
          {cap ? (
            <SegNum label="하루 전체 상한" value={maxPerDay} options={[100, 200, 300]} onChange={setMaxPerDay} />
          ) : (
            <SegNum label="새 카드 하루" value={newPerDay} options={[10, 20, 30]} onChange={setNewPerDay} />
          )}
        </span>
      </IRow>
      <IRow icon={IconRest} label="쉬는 요일">
        <div className="week-dots" role="group" aria-label="쉬는 요일 (누름 = 쉬는 날로 지정)">
          {WEEK.map((w, i) => {
            const rest = restDays.includes(i)
            return (
              <button key={i} type="button" className={`week-dot${rest ? ' is-rest' : ''}`} aria-pressed={rest} {...tip(`${w} · ${rest ? '쉬는 날' : '공부하는 날'}`)} onClick={() => setRestDays(rest ? restDays.filter((d) => d !== i) : [...restDays, i])}>
                {w}
              </button>
            )
          })}
        </div>
      </IRow>
      <IRow icon={IconBright} label="기억 밝기">
        <button type="button" role="switch" aria-checked={bright} className={`switch${bright ? ' is-on' : ''}`} onClick={() => { setBright(!bright); announce(`기억 밝기 ${bright ? '끔' : '켬'}`) }}>
          <span className="sr-only">기억 밝기</span>
        </button>
      </IRow>
      <IRow icon={IconFresh} label="새 출발">
        {/* 새 출발 확인 칸(design-m4 1-5)은 앱 A의 복습이 연다 — 이 이벤트를 듣는다 */}
        <button type="button" className="ibtn" {...tip('새 출발')} onClick={() => { useUi.getState().closeSettings(); window.dispatchEvent(new CustomEvent('gyeol:fresh-start')) }}>
          <IconFresh size={20} />
        </button>
      </IRow>
    </section>
  )
}

export function SettingsBody() {
  const theme = useSettings((s) => s.theme)
  const setTheme = useSettings((s) => s.setTheme)
  const motion = useSettings((s) => s.motion)
  const setMotion = useSettings((s) => s.setMotion)
  const travel = useSettings((s) => s.travel)
  const setTravel = useSettings((s) => s.setTravel)
  const rotation = useSettings((s) => s.rotation)
  const setRotation = useSettings((s) => s.setRotation)
  const clock = useSettings((s) => s.clock)
  const setClock = useSettings((s) => s.setClock)
  const tier = useSettings((s) => s.tier)
  const setTier = useSettings((s) => s.setTier)
  const fps = useSettings((s) => s.fps)
  const setFps = useSettings((s) => s.setFps)
  const osReduced = useOsReducedMotion()
  const level = useEffectiveMotion()
  const storage = useStorageInfo()
  const samples = useLiveQuery(() => hasSamples(), [])
  const showToast = useUi((s) => s.showToast)
  const seal = useSeal()
  const dev = import.meta.env.DEV || (typeof location !== 'undefined' && /[?&]dev\b/.test(location.search))

  const lockTip = '기기 설정 · 동작 줄이기'
  const replay = () => {
    resetHints()
    useUi.getState().closeSettings()
    useCapture.getState().startOnboarding('real')
  }

  return (
    <>
      <div className="settings is-quiet">

        {/* 데이터 (맨 위: 내보내기를 설정 맨 위에) — 단원 이름은 읽기용, 화면은 간격 + 가는 선 */}
        <section className="set-sec" aria-labelledby="sec-data">
          <h2 id="sec-data" className="sr-only">데이터</h2>
          <BackupCard />
          <div className="set-icons">
            <span className="inum" tabIndex={0} {...tip(storage.counts ? storage.counts.replace(/ · /g, ' ') : '이 기기')}>
              <IconStorage size={18} />
              <span aria-hidden="true">{fmtBytes(storage.usage)}</span>
            </span>
            <span className={`inum set-shield${storage.persisted === null ? ' is-dim' : ''}`} tabIndex={0} {...tip(storage.persisted === null ? '영구 저장 모름' : storage.persisted ? '영구 저장 허용' : '영구 저장 요청함')}>
              <IconShield size={18} filled={!!storage.persisted} />
            </span>
            {samples && (
              <button type="button" className="ibtn" {...tip('샘플 지우기')} onClick={() => void removeSamples().then(() => announce('샘플 지움'))}>
                <IconSample size={18} />
                <IconTrash size={16} />
              </button>
            )}
            <button type="button" className="ibtn" {...tip('처음 화면 다시 보기')} onClick={replay}>
              <IconReplay size={18} />
            </button>
          </div>
        </section>

        <section className="set-sec" aria-labelledby="sec-look">
          <h2 id="sec-look" className="sr-only">모양</h2>
          <IRow icon={IconTheme} label="테마">
            <SegIcon<ThemePref>
              label="테마"
              value={theme}
              options={[['dark', '밤', IconMoon], ['light', '낮', IconSun], ['system', '시스템', IconAuto]]}
              onChange={(v, el) => switchTheme(v, setTheme, { origin: el, animate: level !== 'off' })}
            />
          </IRow>
        </section>

        <section className="set-sec" aria-labelledby="sec-motion">
          <h2 id="sec-motion" className="sr-only">움직임</h2>
          <IRow icon={IconMotion} label="움직임" lock={osReduced ? lockTip : undefined}>
            <SegIcon<MotionLevel> label="움직임" value={osReduced ? 'off' : motion} disabled={osReduced} options={[['rich', '풍부', IconWave3], ['calm', '절제', IconWave1], ['off', '정지', IconFlat]]} onChange={(v) => setMotion(v)} />
          </IRow>
          <IRow icon={IconTravel} label="공간 이동" lock={osReduced ? lockTip : undefined}>
            <SegIcon<TravelPref> label="공간 이동" value={osReduced ? 'off' : travel} disabled={osReduced} options={[['fly', '비행', IconTravel], ['short', '짧게', IconTravelShort], ['off', '끔', IconFade]]} onChange={(v) => setTravel(v)} />
          </IRow>
          <IRow icon={IconOrbit} label="은하 회전" lock={osReduced ? lockTip : undefined}>
            <SegIcon<RotationPref> label="은하 회전" value={osReduced ? 'off' : rotation} disabled={osReduced} options={[['on', '켬', IconOrbit], ['slow', '느리게', IconOrbitSlow], ['off', '끔', IconOrbitOff]]} onChange={(v) => setRotation(v)} />
          </IRow>
        </section>

        <MemorySection />

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
            <Row title="필드 등급" hint={<TierHint />}>
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
        
      </div>
    </>
  )
}
