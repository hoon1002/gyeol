/**
 * 복습 (design-m1 → design-quiet 1-4 · 리더 결정 1): 글 없이 `▤ 13` + 금빛 ▶. 카드는 누르면 뒤집힌다.
 * 평가는 늘 2개: ↺ 다시 · ✓ 알았음(= 알맞음). ✓를 길게(500ms) 누르면 어려움 · 알맞음 · 쉬움이 부채꼴로 나온다.
 * 저장하는 평가 값은 4종 그대로(again · hard · good · easy — M4 FSRS와 맞춤). 키: Space/Enter 뒤집기, 1·2·3·4 평가, Esc 그만.
 * 처음 10장만 버튼 아래에 낱말을 흐리게 보인다.
 * 하늘의 사건: 오늘 카드 = 복습 별(희미함) · 평가 = 그 별이 다시 켜짐(relight, 쉬움이면 반짝) · 복습 끝 = 띠가 부풀고(swellBand) 유성 하나.
 */
import { useLiveQuery } from 'dexie-react-hooks'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { useSkyEvent } from '@/fx'
import { ActiveMood as FieldMood, useActive } from '@/app/keepAlive'
import { useNow, useReview, useSubjects } from '@/db/hooks'
import { db, type Card } from '@/db/schema'
import { DAY, MIN, studyDayRange } from '@/lib/time'
import { useUi } from '@/stores/ui'
import { useEffectiveMotion, useMediaQuery } from '@/shell/hooks'
import { IconCheck, IconClose, IconPlay, IconReview, IconUndo } from '@/shell/icons'
import { tip } from '@/shell/Tip'
import { Hint } from '@/shell/Hint'
import { useHintCount } from '@/shell/hints'
import { spaceOf } from '@/shell/spaces'
import { Hero, GENTLE } from './parts'
import '@/styles/review.css'

/** 저장 값 4종(M4 FSRS: again · hard · good · easy) */
const RATINGS = [
  { k: 1, id: 'again', label: '다시', days: 1, level: 0.35 },
  { k: 2, id: 'hard', label: '어려움', days: 2, level: 0.6 },
  { k: 3, id: 'good', label: '알맞음', days: 4, level: 0.85 },
  { k: 4, id: 'easy', label: '쉬움', days: 7, level: 1 },
] as const
type Rating = (typeof RATINGS)[number]
const R = (k: 1 | 2 | 3 | 4): Rating => RATINGS[k - 1]!

const DIM = 0.3
const SKY = spaceOf('/review')

export function ReviewScreen() {
  const { now } = useNow()
  const data = useReview(now)
  const subjects = useSubjects() ?? []
  const knotRef = useRef<HTMLSpanElement>(null)
  const [session, setSession] = useState<Card[] | null>(null)
  const [levels, setLevels] = useState<Record<string, number>>({})
  const sky = useSkyEvent()
  const reviewIntent = useUi((s) => s.reviewIntent)
  const minuteKey = Math.floor(now.getTime() / MIN)
  const dueCards = useLiveQuery(() => db.cards.where('due').below(studyDayRange(now)[1]).sortBy('due'), [minuteKey])

  const subj = (id: string) => subjects.find((s) => s.id === id)
  const name = (id: string) => subj(id)?.name ?? id
  const color = (id: string) => {
    const s = subj(id)
    return s ? `var(--s-${s.color})` : 'var(--text-3)'
  }

  const skyData = { load: data ? Math.min(1, data.due / 40) : 0.3, rings: 0 }
  // 복습 별: 진행 중엔 이번 세션 카드(평가한 만큼 밝게), 아니면 오늘 남은 카드
  const starCards = session ?? dueCards ?? []
  const skyStars = { review: starCards.map((c) => ({ id: c.id, subject: c.subjectId, level: levels[c.id] ?? DIM })) }

  const start = () => {
    if (dueCards?.length) {
      setLevels({})
      setSession(dueCards)
    }
  }

  useEffect(() => {
    if (!reviewIntent || !dueCards) return
    useUi.getState().setReviewIntent(false)
    if (dueCards.length && !session) start()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewIntent, dueCards])

  const finish = () => {
    setSession(null)
    sky.swellBand()
    sky.meteor({ kind: 'signal', size: 'md' })
  }

  if (session) {
    return (
      <>
        <FieldMood preset={SKY.mood} drag={SKY.drag} knotRef={knotRef} data={skyData} stars={skyStars} />
        <ReviewSession
          cards={session}
          knotRef={knotRef}
          name={name}
          color={color}
          onRate={(card, level) => {
            setLevels((l) => ({ ...l, [card.id]: level }))
            sky.relight(card.id, level, { glint: level >= 1 })
          }}
          onExit={() => setSession(null)}
          onDone={finish}
        />
      </>
    )
  }

  const due = data?.due ?? 0
  const minutes = Math.max(1, Math.round(due * 0.6))
  return (
    <>
      <FieldMood preset={SKY.mood} drag={SKY.drag} knotRef={knotRef} data={skyData} stars={skyStars} />
      <Hero knotRef={knotRef} label="복습" className="review-hero rv-quiet">
        <h1 className="sr-only">복습</h1>
        {data && due === 0 ? (
          <p className="sr-only" role="status">
            오늘 복습 끝{data.tomorrow ? ` · 내일 ${data.tomorrow}장` : ''}
          </p>
        ) : (
          <div className="rv-head enter enter-1">
            <span className="inum rv-count" tabIndex={0} {...tip(`${due}장 · ${minutes}분`)}>
              <IconReview size={18} />
              <span>{data ? due : ''}</span>
            </span>
            <button type="button" className="gold-btn" {...tip('복습 시작', { kbd: 'Space' })} onClick={start} disabled={!dueCards?.length}>
              <IconPlay size={22} />
            </button>
          </div>
        )}
      </Hero>
    </>
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
  const [i, setI] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [fan, setFan] = useState(false)
  // 처음 10장만 버튼 아래 낱말 (공용 '처음 n번' — 설정 '처음 화면 다시 보기'로 다시 보인다)
  const { fresh: words, bump: bumpWords } = useHintCount('review-words', 10)
  const level = useEffectiveMotion()
  const hasKeyboard = useMediaQuery('(hover: hover) and (pointer: fine)')
  const card = cards[i]
  const off = level === 'off'
  const active = useActive()
  const busy = useRef(false)

  const rate = async (r: Rating) => {
    if (!card || !flipped || busy.current) return
    busy.current = true
    setFan(false)
    const t = Date.now()
    const [, b] = studyDayRange(t)
    try {
      await db.cards.update(card.id, { due: b + (r.days - 1) * DAY + 6 * 3_600_000, reps: card.reps + 1, lastReview: t, state: 'review', updatedAt: t, lapses: r.days === 1 ? card.lapses + 1 : card.lapses })
    } catch {
      /* 저장 실패해도 진행은 계속 */
    }
    bumpWords()
    onRate(card, r.level)
    busy.current = false
    if (i + 1 >= cards.length) onDone()
    else {
      setI(i + 1)
      setFlipped(false)
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!active || e.isComposing || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'Escape') {
        if (fan) setFan(false)
        else onExit()
      } else if ((e.key === ' ' || e.key === 'Enter') && !flipped) {
        e.preventDefault()
        setFlipped(true)
      } else if (flipped && ['1', '2', '3', '4'].includes(e.key)) {
        e.preventDefault()
        void rate(R(Number(e.key) as 1 | 2 | 3 | 4))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!card) return null
  return (
    <section className="hero hero-zone review-session rv-quiet" aria-label="복습 진행">
      <span className="knot-anchor" ref={knotRef} aria-hidden="true" />
      <div className="hero-col zone-a">
        <AnimatePresence mode="wait">
          <motion.div
            key={card.id + (flipped ? 'b' : 'f')}
            className={`flash${flipped ? '' : ' is-front'}`}
            role={flipped ? undefined : 'button'}
            tabIndex={flipped ? undefined : 0}
            aria-label={flipped ? undefined : '뒤집기'}
            onClick={flipped ? undefined : () => setFlipped(true)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: off ? 0 : 0.14 } }}
            transition={off ? { duration: 0 } : GENTLE}
          >
            <p className="meta flash-meta">
              <i className="sdot" style={{ ['--c' as string]: color(card.subjectId) }} {...tip(name(card.subjectId))} />
              <span className="mono">
                {i + 1} / {cards.length}
              </span>
            </p>
            <p className="flash-q">{card.front}</p>
            {flipped && <p className="flash-a">{card.back}</p>}
            {!flipped && <Hint id="H4" side="top" />}
          </motion.div>
        </AnimatePresence>
        <div className="actions rv-actions">
          {!flipped ? (
            <button type="button" className="icon-btn ghost" {...tip('그만하기', { kbd: 'esc' })} onClick={onExit}>
              <IconClose size={18} />
            </button>
          ) : (
            <div className="rv-rate" role="group" aria-label="얼마나 기억났나요">
              <div className="rv-btn">
                <button type="button" className="rv-again" {...tip('다시', { kbd: '1' })} onClick={() => void rate(R(1))}>
                  <IconUndo size={24} />
                </button>
                {words && <span className="rv-word">다시</span>}
                {hasKeyboard && <span className="rv-key mono">1</span>}
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

  // 바깥을 누르면 닫는다
  useEffect(() => {
    if (!open) return
    const off = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', off)
    return () => document.removeEventListener('pointerdown', off)
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
      {words && <span className="rv-word">알았음</span>}
      {!open && <Hint id="H5" side="top" />}
      {hasKeyboard && <span className="rv-key mono">3</span>}
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
