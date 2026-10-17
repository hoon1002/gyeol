/**
 * 시험 계획 화면 조각 (design-m4 4장 · 앱 B).
 *   <ExamSheet onClose/>   시험 넣기: ① 이름(과목 별칭이면 과목 점 자동) → ② 21일 날짜 띠 → ③ 범위 칩(과목 · 노트, ▤ 카드 수 자동) → ④ 금빛 ✓
 *   <PlanBand/>            계획 띠 위의 날 표시(막대 · 빈 고리 · 줄표 · 인주 점), x = band(d) = 0.10 + 0.80 × min(d, 14)/14. 길게 누르면 그날 쉬기
 */
import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useRef, useState } from 'react'
import { db, uid } from '@/db/schema'
import { useNotes, useSubjects } from '@/db/hooks'
import { addDay, keyOf, planRange, scopeCards, type PlanDay } from '@/memory/plan'
import { useSettings } from '@/stores/settings'
import { tip } from '@/shell/Tip'
import { announce } from '@/shell/announce'
import { pushLayer } from '@/shell/layers'
import { IconBack, IconCheck, IconNote, IconReview } from '@/shell/icons'
import { useIsPhone, useMediaQuery } from '@/shell/hooks'
import { useSkyAnchor } from '@/fx'
import { guessSubject } from './api'

const WD = ['일', '월', '화', '수', '목', '금', '토']

export function ExamSheet({ onClose }: { onClose: () => void }) {
  const subjects = useSubjects() ?? []
  const notes = useNotes() ?? []
  const cards = useLiveQuery(() => db.cards.toArray(), []) ?? []
  const land = useMediaQuery('(min-width: 600px) and (min-aspect-ratio: 1/1)')
  const [title, setTitle] = useState('')
  const [page, setPage] = useState(0)
  const [day, setDay] = useState<string | null>(null)
  const [subs, setSubs] = useState<string[]>([])
  const [touched, setTouched] = useState(false)
  const [noteIds, setNoteIds] = useState<string[]>([])
  const [find, setFind] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => pushLayer({ id: 'exam-sheet', close: () => closeRef.current(), el: ref.current }), [])
  useEffect(() => ref.current?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true }), [])

  // 이름에 과목 별칭이 있으면 과목을 자동으로 고른다(사람이 칩을 만지기 전까지)
  const auto = guessSubject(title, subjects)
  const subjectIds = touched ? subs : auto ? [auto.id] : []
  const today = keyOf(new Date())
  const days = Array.from({ length: 21 }, (_, i) => addDay(today, page * 21 + i))
  const count = useMemo(() => scopeCards({ id: '_', scope: { subjectIds, noteIds } } as never, cards).length, [cards, subjectIds, noteIds])
  const canSave = !!title.trim() && !!day
  const save = async () => {
    if (!canSave) return
    const [y, m, d] = day!.split('-').map(Number)
    const dueAt = new Date(y!, m! - 1, d!, 9, 0).getTime()
    const now = Date.now()
    await db.tasks.add({ id: uid('task-'), subjectId: subjectIds[0] ?? null, kind: 'exam', title: title.trim(), dueAt, done: 0, scope: { subjectIds, noteIds }, createdAt: now, updatedAt: now })
    announce('시험을 넣었어요')
    onClose()
  }
  const hits = find !== null ? notes.filter((n) => !noteIds.includes(n.id) && n.title.toLowerCase().includes(find.toLowerCase())).slice(0, 6) : []

  return (
    <div className={`exam-layer ${land ? 'is-land' : 'is-sheet'}`}>
      <div className="exam-catch" onClick={onClose} />
      <div ref={ref} className="exam-sheet" role="dialog" aria-label="시험 넣기">
        <input className="tt-in exam-name" aria-label="시험 이름" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void save() }} autoComplete="off" />
        <div className="exam-days" role="radiogroup" aria-label="시험 날짜">
          <button type="button" className="ibtn" disabled={page === 0} {...tip('앞 3주')} onClick={() => setPage((p) => Math.max(0, p - 1))}><IconBack size={18} /></button>
          <div className="exam-grid">
            {days.map((k) => {
              const [, , dd] = k.split('-')
              return (
                <button key={k} type="button" role="radio" aria-checked={day === k} aria-label={`${k} ${WD[new Date(+k.slice(0, 4), +k.slice(5, 7) - 1, +dd!).getDay()]}요일`} className={`exam-day${day === k ? ' is-on' : ''}`} onClick={() => setDay(k)}>
                  <small aria-hidden="true">{WD[new Date(+k.slice(0, 4), +k.slice(5, 7) - 1, +dd!).getDay()]}</small>
                  <span className="mono">{+dd!}</span>
                </button>
              )
            })}
          </div>
          <button type="button" className="ibtn" {...tip('뒤 3주')} onClick={() => setPage((p) => p + 1)}><IconBack size={18} style={{ rotate: '180deg' }} /></button>
        </div>
        <div className="exam-scope">
          {subjects.map((s) => {
            const on = subjectIds.includes(s.id)
            return (
              <button key={s.id} type="button" className={`tt-chip${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => { setTouched(true); setSubs(on ? subjectIds.filter((x) => x !== s.id) : [...subjectIds, s.id]) }}>
                <i style={{ background: `var(--s-${s.color})` }} />{s.short || s.name}
              </button>
            )
          })}
          {noteIds.map((id) => {
            const n = notes.find((x) => x.id === id)
            return (
              <button key={id} type="button" className="tt-chip is-on" {...tip('빼기')} onClick={() => setNoteIds(noteIds.filter((x) => x !== id))}>
                <IconNote size={14} />{n?.title ?? id}
              </button>
            )
          })}
          <button type="button" className="ibtn" aria-pressed={find !== null} {...tip('노트 고르기')} onClick={() => setFind(find === null ? '' : null)}><IconNote size={18} /></button>
          <span className="inum" aria-label={`범위 카드 ${count}장`}><IconReview size={16} />{count}</span>
        </div>
        {find !== null && (
          <div className="exam-find">
            <input className="tt-in" aria-label="노트 찾기" value={find} onChange={(e) => setFind(e.target.value)} autoComplete="off" />
            {hits.map((n) => (
              <button key={n.id} type="button" className="plan-menu-item" onClick={() => { setNoteIds([...noteIds, n.id]); setFind('') }}>{n.title}</button>
            ))}
          </div>
        )}
        <div className="bk-acts">
          <button type="button" className="gold-btn" {...tip('넣기')} disabled={!canSave} onClick={() => void save()}><IconCheck size={22} /></button>
        </div>
      </div>
    </div>
  )
}

/** 계획 띠 위 날 표시 (오늘부터 14일 + 그 너머 시험) */
export function PlanBand() {
  const restDays = useSettings((s) => s.restDays)
  const restDates = useSettings((s) => s.restDates)
  const maxPerDay = useSettings((s) => s.maxPerDay)
  const toggle = useSettings((s) => s.toggleRestDate)
  const phone = useIsPhone()
  const [plan, setPlan] = useState<PlanDay[] | null>(null)
  const exams = useLiveQuery(() => db.tasks.where('kind').equals('exam').filter((t) => !t.done).toArray(), [])
  const cardsN = useLiveQuery(() => db.cards.count(), [])
  const logsN = useLiveQuery(() => db.reviewLogs.count(), [])
  const timer = useRef(0)
  // 하늘의 계획 띠 자리(CSS px): 날 표시의 y와 x 범위를 그 띠에 맞춘다(없으면 band(d) 어림)
  const [anchor, setAnchor] = useState<{ y: number; x0: number; x1: number } | null>(null)
  useSkyAnchor('plan-band', (a) => {
    if (!a.visible || a.x0 === undefined || a.x1 === undefined) return
    const n = { y: Math.round(a.y), x0: Math.round(a.x0), x1: Math.round(a.x1) }
    setAnchor((o) => (o && o.y === n.y && o.x0 === n.x0 && o.x1 === n.x1 ? o : n))
  })
  useEffect(() => {
    let alive = true
    const now = new Date()
    // 계산 중에는 이전 막대를 그대로 둔다(불러오는 표시 없음)
    void planRange(now, new Date(now.getTime() + 14 * 86_400_000)).then((p) => alive && setPlan(p))
    return () => {
      alive = false
    }
  }, [restDays, restDates, maxPerDay, exams, cardsN, logsN])
  if (!plan || !exams?.length) return null
  const max = Math.max(1, ...plan.map((d) => d.cards))
  const today = keyOf(new Date())
  const far = exams.filter((e) => keyOf(new Date(e.dueAt)) > addDay(today, 14))
  return (
    <div className="plan-band" aria-label="시험 계획" style={anchor ? { top: `${anchor.y - 34}px` } : undefined}>
      {plan.map((d, i) => {
        const f = Math.min(i, 14) / 14
        // x = band(d) (하늘과 같은 식). 띠(anchor x0–x1)는 화면 밖까지 이어지므로 x에는 쓰지 않고 y만 맞춘다
        const x = `calc((0.10 + 0.80 * ${f}) * 100vw - var(--chrome-left))`
        const label = d.kind === 'rest' ? `${d.day} 쉬는 날` : d.kind === 'slack' ? `${d.day} 여유` : d.kind === 'exam' ? `${d.day} 시험` : `▤ ${d.cards}${d.recall ? ` · ✎ ${d.recall}` : ''}`
        const canRest = d.kind !== 'exam' && d.kind !== 'slack'
        return (
          <button
            key={d.day}
            type="button"
            className={`pb-day is-${d.kind}${d.day === today ? ' is-today' : ''}`}
            style={{ left: x, ['--h' as string]: `${Math.max(4, Math.round((d.cards / max) * (phone ? 22 : 28)))}px` }}
            data-radial=""
            {...tip(label)}
            onPointerDown={() => {
              if (!canRest) return
              timer.current = window.setTimeout(() => {
                timer.current = -1
                toggle(d.day)
                announce(restDates.includes(d.day) ? '공부 날' : '쉬는 날')
              }, 500)
            }}
            onPointerUp={() => clearTimeout(timer.current)}
            onPointerLeave={() => clearTimeout(timer.current)}
            onContextMenu={(e) => e.preventDefault()}
          >
            <i aria-hidden="true" />
          </button>
        )
      })}
      {far.length > 0 && <span className="pb-day is-exam is-far" style={{ left: 'calc(0.90 * 100vw - var(--chrome-left))' }} {...tip(far[0]!.title)}><i aria-hidden="true" />›</span>}
    </div>
  )
}
