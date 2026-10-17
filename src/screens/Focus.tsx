/**
 * 집중 v4 = 은하 시계 (design-m1 2-3): 정면 원반 둘레의 베젤 링(FocusBezel) + 과목 / 남은 시간(mono) / 동작 — 3줄.
 * 시간 칩 15 · 25 · 50은 대기 때만, 동작 줄 아래.
 * 하늘의 사건: 시작 = 새 별이 희미하게 생김 · 진행 = 그 별이 자람(growStar) ·
 * 세트 끝 = 별 탄생(birthStar) + 직전 별과 선(drawLink) · 끝내기(포기) = 별이 사그라짐(fadeStar).
 * 남은 시간은 시각 차로 계산(새로고침·백그라운드에도 정확). React는 1초마다만, 이 공간이 보일 때만 다시 그린다.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSkyClock, useSkyEvent } from '@/fx'
import { ActiveMood as FieldMood, useActive } from '@/app/keepAlive'
import { useFocusToday, useNow, useSubjects } from '@/db/hooks'
import { db } from '@/db/schema'
import { remainingMs, useFocusTimer } from '@/stores/focus'
import { useUi } from '@/stores/ui'
import { IconPause } from '@/shell/icons'
import { spaceOf } from '@/shell/spaces'
import { FocusBezel } from './FocusBezel'
import { PrimaryButton, QuietButton } from './parts'

const SKY = spaceOf('/focus')

const DURATIONS = [15, 25, 50]

function fmtClock(ms: number): string {
  const s = Math.ceil(ms / 1000)
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

const starId = (startedAt: number) => `focus-${startedAt}`

export function FocusScreen() {
  const timer = useFocusTimer()
  const subjects = useSubjects() ?? []
  const { now } = useNow()
  const today = useFocusToday(now)
  const intent = useUi((s) => s.focusIntent)
  const setChromeHidden = useUi((s) => s.setChromeHidden)
  const knotRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLElement>(null)
  const sky = useSkyEvent()
  const [, force] = useState(0)
  const finishing = useRef(false)
  const todayRef = useRef(today)
  todayRef.current = today

  const remain = remainingMs(timer)
  const progress = timer.plannedMs ? Math.min(1, Math.max(0, 1 - remain / timer.plannedMs)) : 0
  const subject = subjects.find((s) => s.id === timer.subjectId) ?? null
  const running = timer.phase === 'running'
  const live = running || timer.phase === 'paused'

  // 은하 시계(useSkyClock): 타이머 한 번에 은하가 한 바퀴. 시작·멈춤·이어서·끝·초기화 때만 값이 바뀐다(매초 넘기지 않음).
  // 엔진은 elapsedMs + (지금 − startedAt)로 진행을 센다 → 달리는 동안은 '멈춘 시간을 뺀 가상 시작 시각' + 0을 넘긴다(두 번 더하지 않게).
  const clock = useMemo(() => {
    const { phase, startedAt, pausedAt, pausedTotalMs, plannedMs } = timer
    if (phase === 'running') return { startedAt: startedAt + pausedTotalMs, durationMs: plannedMs, elapsedMs: 0, paused: false }
    if (phase === 'paused') return { startedAt: pausedAt, durationMs: plannedMs, elapsedMs: Math.max(0, pausedAt - startedAt - pausedTotalMs), paused: true }
    if (phase === 'done') return { startedAt, durationMs: plannedMs, elapsedMs: plannedMs, paused: true }
    return null
  }, [timer.phase, timer.startedAt, timer.pausedAt, timer.pausedTotalMs, timer.plannedMs]) // eslint-disable-line react-hooks/exhaustive-deps
  useSkyClock(clock)

  const active = useActive()
  const activeRef = useRef(active)
  activeRef.current = active

  // ⌘K·오늘에서 넘어온 집중 의도
  useEffect(() => {
    if (!intent) return
    useUi.getState().setFocusIntent(null)
    const t = useFocusTimer.getState()
    if (t.phase === 'running' || t.phase === 'paused') return
    t.reset()
    t.setSubject(intent.subjectId)
    t.setPlanned(intent.minutes * 60_000)
    if (intent.autostart) setTimeout(() => start(), 420)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent])

  useEffect(() => {
    setChromeHidden(running && active)
    return () => setChromeHidden(false)
  }, [running, active, setChromeHidden])

  // 1초마다: 숫자·진행선 갱신 + 하늘의 별이 자람 + 끝 감지
  useEffect(() => {
    if (!running) return
    const tick = () => {
      const s = useFocusTimer.getState()
      const r = remainingMs(s)
      if (r <= 0) void complete()
      else {
        sky.growStar(starId(s.startedAt), 1 - r / s.plannedMs)
        // 숨은 공간(keep-alive)이면 다시 그리지 않는다 — 다시 보일 때 활성 컨텍스트 변경으로 새 값으로 그려진다(전력)
        if (activeRef.current) force((n) => n + 1)
      }
    }
    tick()
    const iv = window.setInterval(tick, 1000)
    const onVis = () => !document.hidden && tick()
    document.addEventListener('visibilitychange', onVis)
    return () => {
      clearInterval(iv)
      document.removeEventListener('visibilitychange', onVis)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, sky])

  useEffect(() => {
    if (!active) return
    document.title = running ? `${fmtClock(remain)} · 결` : '결 — 집중'
    return () => {
      document.title = '결 — 쓰고, 잇고, 남긴다'
    }
  }, [running, remain, active])

  function start() {
    const t = Date.now()
    useFocusTimer.getState().start(t)
    // 새 별이 아주 희미하게 자리를 잡는다 (세트가 끝나면 피어난다)
    sky.birthStar({ id: starId(t), at: 'next', kind: 'small', subject: useFocusTimer.getState().subjectId ?? undefined, level: 0.08 })
  }

  async function complete() {
    if (finishing.current) return
    finishing.current = true
    const s = useFocusTimer.getState()
    const id = starId(s.startedAt)
    const end = Math.min(s.startedAt + s.plannedMs + s.pausedTotalMs, Date.now())
    s.finish()
    // 직전 별 = 오늘 하늘에 이미 떠 있는 마지막 세트 (없으면 선을 긋지 않는다 — 좌표가 없는 선은 그리지 않기)
    const prevId: string | null = todayRef.current?.list.at(-1)?.id ?? null
    try {
      await db.focusSessions.put({ id, subjectId: s.subjectId, plannedMs: s.plannedMs, startedAt: s.startedAt, endedAt: end, completed: true, createdAt: Date.now() })
    } catch {
      /* 저장 실패해도 화면은 끝 상태로 */
    }
    // 세트 완료 = 오늘의 별 탄생 + 직전 별과 선
    sky.growStar(id, 1)
    sky.birthStar({ id, at: 'next', kind: 'set', subject: s.subjectId ?? undefined })
    if (prevId && prevId !== id) sky.drawLink(prevId, id, { layer: 'today' })
    finishing.current = false
  }

  const stop = async () => {
    const s = useFocusTimer.getState()
    const id = starId(s.startedAt)
    const done = s.plannedMs - remainingMs(s)
    if (done >= 5 * 60_000) {
      try {
        await db.focusSessions.put({ id, subjectId: s.subjectId, plannedMs: s.plannedMs, startedAt: s.startedAt, endedAt: Date.now(), completed: true, createdAt: Date.now() })
        // 하늘이 응답한다(작은 별) — 토스트 없음 (design-m1 4-2)
        sky.birthStar({ id, at: 'next', kind: 'small', subject: s.subjectId ?? undefined })
      } catch {
        /* noop */
      }
    } else {
      // 포기: 자라던 별이 조용히 사그라진다
      sky.fadeStar(id, { to: 0, ms: 900 })
    }
    s.reset()
  }

  const cycleSubject = () => {
    const ids: Array<string | null> = [...subjects.map((x) => x.id), null]
    timer.setSubject(ids[(ids.indexOf(timer.subjectId) + 1) % ids.length] ?? null)
  }

  return (
    <>
      <FieldMood
        preset="focus"
        drag={SKY.drag}
        knotRef={knotRef}
        data={{ rings: today?.sets ?? 0, pressure: 0, load: 0.2 }}
        stars={today ? { today: today.list.map((s) => ({ id: s.id, at: s.startedAt, kind: 'set' as const })) } : undefined}
      />
      <section ref={stageRef} className={`focus-stage${running ? ' is-running' : ''}`} aria-label="집중">
        <FocusBezel active={active} progress={progress} state={timer.phase} stageRef={stageRef} />
        {/* 글 블록: 가로 = 링 왼쪽 글 구역 세로 가운데, 세로·폰 = 링 아래 바깥(링 중심과 같은 x). 링 안에는 넣지 않는다 */}
        <div className="focus-block">
          <button type="button" className="focus-subject" onClick={cycleSubject} disabled={live} aria-label={`과목: ${subject?.name ?? '자유'} (눌러서 바꾸기)`}>
            {subject && <i style={{ background: `var(--s-${subject.color})` }} aria-hidden="true" />}
            <span>{subject?.name ?? '자유'}</span>
          </button>

          <div className="timer" ref={knotRef}>
            <span className="timer-num" role="timer" aria-label={`남은 시간 ${fmtClock(remain)}`}>
              {fmtClock(remain)}
            </span>
            <span className="sr-only" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} aria-label="진행" />
            {timer.phase === 'paused' && <span className="meta timer-meta" aria-live="polite">멈춤</span>}
          </div>

          <div className="actions focus-actions">
            {timer.phase === 'idle' && <PrimaryButton onClick={() => start()}>시작</PrimaryButton>}
            {timer.phase === 'running' && (
              <button type="button" className="icon-btn ghost big" aria-label="일시정지" onClick={() => timer.pause()}>
                <IconPause size={20} />
              </button>
            )}
            {timer.phase === 'paused' && (
              <>
                <PrimaryButton onClick={() => timer.resume()} arrow={false}>이어서</PrimaryButton>
                <QuietButton onClick={() => void stop()}>끝내기</QuietButton>
              </>
            )}
            {timer.phase === 'done' && (
              <>
                <PrimaryButton onClick={() => { timer.reset(); start() }}>한 번 더</PrimaryButton>
                <QuietButton onClick={() => timer.reset()}>쉬기</QuietButton>
              </>
            )}
          </div>

          {timer.phase === 'idle' && (
            <div className="durations enter enter-2" role="radiogroup" aria-label="집중 시간">
              {DURATIONS.map((m) => (
                <button key={m} type="button" role="radio" aria-checked={timer.plannedMs === m * 60_000} className="chip mono" onClick={() => timer.setPlanned(m * 60_000)}>
                  {m}
                </button>
              ))}
            </div>
          )}
        </div>
      </section>
    </>
  )
}
