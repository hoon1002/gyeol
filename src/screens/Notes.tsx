/**
 * 노트 (design-m1 2-1 → design-m2 3·5·6장): 노트 / 38개 · 물리 12 / [새 노트] + 찾기 칸 + 오늘 수업 노트 + 목록,
 * 고른 노트는 종이(편집기). 가로 = 목록 열(글 구역 첫째) + 종이(둘째), 세로·폰 = 한 칸에서 목록 ↔ 종이(‹ 노트).
 * 편집기는 노트를 열 때 동적 import(첫 화면 번들 밖). 하늘: 노트 별 데이터(책등 위 점), 찾는 동안 glintNotes.
 */
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ActiveMood as FieldMood, useActive } from '@/app/keepAlive'
import { useSkyEvent } from '@/fx'
import { useNotes, useNow, usePlanner, useSubjects } from '@/db/hooks'
import { db, type CourseSlot, type Note, type Subject } from '@/db/schema'
import { classKeyFor, createNote, findNoteByClassKey, openOrCreateNote, useNoteStars, useSkySubjects } from '@/db/notes'
import { isIndexReady, searchAll, useSearchVersion, type Hit } from '@/search'
import { matchText } from '@/lib/hangul'
import { fmtAgo, hm, studyDayStart } from '@/lib/time'
import { useSettings } from '@/stores/settings'
import { useUi } from '@/stores/ui'
import { useMediaQuery, isTypingTarget } from '@/shell/hooks'
import { spaceOf } from '@/shell/spaces'
import { NotesMapToggle } from './Map'
import { Actions, Block, EmptyState, FocusLines, Hero, PrimaryButton } from './parts'

const NotePaper = lazy(() => import('@/editor/NotePaper'))

const KIND_NAME = { ink: '필기', doc: '문서', pdf: 'PDF', deck: '카드 덱' } as const
const SKY = spaceOf('/notes')
const LIST_MAX = 80

export function NotesScreen() {
  const notes = useNotes()
  const subjects = useSubjects() ?? []
  const lens = useSettings((s) => s.lens)
  const setLens = useSettings((s) => s.setLens)
  const focusId = useUi((s) => s.noteFocusId)
  const setFocus = useUi((s) => s.setNoteFocusId)
  const active = useActive()
  const land = useMediaQuery('(min-width: 600px) and (min-aspect-ratio: 1/1)')
  const { now, forceEmpty } = useNow()
  const planner = usePlanner()
  const sky = useSkyEvent()
  const stars = useNoteStars()
  const skySubjects = useSkySubjects(subjects)
  const [q, setQ] = useState('')
  const [titleFor, setTitleFor] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const ever = useRef(false)
  if (active) ever.current = true

  // 다른 화면으로 나가면 '이 노트로' 초점은 풀린다
  const clearFocus = () => useUi.getState().setNoteFocusId(null)

  const alive = notes ?? []
  const list = alive.filter((n) => !lens || n.subjectId === lens)
  const subj = (id: string | null | undefined): Subject | undefined => subjects.find((s) => s.id === id)
  const lensSubject = subj(lens)
  const today = useTodayClass(now, forceEmpty)

  // ----- 찾기 -----
  const ver = useSearchVersion()
  const hits = useMemo<Hit[] | null>(() => {
    const t = q.trim()
    if (!t) return null
    if (isIndexReady()) return searchAll(t, { kinds: ['note'], limit: 300 })
    return alive
      .map((n) => ({ n, m: matchText(n.title, t) }))
      .filter((x) => x.m.score > 0)
      .map(({ n, m }) => ({ kind: 'note' as const, id: n.id, title: n.title, subjectId: n.subjectId, updatedAt: n.updatedAt, score: m.score, field: 'title' as const, titleRange: m.range, snippet: null }))
  }, [q, ver, alive])
  const byId = useMemo(() => new Map(alive.map((n) => [n.id, n])), [alive])
  const rows: Array<{ n: Note; hit?: Hit }> = hits
    ? hits.map((h) => ({ n: byId.get(h.id)!, hit: h })).filter((r) => r.n && (!lens || r.n.subjectId === lens))
    : list.filter((n) => n.id !== today?.note?.id).map((n) => ({ n }))

  // 지도 별 반짝: 입력이 150ms 쉬면 결과 별, 지우거나 떠나면 원래대로
  const glinting = useRef(false)
  const hitKey = hits ? hits.slice(0, 60).map((h) => h.id).join(',') : ''
  useEffect(() => {
    if (!active || !hitKey) {
      if (glinting.current) sky.glintNotes([])
      glinting.current = false
      return
    }
    const t = window.setTimeout(() => {
      sky.glintNotes(hitKey.split(','))
      glinting.current = true
    }, 150)
    return () => window.clearTimeout(t)
  }, [hitKey, active, sky])
  useEffect(() => {
    if (!active) setQ('')
  }, [active])

  // ⌘F · '/'(입력 중이 아닐 때) → 찾기 칸
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return
      const mod = e.metaKey || e.ctrlKey
      if ((mod && !e.altKey && !e.shiftKey && (e.key === 'f' || e.key === 'F')) || (e.key === '/' && !mod && !e.altKey && !isTypingTarget(e.target))) {
        if (useUi.getState().paletteOpen || useUi.getState().settingsOpen) return
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active])

  // ----- 고른 노트: 가로는 없으면 맨 위, 세로·폰은 누른 것만 -----
  const focus: Note | undefined = (focusId ? byId.get(focusId) : undefined) ?? (land ? (today?.note ?? list[0]) : undefined)
  const open = (id: string) => {
    setFocus(id)
    setQ('')
  }
  const newNote = async () => {
    const n = await createNote({ subjectId: lens ?? null })
    setTitleFor(n.id)
    open(n.id)
  }
  const openToday = async () => {
    if (!today) return
    const r = await openOrCreateNote({ classKey: today.key, subjectId: today.slot.subjectId, template: 'class' })
    open(r.note.id)
  }
  const roomOf = (n: Note): string | null => {
    if (n.template !== 'class' || !n.classKey || !planner) return null
    const [sid, day] = n.classKey.split('|')
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day ?? '')
    if (!sid || !m) return null
    const wd = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getDay()
    return planner.slots.find((s) => s.subjectId === sid && s.weekday === wd)?.room || null
  }

  // 머리 메타: 38개 · 물리 12 (렌즈가 켜져 있으면 그 과목 수만)
  const topSubject = (() => {
    const m = new Map<string, number>()
    list.forEach((n) => n.subjectId && m.set(n.subjectId, (m.get(n.subjectId) ?? 0) + 1))
    const best = [...m.entries()].sort((a, b) => b[1] - a[1])[0]
    return best ? { s: subj(best[0]), n: best[1] } : null
  })()
  const meta = lensSubject ? `${lensSubject.name} ${list.length}` : `${list.length}개${topSubject?.s ? ` · ${topSubject.s.short} ${topSubject.n}` : ''}`

  const skyStars = useMemo(() => (stars ? { notes: stars.notes, noteLinks: stars.noteLinks, subjects: skySubjects } : undefined), [stars, skySubjects])
  const mood = <FieldMood preset={SKY.mood} drag={SKY.drag} onLeave={clearFocus} stars={skyStars} />

  const paper = focus ? (
    <PaperSlot
      key={focus.id}
      note={focus}
      notes={alive}
      subjects={subjects}
      room={roomOf(focus)}
      active={active}
      load={ever.current}
      focusTitle={titleFor === focus.id}
      onOpenNote={open}
      onBack={land ? undefined : () => setFocus(null)}
      onDeleted={() => setFocus(null)}
    />
  ) : null

  // 세로·폰에서 노트를 열면 한 칸 전체가 종이
  if (!land && focus) {
    return (
      <>
        {mood}
        <Hero label="노트" className="notes-hero is-reading">
          {paper}
        </Hero>
      </>
    )
  }

  if (notes && !alive.length) {
    return (
      <>
        {mood}
        <Hero label="노트" className="notes-hero">
          <NotesMapToggle on="notes" />
          <EmptyState lines={lensSubject ? [lensSubject.name, '노트 없음'] : ['노트', '비어 있음']} action="새 노트" onAction={() => void newNote()} />
          {today && <TodayClassRow today={today} onOpen={() => void openToday()} />}
        </Hero>
      </>
    )
  }

  return (
    <>
      {mood}
      {/* 글 구역: 가로 = 목록 열(왼쪽) + 종이(가운데), 세로·폰 = 한 단. 오른쪽 세로 띠(책등)는 비운다 */}
      <Hero label="노트" className="notes-hero">
        <NotesMapToggle on="notes" />
        <Block>
          <FocusLines lines={['노트']} />
        </Block>
        <Block>
          <p className="meta enter enter-1">{meta}</p>
        </Block>
        <Actions>
          <PrimaryButton onClick={() => void newNote()}>새 노트</PrimaryButton>
        </Actions>
        <div className="notes-find enter enter-2">
          <input
            ref={searchRef}
            className="notes-find-in"
            type="text"
            role="searchbox"
            inputMode="search"
            enterKeyHint="search"
            placeholder="찾기"
            aria-label="노트 찾기"
            value={q}
            spellCheck={false}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.keyCode === 229) return
              if (e.key === 'Escape') {
                e.preventDefault()
                if (q) setQ('')
                else e.currentTarget.blur()
              } else if (e.key === 'Enter' && rows[0]) {
                e.preventDefault()
                open(rows[0].n.id)
              }
            }}
          />
          {q && <span className="notes-find-n" aria-live="polite">{rows.length}</span>}
        </div>
        {lensSubject && !q && (
          <button type="button" className="notes-lens-off" onClick={() => setLens(null)}>
            <i style={{ background: `var(--s-${lensSubject.color})` }} aria-hidden="true" />
            {lensSubject.short} · 전체 보기
          </button>
        )}
        <ul className="recent notes-list enter enter-2" aria-label={q ? '찾은 노트' : '노트 목록'}>
          {!q && today && (
            <li className="notes-today">
              <TodayClassRow today={today} current={focus?.id} onOpen={() => void openToday()} />
            </li>
          )}
          {rows.slice(0, LIST_MAX).map(({ n, hit }) => {
            const s = subj(n.subjectId)
            const on = n.id === focus?.id
            return (
              <li key={n.id}>
                <button type="button" aria-current={on || undefined} className={on ? 'is-on' : undefined} onClick={() => open(n.id)}>
                  <span>{hit?.titleRange ? <Mark text={n.title || '제목 없음'} range={hit.titleRange} /> : n.title || '제목 없음'}</span>
                  {hit?.snippet ? (
                    <small className="notes-snip">
                      <Mark text={hit.snippet.text} range={hit.snippet.range} />
                    </small>
                  ) : (
                    <small>
                      {s && <i style={{ background: `var(--s-${s.color})` }} aria-hidden="true" />}
                      {KIND_NAME[n.kind]} · {fmtAgo(Date.now(), n.updatedAt)}
                    </small>
                  )}
                </button>
              </li>
            )
          })}
          {q && !rows.length && <li className="notes-none">결과 없음</li>}
        </ul>
      </Hero>

      {/* 가로: 고른 노트의 종이(글 구역 둘째 사각형) */}
      {land && paper && <div className="note-stage zone-b">{paper}</div>}
    </>
  )
}

function Mark({ text, range }: { text: string; range: [number, number] }) {
  const a = Array.from(text)
  return (
    <>
      {a.slice(0, range[0]).join('')}
      <mark>{a.slice(range[0], range[1]).join('')}</mark>
      {a.slice(range[1]).join('')}
    </>
  )
}

/* ---------- 종이 자리: doc = 편집기(지연 로드), 필기·PDF·덱 = 미리보기 ---------- */

function PaperSlot(props: {
  note: Note
  notes: Note[]
  subjects: Subject[]
  room: string | null
  active: boolean
  load: boolean
  focusTitle: boolean
  onOpenNote: (id: string) => void
  onBack?: () => void
  onDeleted: () => void
}) {
  const { note } = props
  if (note.kind !== 'doc') {
    const s = props.subjects.find((x) => x.id === note.subjectId)
    return (
      <div className="np np-other" style={{ ['--c' as string]: s ? `var(--s-${s.color})` : 'var(--text-3)' }}>
        <div className="np-skel">
          {props.onBack && (
            <button type="button" className="np-back" onClick={props.onBack}>
              ‹ 노트
            </button>
          )}
          <p className="np-o-t">{note.title}</p>
          <p className="np-o-m">
            {s?.name ?? '과목 없음'} · {KIND_NAME[note.kind]}
            {note.kind === 'pdf' && note.pages ? ` · p.${note.page ?? 1} / ${note.pages}` : ''}
          </p>
          {note.excerpt && <p className="np-o-x">{note.excerpt}</p>}
          <p className="np-o-x">필기 · PDF 편집은 M5</p>
        </div>
      </div>
    )
  }
  if (!props.load) return <PaperFallback />
  return (
    <Suspense fallback={<PaperFallback />}>
      <NotePaper {...props} />
    </Suspense>
  )
}

function PaperFallback() {
  return (
    <div className="np" aria-hidden="true">
      <div className="np-skel">
        <div className="np-skel-t" />
        <div className="np-skel-m" />
        <div className="np-skel-l" />
        <div className="np-skel-l" style={{ width: '82%' }} />
        <div className="np-skel-l" style={{ width: '64%' }} />
      </div>
    </div>
  )
}

/* ---------- 오늘 수업 노트 (design-m2 6-3) ---------- */

interface TodayClass {
  slot: CourseSlot
  subject: Subject | undefined
  key: string
  note: Note | undefined
}

/** 오늘(학습일) 수업 중 지금 · 다음 수업 하나, 끝났으면 마지막 수업 */
function useTodayClass(now: Date, forceEmpty: boolean): TodayClass | null | undefined {
  const minuteKey = Math.floor(now.getTime() / 60_000)
  return useLiveQuery(async () => {
    if (forceEmpty) return null
    const sd = studyDayStart(now)
    const slots = (await db.courseSlots.where('weekday').equals(sd.getDay()).toArray()).sort((a, b) => hm(a.start) - hm(b.start))
    if (!slots.length) return null
    const nowMin = Math.floor((now.getTime() - sd.getTime()) / 60_000)
    const slot = slots.find((s) => hm(s.start) <= nowMin && nowMin < hm(s.end)) ?? slots.find((s) => hm(s.start) > nowMin) ?? slots[slots.length - 1]!
    const key = classKeyFor(slot.subjectId, now)
    const [subject, note] = await Promise.all([db.subjects.get(slot.subjectId), findNoteByClassKey(key)])
    return { slot, subject, key, note }
  }, [minuteKey, forceEmpty])
}

function TodayClassRow({ today, current, onOpen }: { today: TodayClass; current?: string; onOpen: () => void }) {
  const s = today.subject
  const name = s?.short ?? s?.name ?? '수업'
  if (today.note) {
    const on = today.note.id === current
    return (
      <button type="button" aria-current={on || undefined} className={`notes-today-row${on ? ' is-on' : ''}`} onClick={onOpen}>
        <span>{today.note.title || `오늘 ${name} 수업 노트`}</span>
        <small>
          {s && <i style={{ background: `var(--s-${s.color})` }} aria-hidden="true" />}
          오늘
        </small>
      </button>
    )
  }
  return (
    <button type="button" className="notes-today-row is-new" onClick={onOpen}>
      <span>오늘 {name} 수업 노트</span>
      <small className="mono">{today.slot.start}</small>
    </button>
  )
}
