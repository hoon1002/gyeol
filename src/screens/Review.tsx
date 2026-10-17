/**
 * 복습 v4: 글 구역(design-m1 2-1) 안에 복습 / 13장 · 8분 / 시작 — 3줄. 카드도 같은 구역.
 * 하늘의 사건: 오늘 카드 = 복습 별(희미함) · 평가 = 그 별이 다시 켜짐(relight, 쉬움이면 반짝) ·
 * 복습 끝 = 띠가 부풀고(swellBand) 유성 하나(meteor). 도장 없음.
 * M0 덤 그대로: 간단한 진행(뒤집기 → 4단 평가 → 고정 간격). FSRS는 M2.
 */
import { useLiveQuery } from 'dexie-react-hooks'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState, type RefObject } from 'react'
import { useSkyEvent } from '@/fx'
import { ActiveMood as FieldMood, useActive } from '@/app/keepAlive'
import { useNow, useReview, useSubjects } from '@/db/hooks'
import { db, type Card } from '@/db/schema'
import { DAY, MIN, studyDayRange } from '@/lib/time'
import { useUi } from '@/stores/ui'
import { useEffectiveMotion, useMediaQuery } from '@/shell/hooks'
import { IconClose } from '@/shell/icons'
import { spaceOf } from '@/shell/spaces'
import { Actions, Block, FocusLines, Hero, PrimaryButton, GENTLE } from './parts'

const RATINGS = [
  { k: 1, label: '다시', days: 1, level: 0.35, color: 'var(--danger)' },
  { k: 2, label: '어려움', days: 2, level: 0.6, color: 'var(--warning)' },
  { k: 3, label: '좋음', days: 4, level: 0.85, color: 'var(--info)' },
  { k: 4, label: '쉬움', days: 7, level: 1, color: 'var(--success)' },
] as const

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

  const name = (id: string) => subjects.find((s) => s.id === id)?.name ?? id
  const color = (id: string) => {
    const s = subjects.find((x) => x.id === id)
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
      <Hero knotRef={knotRef} label="복습" className="review-hero">
        {data && due === 0 ? (
          <>
            <Block>
              <FocusLines lines={['복습 끝']} swapKey="done" />
            </Block>
            <Block>
              <p className="meta">내일 {data.tomorrow}장</p>
            </Block>
          </>
        ) : (
          <>
            <Block>
              <FocusLines lines={['복습']} swapKey="todo" />
            </Block>
            <Block>
              <p className="meta enter enter-1">{data ? `${due}장 · ${minutes}분` : ' '}</p>
            </Block>
            <Actions>
              <PrimaryButton onClick={start} disabled={!dueCards?.length}>
                시작
              </PrimaryButton>
            </Actions>
          </>
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
  const level = useEffectiveMotion()
  const hasKeyboard = useMediaQuery('(hover: hover) and (pointer: fine)')
  const card = cards[i]
  const off = level === 'off'
  const active = useActive()

  const rate = async (r: (typeof RATINGS)[number]) => {
    if (!card || !flipped) return
    const t = Date.now()
    const [, b] = studyDayRange(t)
    try {
      await db.cards.update(card.id, { due: b + (r.days - 1) * DAY + 6 * 3_600_000, reps: card.reps + 1, lastReview: t, state: 'review', updatedAt: t, lapses: r.days === 1 ? card.lapses + 1 : card.lapses })
    } catch {
      /* 저장 실패해도 진행은 계속 */
    }
    onRate(card, r.level)
    if (i + 1 >= cards.length) onDone()
    else {
      setI(i + 1)
      setFlipped(false)
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!active || e.target instanceof HTMLInputElement) return
      if (e.key === 'Escape') onExit()
      else if ((e.key === ' ' || e.key === 'Enter') && !flipped) {
        e.preventDefault()
        setFlipped(true)
      } else if (flipped && ['1', '2', '3', '4'].includes(e.key)) void rate(RATINGS[Number(e.key) - 1]!)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!card) return null
  return (
    <section className="hero hero-zone review-session" aria-label="복습 진행">
      <span className="knot-anchor" ref={knotRef} aria-hidden="true" />
      <div className="hero-col zone-a">
        <AnimatePresence mode="wait">
          <motion.div
            key={card.id + (flipped ? 'b' : 'f')}
            className="flash"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: off ? 0 : 0.14 } }}
            transition={off ? { duration: 0 } : GENTLE}
          >
            <p className="meta flash-meta">
              <i className="dot" style={{ background: color(card.subjectId) }} aria-hidden="true" /> {name(card.subjectId)} · {i + 1} / {cards.length}
            </p>
            <p className="flash-q">{card.front}</p>
            {flipped && <p className="flash-a">{card.back}</p>}
          </motion.div>
        </AnimatePresence>
        <div className="actions">
          {!flipped ? (
            <>
              <PrimaryButton onClick={() => setFlipped(true)} arrow={false}>뒤집기</PrimaryButton>
              <button type="button" className="icon-btn ghost" aria-label="그만하기" onClick={onExit}>
                <IconClose size={18} />
              </button>
            </>
          ) : (
            <div className="ratings" role="group" aria-label="얼마나 기억났나요">
              {RATINGS.map((r) => (
                <button key={r.k} type="button" className="rating" style={{ ['--c' as string]: r.color }} onClick={() => void rate(r)}>
                  <span>{r.label}</span>
                  {hasKeyboard && <small className="mono">{r.k}</small>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
