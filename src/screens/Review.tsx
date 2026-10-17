/**
 * 복습 (design-m4 1장 · 리더 결정 1 · 3). 글 없이 `▤ 18`(오늘 몫만) + 금빛 ▶. ▶ 왼쪽 새 출발(조건일 때만) · 오른쪽 후보 점.
 * ▶ 길게 = 둥근 메뉴(12시 섞어서 · 4시 과목 하나 · 8시 시험 범위). 세션은 FSRS(src/memory, 지연 조각)로 정하고 평가마다 reviewLogs 한 행.
 * 카드: 누르면 뒤집힘 · 진행선(뒤로 가지 않음, ↺ 카드는 세지 않음) · 새 카드는 빈 고리 · 테이프 카드는 손글씨 엔진 그림(TapeReveal).
 * 평가는 ↺ 다시 · ✓ 알았음(길게 = 어려움 · 알맞음 · 쉬움). 키: Space/Enter 뒤집기, 1 · 2 · 3/Enter · 4 평가, Esc 그만.
 * 끝 화면 = ✓ 선 그리기(툴팁 '내일 n', 0이면 없음) → 4초 뒤 40%.
 */
import { useLiveQuery } from 'dexie-react-hooks'
import { AnimatePresence, motion } from 'motion/react'
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { useSkyEvent } from '@/fx'
import { ActiveMood as FieldMood, useActive } from '@/app/keepAlive'
import { useNow, useSubjects } from '@/db/hooks'
import { db, type Card } from '@/db/schema'
import { DAY, MIN } from '@/lib/time'
import { useUi } from '@/stores/ui'
import { useEffectiveMotion, useGo, useMediaQuery } from '@/shell/hooks'
import { IconCandidate, IconCheck, IconClose, IconExam, IconFresh, IconPlay, IconReview, IconUndo } from '@/shell/icons'
import { tip } from '@/shell/Tip'
import { Hint } from '@/shell/Hint'
import { useHintCount } from '@/shell/hints'
import { pushLayer } from '@/shell/layers'
import { spaceOf } from '@/shell/spaces'
import { takeReviewAsk, useReviewAsk } from '@/memory/intent'
import { memoryChanged } from '@/memory/brightness'
import type { Quota, SessionMode } from '@/memory/session'
import { Hero } from './parts'
import { screenKey } from './keyScope'
import '@/styles/review.css'

const CandidateBox = lazy(() => import('@/memory/CandidateBox'))
const TapeReveal = lazy(() => import('@/ink').then((m) => ({ default: m.TapeReveal })))
type MemMod = typeof import('@/memory/session')
const loadMem = () => import('@/memory/session')
const loadFsrs = () => import('@/memory/fsrs')

/** 평가 4종(FSRS: again · hard · good · easy). level = 하늘의 그 카드 별 밝기 */
const RATINGS = [
  { k: 1, label: '다시', level: 0.25 },
  { k: 2, label: '어려움', level: 0.8 },
  { k: 3, label: '알맞음', level: 1 },
  { k: 4, label: '쉬움', level: 1 },
] as const
type Rating = (typeof RATINGS)[number]
const R = (k: 1 | 2 | 3 | 4): Rating => RATINGS[k - 1]!

const DIM = 0.3
const night = () => document.documentElement.dataset.theme !== 'light'
const blankify = (s: string) => s.split('[…]').flatMap((p, i) => (i ? [<span key={i} className="cb-blank" aria-label="빈칸">▁▁</span>, p] : [p]))

/** 카드가 하나도 없을 때의 첫 회 그림: 빈 카드(점선) → 별 하나 */
const EMPTY_ART = (
  <svg width="80" height="80" viewBox="0 0 80 80" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="20" y="24" width="40" height="30" rx="5" strokeDasharray="4 3" />
    <path className="ha-fade-in" d="M40 33l1.6 3.6 3.6 1.6-3.6 1.6-1.6 3.6-1.6-3.6-3.6-1.6 3.6-1.6z" fill="currentColor" stroke="none" />
  </svg>
)
const SKY = spaceOf('/review')

export function ReviewScreen() {
  const { now } = useNow()
  const subjects = useSubjects() ?? []
  const knotRef = useRef<HTMLSpanElement>(null)
  const [mem, setMem] = useState<MemMod | null>(null)
  const [session, setSession] = useState<{ cards: Card[]; mode: SessionMode } | null>(null)
  const [levels, setLevels] = useState<Record<string, number>>({})
  const [ended, setEnded] = useState(0)
  const [box, setBox] = useState<{ noteId: string | null } | null>(null)
  const [fresh, setFresh] = useState(false)
  const sky = useSkyEvent()
  const go = useGo()
  const active = useActive()
  const reviewIntent = useUi((s) => s.reviewIntent)
  const ask = useReviewAsk()
  const minuteKey = Math.floor(now.getTime() / MIN)

  // 기억 엔진(ts-fsrs)은 지연 조각: 복습 장소가 보이면 바로, 아니면 한가할 때
  useEffect(() => {
    if (mem) return
    let alive = true
    const load = () => void loadMem().then((m) => alive && setMem(m))
    if (active) load()
    else {
      const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (h: number) => void }
      const h = w.requestIdleCallback ? w.requestIdleCallback(load, { timeout: 5000 }) : window.setTimeout(load, 2500)
      return () => {
        alive = false
        if (w.cancelIdleCallback) w.cancelIdleCallback(h)
        else window.clearTimeout(h)
      }
    }
    return () => {
      alive = false
    }
  }, [active, mem])

  const quota = useLiveQuery(() => mem?.todayQuota(), [mem, minuteKey]) as Quota | undefined
  const freshOk = useLiveQuery(() => (mem && quota?.total ? mem.freshStartVisible() : false), [mem, quota?.total, minuteKey])
  const cand = useLiveQuery(() => db.cardCandidates.where('status').equals('new').count(), []) ?? 0
  const exam = useLiveQuery(
    () =>
      db.tasks
        .where('kind')
        .equals('exam')
        .filter((t) => !t.done && t.dueAt >= Date.now() - DAY)
        .sortBy('dueAt')
        .then((a) => a[0] ?? null),
    [minuteKey],
  )
  // 성단: 진행 중엔 이번 세션 카드(평가한 만큼 밝게), 아니면 오늘 몫
  const todayCards = useLiveQuery(() => (mem && !session ? mem.buildSession({ kind: 'mix' }) : undefined), [mem, session, quota?.total])
  const starCards = session?.cards ?? todayCards ?? []

  const subj = (id: string) => subjects.find((s) => s.id === id)
  const name = (id: string) => subj(id)?.name ?? ''
  const color = (id: string) => {
    const s = subj(id)
    return s ? `var(--s-${s.color})` : 'var(--text-3)'
  }
  const skyData = { load: quota ? Math.min(1, quota.total / 40) : 0.3, rings: 0 }
  const skyStars = { review: starCards.map((c) => ({ id: c.id, subject: c.subjectId, level: levels[c.id] ?? DIM })) }

  const start = useCallback(
    async (mode: SessionMode = { kind: 'mix' }) => {
      const m = mem ?? (await loadMem())
      if (!mem) setMem(m)
      const cards = await m.buildSession(mode)
      if (!cards.length) return
      setEnded(0)
      setLevels({})
      setBox(null)
      setFresh(false)
      setSession({ cards, mode })
    },
    [mem],
  )

  // 밖에서 온 뜻: 오늘 ▶ · ⌘K · 별 정보(reviewIntent, 세션 모드는 intent에서) · 후보함 · 새 출발
  useEffect(() => {
    if (!reviewIntent) return
    useUi.getState().setReviewIntent(false)
    const a = takeReviewAsk()
    if (session) return
    void start(a?.kind === 'session' ? a.mode : { kind: 'mix' })
  }, [reviewIntent, session, start])
  useEffect(() => {
    if (!ask || ask.kind === 'session') return
    takeReviewAsk()
    if (session) return
    if (ask.kind === 'candidates') setBox({ noteId: ask.noteId ?? null })
    else setFresh(true)
  }, [ask, session])
  // 설정의 새 출발 (앱 B: window 'gyeol:fresh-start')
  useEffect(() => {
    const on = () => {
      setFresh(true)
      if (!location.pathname.startsWith('/review')) void go('/review')
    }
    window.addEventListener('gyeol:fresh-start', on)
    return () => window.removeEventListener('gyeol:fresh-start', on)
  }, [go])

  const finish = () => {
    const from = session?.mode
    setSession(null)
    setEnded(Date.now())
    sky.swellBand()
    sky.meteor({ kind: 'signal', size: 'md' })
    // 흐린 별에서 온 짧은 세션은 지도로 돌아간다(별은 새 밝기)
    if (from?.kind === 'note') window.setTimeout(() => history.back(), 900)
  }
  const closeBox = useCallback(() => setBox(null), [])
  const closeFresh = useCallback(() => setFresh(false), [])

  // 시작 화면 키: Space = ▶ (글 쓰는 중 · 떠 있는 층이면 아님)
  useEffect(() => {
    if (session || box || !active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || !screenKey(e, '/review')) return
      if (e.key === ' ' && quota?.total) {
        e.preventDefault()
        void start()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [session, box, active, quota?.total, start])

  if (session) {
    return (
      <>
        <FieldMood preset={SKY.mood} drag={SKY.drag} knotRef={knotRef} data={skyData} stars={skyStars} />
        <ReviewSession
          cards={session.cards}
          knotRef={knotRef}
          name={name}
          color={color}
          onRate={(card, level) => {
            setLevels((l) => ({ ...l, [card.id]: level }))
            sky.relight(card.id, level, { glint: level >= 1 })
            memoryChanged()
          }}
          onExit={() => setSession(null)}
          onDone={finish}
        />
      </>
    )
  }

  const total = quota?.total ?? 0
  const doneMark = !!quota && total === 0 && (ended > 0 || quota.doneToday > 0)
  return (
    <>
      <FieldMood preset={SKY.mood} drag={SKY.drag} knotRef={knotRef} data={skyData} stars={skyStars} />
      <Hero knotRef={knotRef} label="복습" className="review-hero rv-quiet">
        <h1 className="sr-only">복습</h1>
        {box ? null : !quota ? null : !quota.anyCards && !cand ? (
          // 카드도 후보도 아직 없음: 첫 회 그림만. 끝 상태와 다르다(QA #19)
          <>
            <p className="sr-only" role="status">
              카드 없음
            </p>
            <span className="rv-empty-anchor" aria-hidden="true">
              <Hint id="review-empty" side="right" art={EMPTY_ART} />
            </span>
          </>
        ) : (
          <div className="rv-start enter enter-1">
            {total > 0 && (
              <span className="inum rv-count" tabIndex={0} {...tip(`오늘 ${total} · 약 ${quota.minutes}분${quota.fresh ? ` · 새 ${quota.fresh}` : ''}`)}>
                <IconReview size={22} />
                <span className="mono">{total}</span>
              </span>
            )}
            {doneMark && <DoneMark tomorrow={quota.tomorrow} fresh={ended > 0 && Date.now() - ended < 4000} />}
            <div className="rv-acts">
              {total > 0 && freshOk && (
                <button type="button" className="ibtn rv-fresh" {...tip('새 출발')} onClick={() => setFresh((v) => !v)} aria-expanded={fresh}>
                  <IconFresh size={20} />
                </button>
              )}
              {total > 0 && <PlayButton onStart={(m) => void start(m)} exam={exam ?? null} mem={mem} color={color} name={name} />}
              {cand > 0 && (
                <button type="button" className="ibtn rv-cand" {...tip(`후보 ${cand}`)} onClick={() => setBox({ noteId: null })}>
                  <IconCandidate size={18} />
                  <span className="mono">{cand > 99 ? '99+' : cand}</span>
                </button>
              )}
            </div>
            {fresh && <FreshConfirm mem={mem} onClose={closeFresh} />}
          </div>
        )}
      </Hero>
      {box && (
        <Suspense fallback={null}>
          <CandidateBox noteId={box.noteId} onClose={closeBox} />
        </Suspense>
      )}
    </>
  )
}

/** 끝 ✓: 금빛 선 64px 원 + 체크(선 그리기 360ms). 툴팁 '내일 n'(0이면 없음). 4초 뒤 40% */
function DoneMark({ tomorrow, fresh }: { tomorrow: number; fresh: boolean }) {
  const [dim, setDim] = useState(!fresh)
  useEffect(() => {
    if (!fresh) return
    const t = window.setTimeout(() => setDim(true), 4000)
    return () => window.clearTimeout(t)
  }, [fresh])
  const t = tomorrow ? tip(`내일 ${tomorrow}`) : { 'aria-label': '오늘 끝' }
  return (
    <span className={`rv-done${dim ? ' is-dim' : ''}${fresh ? ' is-draw' : ''}`} tabIndex={0} {...t}>
      <svg width="64" height="64" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="32" cy="32" r="30.5" />
        <path className="rv-done-check" d="M21 33l7.5 7.5L44 25" pathLength={1} />
      </svg>
    </span>
  )
}

/** ▶: 톡 = 섞어서. 길게(500ms) · 메뉴 키 = 둥근 메뉴 3칸(12시 섞어서 · 4시 과목 하나 · 8시 시험 범위) */
function PlayButton({ onStart, exam, mem, color, name }: { onStart: (m: SessionMode) => void; exam: { id: string; title: string } | null; mem: MemMod | null; color: (id: string) => string; name: (id: string) => string }) {
  const [open, setOpen] = useState(false)
  const [subs, setSubs] = useState<string[] | null>(null)
  const box = useRef<HTMLSpanElement>(null)
  const press = useRef<{ timer: number; long: boolean; x: number; y: number } | null>(null)
  useEffect(() => {
    if (!open) return
    const off = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', off)
    const release = pushLayer({
      id: 'review-play',
      el: box.current,
      restoreFocusTo: box.current?.querySelector('.gold-btn') ?? null,
      close: () => {
        if (subs) {
          setSubs(null)
          return false
        }
        setOpen(false)
      },
    })
    return () => {
      document.removeEventListener('pointerdown', off)
      release()
    }
  }, [open, subs])
  useEffect(() => {
    if (!open) setSubs(null)
  }, [open])
  const pickSubject = async () => {
    const m = mem ?? (await loadMem())
    const cards = await m.buildSession({ kind: 'mix' })
    setSubs([...new Set(cards.map((c) => c.subjectId))])
  }
  const choose = (m: SessionMode) => {
    setOpen(false)
    onStart(m)
  }
  const stop = () => {
    const p = press.current
    if (p) window.clearTimeout(p.timer)
  }
  return (
    <span className={`rv-play${open ? ' is-open' : ''}`} ref={box}>
      <button
        type="button"
        className="gold-btn"
        {...tip('복습 시작', { kbd: 'Space' })}
        data-radial=""
        aria-haspopup="menu"
        aria-expanded={open}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          const p = { timer: 0, long: false, x: e.clientX, y: e.clientY }
          p.timer = window.setTimeout(() => {
            p.long = true
            setOpen(true)
          }, 500)
          press.current = p
        }}
        onPointerMove={(e) => {
          const p = press.current
          if (p && !p.long && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 10) {
            stop()
            press.current = null
          }
        }}
        onPointerUp={stop}
        onPointerCancel={() => {
          stop()
          press.current = null
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          stop()
          setOpen(true)
        }}
        onClick={() => {
          const p = press.current
          press.current = null
          if (p?.long || open) return
          onStart({ kind: 'mix' })
        }}
        onKeyDown={(e) => {
          if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
            e.preventDefault()
            setOpen(true)
          }
        }}
      >
        <IconPlay size={22} />
      </button>
      {open && !subs && (
        <span className="rv-radial" role="menu" aria-label="복습 방법">
          <button type="button" role="menuitem" className="rv-ri rv-ri-0" {...tip('섞어서')} onClick={() => choose({ kind: 'mix' })} autoFocus>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 7h3.5c4.5 0 4.5 10 9 10H20M4 17h3.5c1.6 0 2.6-1.3 3.4-3M13.1 10c.8-1.7 1.8-3 3.4-3H20M17.5 4.5L20 7l-2.5 2.5M17.5 14.5L20 17l-2.5 2.5" />
            </svg>
          </button>
          <button type="button" role="menuitem" className="rv-ri rv-ri-1" {...tip('과목 하나')} onClick={() => void pickSubject()}>
            <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="7" cy="12" r="2.2" fill="currentColor" />
              <circle cx="12" cy="12" r="2.2" fill="none" stroke="currentColor" strokeWidth={1.5} />
              <circle cx="17" cy="12" r="2.2" fill="none" stroke="currentColor" strokeWidth={1.5} />
            </svg>
          </button>
          {exam && (
            <button type="button" role="menuitem" className="rv-ri rv-ri-2" {...tip(`시험 범위 · ${exam.title}`)} onClick={() => choose({ kind: 'exam', examId: exam.id })}>
              <IconExam size={20} />
            </button>
          )}
        </span>
      )}
      {open && subs && (
        <span className="rv-subs" role="menu" aria-label="과목">
          {subs.map((s, i) => (
            <button key={s} type="button" role="menuitem" className="rv-sub" {...tip(name(s) || '과목 없음')} onClick={() => choose({ kind: 'subject', subjectId: s })} autoFocus={i === 0}>
              <i className="sdot" style={{ ['--c' as string]: color(s) }} />
            </button>
          ))}
        </span>
      )}
    </span>
  )
}

/** 새 출발 확인 칸: '새 출발' + 7 · 14 · 28(기본 14) + ✓ · ✕. 되돌리기 5초 */
function FreshConfirm({ mem, onClose }: { mem: MemMod | null; onClose: () => void }) {
  const [days, setDays] = useState<7 | 14 | 28>(14)
  const [undo, setUndo] = useState<null | (() => Promise<void>)>(null)
  const sky = useSkyEvent()
  const el = useRef<HTMLDivElement>(null)
  useEffect(() => pushLayer({ id: 'fresh-start', el: el.current, restoreFocusTo: null, close: onClose }), [onClose])
  useEffect(() => {
    if (!undo) return
    const t = window.setTimeout(onClose, 5000)
    return () => window.clearTimeout(t)
  }, [undo, onClose])
  const run = async () => {
    const m = mem ?? (await loadMem())
    const r = await m.freshStart(days)
    if (!r.moved) return onClose()
    sky.swellBand({ amount: 0.15, ms: 600, at: 'cluster' })
    setUndo(() => r.undo)
  }
  return (
    <div className="rv-fresh-box" ref={el} role="group" aria-label="새 출발">
      {undo ? (
        <button
          type="button"
          className="ibtn"
          {...tip('되돌리기')}
          onClick={() => {
            void undo().then(onClose)
          }}
          autoFocus
        >
          <IconUndo size={18} />
        </button>
      ) : (
        <>
          <span className="rv-fresh-word">새 출발</span>
          <span className="seg rv-seg" role="radiogroup" aria-label="나눌 날">
            {([7, 14, 28] as const).map((d) => (
              <button key={d} type="button" role="radio" aria-checked={days === d} className={`seg-ico mono${days === d ? ' is-on' : ''}`} onClick={() => setDays(d)}>
                {d}
              </button>
            ))}
          </span>
          <button type="button" className="gold-btn rv-fresh-ok" {...tip('나누기')} onClick={() => void run()} autoFocus>
            <IconCheck size={18} />
          </button>
          <button type="button" className="ibtn" {...tip('닫기', { kbd: 'esc' })} onClick={onClose}>
            <IconClose size={18} />
          </button>
        </>
      )}
    </div>
  )
}

function RegionFace({ pageId, rect, covered, onReveal }: { pageId: string; rect: [number, number, number, number]; covered: boolean; onReveal: () => void }) {
  const [urls, setUrls] = useState<[string, string] | null>(null)
  useEffect(() => {
    let alive = true
    void import('@/ink')
      .then((ink) => Promise.all([ink.renderPageRegion(pageId, rect, { covered: true, scale: 2, night: night() }), ink.renderPageRegion(pageId, rect, { covered: false, scale: 2, night: night() })]))
      .then(([a, b]) => alive && a && b && setUrls([a.url, b.url]))
      .catch(() => {})
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId, rect.join()])
  return (
    <div className="rv-region" onClick={covered ? onReveal : undefined}>
      {urls && <img key={covered ? 'c' : 'u'} className="rv-region-img" src={covered ? urls[0] : urls[1]} alt="" draggable={false} />}
    </div>
  )
}

function ReviewSession({
  cards,
  knotRef,
  name,
  color,
  onRate,
  onExit,
  onDone,
}: {
  cards: Card[]
  knotRef: RefObject<HTMLSpanElement | null>
  name: (id: string) => string
  color: (id: string) => string
  onRate: (card: Card, level: number) => void
  onExit: () => void
  onDone: () => void
}) {
  const [queue, setQueue] = useState(cards)
  const [i, setI] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [fan, setFan] = useState(false)
  const [done, setDone] = useState<Set<string>>(() => new Set())
  const again = useRef(new Map<string, number>())
  const shownAt = useRef(performance.now())
  // 처음 10장만 버튼 아래 낱말 (공용 '처음 n번' — 설정 '처음 화면 다시 보기'로 다시 보인다)
  const { fresh: words, bump: bumpWords } = useHintCount('review-words', 10)
  const level = useEffectiveMotion()
  const hasKeyboard = useMediaQuery('(hover: hover) and (pointer: fine)')
  const card = queue[i]
  const off = level === 'off'
  const active = useActive()
  const busy = useRef(false)
  // 진행 = 끝낸 수 ÷ 처음 수. ↺로 다시 나오는 카드는 세지 않고, 끝 전에는 0.98에서 멈춘다(뒤로 가지 않음)
  const progress = Math.min(done.size / Math.max(1, cards.length), 0.98)

  useEffect(() => {
    shownAt.current = performance.now()
  }, [i])
  // 다음 카드의 테이프 그림을 미리
  useEffect(() => {
    const n = queue[i + 1]
    if (n?.source?.kind === 'tape' && n.source.itemId) void import('@/ink').then((ink) => ink.renderTapeRegion(n.source!.itemId!, { covered: true, scale: 2, night: night() })).catch(() => {})
  }, [i, queue])

  const rate = async (r: Rating) => {
    if (!card || !flipped || busy.current) return
    busy.current = true
    setFan(false)
    let next = card
    try {
      const f = await loadFsrs()
      next = (await f.rate(card, r.k, Date.now(), performance.now() - shownAt.current)).card
    } catch {
      /* 저장 실패해도 진행은 계속 */
    }
    bumpWords()
    onRate(card, r.level)
    let q = queue
    const n = again.current.get(card.id) ?? 0
    if (r.k === 1 && n < 2) {
      // ↺: 이번 세션에서 몇 장 뒤에 한 번 더(최대 2번). 진행선은 세지 않는다
      again.current.set(card.id, n + 1)
      q = [...queue]
      q.splice(Math.min(i + 4, q.length), 0, next)
      setQueue(q)
    } else setDone((s) => new Set(s).add(card.id))
    busy.current = false
    if (i + 1 >= q.length) onDone()
    else {
      setI(i + 1)
      setFlipped(false)
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 글을 쓰는 중(메모 칸 등)이거나 포커스가 복습 밖 · 떠 있는 층이면 복습 키가 아니다(QA #1)
      if (!active || e.metaKey || e.ctrlKey || e.altKey || !screenKey(e, '/review')) return
      if (e.key === 'Escape') {
        if (fan) setFan(false)
        else onExit()
      } else if ((e.key === ' ' || e.key === 'Enter') && !flipped) {
        e.preventDefault()
        setFlipped(true)
      } else if (flipped && ['1', '2', '3', '4'].includes(e.key)) {
        e.preventDefault()
        void rate(R(Number(e.key) as 1 | 2 | 3 | 4))
      } else if (flipped && e.key === 'Enter' && !(e.target as HTMLElement).closest?.('button')) {
        e.preventDefault()
        void rate(R(3))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!card) return null
  const src = card.source
  const tapeId = src?.kind === 'tape' ? src.itemId : null
  const region = src?.kind === 'tape' && !src.itemId && src.pageId && src.rect ? { pageId: src.pageId, rect: src.rect } : null
  const isNew = card.state === 'new'
  const T_OUT = off ? { duration: 0.12 } : { duration: 0.16, ease: [0.4, 0, 1, 1] as const }
  const T_IN = off ? { duration: 0.12 } : { delay: 0.12, duration: 0.2, ease: [0, 0, 0.2, 1] as const }
  return (
    <section className="hero hero-zone review-session rv-quiet" aria-label="복습 진행">
      <span className="knot-anchor" ref={knotRef} aria-hidden="true" />
      <div className="hero-col zone-a">
        <div className="rv-stage">
          <i className="rv-prog" style={{ transform: `scaleX(${progress})` }} role="progressbar" aria-label="진행" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} />
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.article
              key={`${card.id}:${i}`}
              className={`flash rv-card${flipped ? ' is-back' : ' is-front'}${tapeId || region ? ' is-img' : ''}`}
              role={flipped || tapeId ? undefined : 'button'}
              tabIndex={flipped || tapeId ? undefined : 0}
              aria-label={flipped || tapeId ? undefined : '뒤집기'}
              onClick={flipped || tapeId ? undefined : () => setFlipped(true)}
              initial={off ? { opacity: 0 } : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0, scale: 1, transition: T_IN }}
              exit={off ? { opacity: 0, transition: T_OUT } : { opacity: 0, scale: 0.97, y: -4, transition: T_OUT }}
            >
              <i className={`sdot rv-sdot${isNew ? ' is-new' : ''}`} style={{ ['--c' as string]: color(card.subjectId) }} {...tip(isNew ? `${name(card.subjectId) || '과목 없음'} · 새 카드` : name(card.subjectId) || '과목 없음')} />
              {tapeId ? (
                <Suspense fallback={<div className="rv-region" />}>
                  <TapeReveal itemId={tapeId} covered={!flipped} onReveal={() => setFlipped(true)} night={night()} className="rv-tape" />
                </Suspense>
              ) : region ? (
                <RegionFace pageId={region.pageId} rect={region.rect} covered={!flipped} onReveal={() => setFlipped(true)} />
              ) : (
                <>
                  <p className="flash-q">{blankify(card.front)}</p>
                  {flipped && (
                    <div className="rv-answer">
                      <p className="flash-a">{card.back}</p>
                    </div>
                  )}
                </>
              )}
              {!flipped && !tapeId && <Hint id="H4" side="top" />}
              <button
                type="button"
                className="icon-btn ghost rv-quit"
                {...tip('그만하기', { kbd: 'esc' })}
                onClick={(e) => {
                  e.stopPropagation()
                  onExit()
                }}
              >
                <IconClose size={16} />
              </button>
            </motion.article>
          </AnimatePresence>
        </div>
        <div className="actions rv-actions">
          {flipped && (
            <div className="rv-rate" role="group" aria-label="얼마나 기억났나요">
              <div className="rv-btn">
                <button type="button" className="rv-again" {...tip('다시', { kbd: '1' })} onClick={() => void rate(R(1))}>
                  <IconUndo size={24} />
                </button>
                {(words || hasKeyboard) && (
                  <span className="rv-cap" aria-hidden="true">
                    {words && <span className="rv-word">다시</span>}
                    {hasKeyboard && <span className="rv-key mono">1</span>}
                  </span>
                )}
              </div>
              <CheckRate open={fan} setOpen={setFan} words={words} hasKeyboard={hasKeyboard} onRate={(r) => void rate(r)} />
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

/**
 * ✓ 알았음: 톡 = 알맞음(good). 길게(500ms) = 어려움 · 알맞음 · 쉬움 부채꼴 — 누른 채 끌어 놓거나, 떼고 하나를 톡.
 * 키보드: Enter/Space = 알맞음, 메뉴 키 · Shift+F10 = 부채꼴(길게 누르기로만 닿는 것은 없다).
 */
function CheckRate({ open, setOpen, words, hasKeyboard, onRate }: { open: boolean; setOpen: (v: boolean) => void; words: boolean; hasKeyboard: boolean; onRate: (r: Rating) => void }) {
  const press = useRef<{ timer: number; x: number; y: number; long: boolean; id: number } | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const fanKs = [2, 3, 4] as const

  // 바깥을 누르면 닫고, 겹침 층으로 올려 Esc가 부채꼴만 닫게 한다(포커스는 ✓로)
  useEffect(() => {
    if (!open) return
    const off = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', off)
    const release = pushLayer({ id: 'review-fan', close: () => setOpen(false), restoreFocusTo: box.current?.querySelector('.rv-check') ?? null, el: box.current })
    return () => {
      document.removeEventListener('pointerdown', off)
      release()
    }
  }, [open, setOpen])

  const optionAt = (x: number, y: number): number | null => {
    const el = document.elementFromPoint(x, y)?.closest?.('[data-rate]') as HTMLElement | null
    return el && box.current?.contains(el) ? Number(el.dataset.rate) : null
  }

  const down = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return
    const p = { timer: 0, x: e.clientX, y: e.clientY, long: false, id: e.pointerId }
    p.timer = window.setTimeout(() => {
      p.long = true
      setOpen(true)
    }, 500)
    press.current = p
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* 무시 */
    }
  }
  const move = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const p = press.current
    if (!p || p.id !== e.pointerId) return
    if (!p.long) {
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > 10) {
        window.clearTimeout(p.timer)
        press.current = null
      }
      return
    }
    setHover(optionAt(e.clientX, e.clientY))
  }
  const up = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const p = press.current
    press.current = null
    if (!p || p.id !== e.pointerId) return
    window.clearTimeout(p.timer)
    if (!p.long) return onRate(R(3)) // 톡 = 알맞음
    const k = optionAt(e.clientX, e.clientY)
    setHover(null)
    if (k) onRate(R(k as 2 | 3 | 4)) // 끌어 놓기
    // 아니면 부채꼴을 연 채로 둔다(하나를 톡)
  }
  const cancel = () => {
    const p = press.current
    if (p) window.clearTimeout(p.timer)
    press.current = null
    setHover(null)
  }

  return (
    <div className={`rv-btn rv-check-wrap${open ? ' is-open' : ''}`} ref={box}>
      <button
        type="button"
        className="gold-btn rv-check"
        {...tip('알았음', { kbd: '3' })}
        data-radial=""
        aria-haspopup="menu"
        aria-expanded={open}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={cancel}
        onContextMenu={(e) => e.preventDefault()}
        onClick={(e) => {
          // 키보드로 누른 것만(포인터는 pointerup이 맡는다)
          if (e.detail === 0) onRate(R(3))
        }}
        onKeyDown={(e) => {
          if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
            e.preventDefault()
            setOpen(!open)
          }
        }}
      >
        <IconCheck size={24} />
      </button>
      {/* 펼친 동안 ✓의 글·키 숫자는 숨긴다(세 단계에 같은 숫자가 있다) */}
      {!open && (words || hasKeyboard) && (
        <span className="rv-cap" aria-hidden="true">
          {words && <span className="rv-word">알았음</span>}
          {hasKeyboard && <span className="rv-key mono">3</span>}
        </span>
      )}
      {!open && <Hint id="H5" side="top" />}

      {open && (
        <div className="rv-fan" role="menu" aria-label="세 단계">
          {fanKs.map((k, n) => (
            <button
              key={k}
              type="button"
              role="menuitem"
              data-rate={k}
              className={`rv-fan-item rv-fan-${n}${hover === k ? ' is-hover' : ''}`}
              onClick={() => onRate(R(k))}
              autoFocus={n === 1 && hasKeyboard}
            >
              <span>{R(k).label}</span>
              {hasKeyboard && <small className="mono">{k}</small>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
