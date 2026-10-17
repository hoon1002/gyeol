/**
 * 노트 (design-m2 3·5·6장 → design-quiet 1-5): 앱의 말 없이 [⌕ 찾기 칸 · 금빛 ＋] + 오늘 수업 노트 + 목록(종류 아이콘 · 과목 점 · 제목).
 * 시간 · 개수 · 이름은 툴팁(길게)으로. 고른 노트는 종이(편집기). 가로 = 목록 열(글 구역 첫째) + 종이(둘째),
 * 세로·폰 = 한 칸에서 목록 ↔ 종이(‹). 편집기는 노트를 열 때 동적 import(첫 화면 번들 밖).
 * 하늘: 노트 별 데이터(책등 위 점), 찾는 동안 glintNotes.
 */
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { ActiveMood as FieldMood, useActive } from '@/app/keepAlive'
import { useSkyEvent } from '@/fx'
import { useNotes, useNow, usePlanner, useSubjects } from '@/db/hooks'
import { db, type CourseSlot, type Note, type PageTemplate, type Subject } from '@/db/schema'
import { classKeyFor, createNote, findNoteByClassKey, openOrCreateNote, useNoteStars, useSkySubjects } from '@/db/notes'
import { isIndexReady, searchAll, useSearchVersion, type Hit } from '@/search'
import { matchText } from '@/lib/hangul'
import { fmtAgo, fmtMD, hm, studyDayStart } from '@/lib/time'
import { useSettings } from '@/stores/settings'
import { useUi } from '@/stores/ui'
import { useMediaQuery } from '@/shell/hooks'
import { spaceOf } from '@/shell/spaces'
import { tip } from '@/shell/Tip'
import { IconBack, IconDeck, IconDoc, IconPdf, IconPen, IconPlus, IconSearch } from '@/shell/icons'
import { Backlinks } from '@/editor/Backlinks'
import { pickPdf, setPendingPdf } from '@/editor/inkState'
import { closeRecall, openRecall, recallReady, useRecallId } from '@/editor/recallState'
import { useNoteMemory, withBright } from '@/memory/brightness'
import { pushLayer } from '@/shell/layers'
import { NotesMapToggle } from './Map'
import { Hero } from './parts'
import { isTyping, screenKey } from './keyScope'

const NotePaper = lazy(() => import('@/editor/NotePaper'))
/** 필기 · PDF 노트의 종이 펼치기(잉크 엔진과 함께 지연 로드) */
const InkSheet = lazy(() => import('@/editor/InkSheet'))
const Recall = lazy(() => import('@/editor/Recall'))

const isPaperKind = (n: Pick<Note, 'kind'> | undefined) => n?.kind === 'ink' || n?.kind === 'pdf'
const centerOf = (el: Element | null | undefined) => {
  const r = el?.getBoundingClientRect()
  return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null
}

const KIND_NAME = { ink: '필기', doc: '문서', pdf: 'PDF', deck: '카드 덱' } as const
const KIND_ICON = { ink: IconPen, doc: IconDoc, pdf: IconPdf, deck: IconDeck } as const

/** 제목이 없으면 날짜(design-quiet: '제목 없음' → 10.17) */
export const noteName = (n: Pick<Note, 'title' | 'createdAt'>) => n.title.trim() || fmtMD(n.createdAt)

/** 종류 아이콘 12px + 과목 점 (목록 줄 머리) */
function RowMark({ n, s }: { n: Note; s: Subject | undefined }) {
  const K = KIND_ICON[n.kind]
  return (
    <span className="nl-mark" aria-hidden="true">
      <K size={13} />
      <i className={`sdot${s ? '' : ' is-none'}`} style={s ? { ['--c' as string]: `var(--s-${s.color})` } : undefined} />
    </span>
  )
}
const SKY = spaceOf('/notes')
const LIST_MAX = 80

export function NotesScreen() {
  const notes = useNotes()
  const subjects = useSubjects() ?? []
  const lens = useSettings((s) => s.lens)
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

  // 다른 화면으로 나가면 '이 노트로' 초점은 풀린다. 활성 → 비활성으로 바뀔 때만 푼다.
  // (ActiveMood onLeave는 도착할 때 Leave가 새로 마운트되며 StrictMode 개발 모드의 effect 두 번 실행으로 cleanup이 불려,
  //  지도 별 [열기] · ⌘K · 집중 별 '노트 열기'가 넘겨 준 초점을 도착하자마자 지웠다)
  const wasActive = useRef(active)
  useEffect(() => {
    if (wasActive.current && !active) useUi.getState().setNoteFocusId(null)
    wasActive.current = active
  }, [active])

  const alive = notes ?? []
  const list = alive.filter((n) => !lens || n.subjectId === lens)
  const subj = (id: string | null | undefined): Subject | undefined => subjects.find((s) => s.id === id)
  const today = useTodayClass(now, forceEmpty)
  // 필기 노트 첫 쪽 썸네일(종이를 닫을 때 · 쓰고 쉴 때 잉크 엔진이 찍어 둔 것)
  const thumbs = useLiveQuery(async () => {
    const rows = await db.meta.where('key').startsWith('ink.thumb.').toArray()
    return new Map(rows.map((r) => [r.key.slice('ink.thumb.'.length), (r.value as { url?: string } | undefined)?.url ?? '']))
  }, [])

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
      const mod = e.metaKey || e.ctrlKey
      // ⌘F는 노트 화면 안이면 글을 쓰는 중에도, '/'는 글을 쓰지 않을 때만. 떠 있는 층 · 화면 밖 포커스면 무시(QA #1)
      const cmdF = mod && !e.altKey && !e.shiftKey && (e.key === 'f' || e.key === 'F') && screenKey(e, '/notes', { typing: true })
      const slash = e.key === '/' && !mod && !e.altKey && screenKey(e, '/notes')
      if (cmdF || slash) {
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active])

  // 세로·폰에서 노트를 읽는 중 Esc: 글을 쓰는 중이면 먼저 손을 떼고(blur), 한 번 더 누르면 목록으로
  useEffect(() => {
    if (!active || land || !focusId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !screenKey(e, '/notes', { typing: true })) return
      // 편집기 안: ProseMirror가 Esc를 늘 막으므로 defaultPrevented 대신 '제안 상자를 닫았나'만 본다
      if (isTyping(e.target)) {
        if (!(e as KeyboardEvent & { gyeolHandled?: boolean }).gyeolHandled) (e.target as HTMLElement).blur()
        return
      }
      if (e.defaultPrevented) return
      e.preventDefault()
      setFocus(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, land, focusId, setFocus])

  // ----- 고른 노트: 가로는 없으면 맨 위, 세로·폰은 누른 것만 -----
  const focus: Note | undefined = (focusId ? byId.get(focusId) : undefined) ?? (land ? (today?.note ?? list[0]) : undefined)

  // ----- 종이 펼치기(필기 · PDF 노트) -----
  const [ink, setInk] = useState<{ note: Note; template: PageTemplate; origin: { x: number; y: number } | null } | null>(null)
  const openPaper = (n: Note, o: { template?: PageTemplate; from?: Element | null } = {}) => {
    setInk({ note: n, template: o.template ?? 'ruled', origin: centerOf(o.from) })
  }
  const closePaper = () => {
    setInk(null)
    if (!land) setFocus(null)
  }
  // 밖(⌘K · 지도 별 · 별가루)에서 필기 노트에 초점을 주면 펼친다 — 새로 만든 노트는 목록에 들어온 뒤에
  // ⌥R = 떠올리기 (보고 있는 노트)
  const recallFor = focus?.id ?? null
  useEffect(() => {
    if (!active || !recallFor) return
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && !e.metaKey && !e.ctrlKey && e.code === 'KeyR' && screenKey(e, '/notes', { typing: true })) {
        e.preventDefault()
        void recallReady(recallFor).then((ok) => ok && openRecall(recallFor))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, recallFor])
  const pendingFocus = useRef<string | null>(focusId)
  useEffect(() => {
    pendingFocus.current = focusId
  }, [focusId])
  useEffect(() => {
    const id = pendingFocus.current
    if (!id || !active) return
    const n = byId.get(id)
    if (!n) return
    pendingFocus.current = null
    if (isPaperKind(n) && ink?.note.id !== id) openPaper(n)
  })
  useEffect(() => {
    if (!active) setInk(null)
  }, [active])
  const inkNote = ink ? (byId.get(ink.note.id) ?? ink.note) : null

  const open = (id: string, from?: Element | null) => {
    pendingFocus.current = null
    setFocus(id)
    setQ('')
    const n = byId.get(id)
    if (n && isPaperKind(n)) openPaper(n, { from })
  }
  /** 입력한 손이 정한다(design-ink 1-1 · 리더 결정 4): 펜 = 필기(빈 쪽 · 줄), 손가락 · 마우스 · 키보드 = 글 */
  const newNote = async (hand: 'doc' | 'ink' = 'doc', from?: Element | null) => {
    if (hand === 'ink') {
      const n = await createNote({ kind: 'ink', subjectId: lens ?? null })
      pendingFocus.current = null
      setFocus(n.id)
      openPaper(n, { from })
      return
    }
    const n = await createNote({ subjectId: lens ?? null })
    setTitleFor(n.id)
    open(n.id)
  }
  const importPdf = async () => {
    const f = await pickPdf()
    if (!f) return
    const n = await createNote({ kind: 'pdf', title: f.name.replace(/\.pdf$/i, ''), subjectId: lens ?? null })
    setPendingPdf(n.id, f)
    pendingFocus.current = null
    setFocus(n.id)
    openPaper(n, { template: 'blank' })
  }
  /** 오늘 수업 노트: 펜으로 누르면 코넬 틀 필기 노트(design-ink 1-1) */
  const openToday = async (pen = false, from?: Element | null) => {
    if (!today) return
    const r = await openOrCreateNote({ classKey: today.key, subjectId: today.slot.subjectId, ...(pen ? { kind: 'ink' as const, pageTemplate: 'cornell' as const } : { template: 'class' as const }) })
    pendingFocus.current = null
    setFocus(r.note.id)
    setQ('')
    if (isPaperKind(r.note)) openPaper(r.note, { template: 'cornell', from })
  }
  const roomOf = (n: Note): string | null => {
    if (n.template !== 'class' || !n.classKey || !planner) return null
    const [sid, day] = n.classKey.split('|')
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day ?? '')
    if (!sid || !m) return null
    const wd = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getDay()
    return planner.slots.find((s) => s.subjectId === sid && s.weekday === wd)?.room || null
  }

  const memory = useNoteMemory()
  const skyStars = useMemo(() => (stars ? { notes: withBright(stars.notes, memory), noteLinks: stars.noteLinks, subjects: skySubjects } : undefined), [stars, skySubjects, memory])
  const recallId = useRecallId()
  const recall =
    recallId && active
      ? createPortal(
          <Suspense fallback={null}>
            <Recall key={recallId} noteId={recallId} onClose={closeRecall} />
          </Suspense>,
          document.body,
        )
      : null
  const sheet =
    inkNote && active
      ? createPortal(
          <Suspense fallback={null}>
            <InkSheet key={inkNote.id} note={inkNote} template={ink!.template} origin={ink!.origin} active={active} onClose={closePaper} />
          </Suspense>,
          document.body,
        )
      : null
  const mood = (
    <>
      <FieldMood preset={SKY.mood} drag={SKY.drag} stars={skyStars} />
      {sheet}
      {recall}
    </>
  )

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
      thumb={thumbs?.get(focus.id)}
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

  // 머리: [⌕ 찾기 칸 · 금빛 ＋] 한 줄. 노트가 없으면 금빛 ＋만
  const head = (
    <div className="notes-top enter enter-1">
      {alive.length > 0 && (
        <label className="notes-find">
          <IconSearch size={16} />
          <input
            ref={searchRef}
            className="notes-find-in"
            type="text"
            role="searchbox"
            inputMode="search"
            enterKeyHint="search"
            aria-label="노트 찾기"
            data-tip={`찾기 · ${list.length}`}
            data-tip-kbd="⌘F"
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
          {q && (
            <span className="notes-find-n mono" aria-live="polite" aria-label={`찾은 노트 ${rows.length}개`}>
              {rows.length}
            </span>
          )}
        </label>
      )}
      <NewNoteButton onDoc={() => void newNote('doc')} onInk={(el) => void newNote('ink', el)} onPdf={() => void importPdf()} />
    </div>
  )

  if (notes && !alive.length) {
    return (
      <>
        {mood}
        <Hero label="노트" className="notes-hero">
          <h1 className="sr-only">노트</h1>
          <NotesMapToggle on="notes" />
          {head}
          {today && (
            <ul className="recent notes-list">
              <li className="notes-today">
                <TodayClassRow today={today} onOpen={(pen, el) => void openToday(pen, el)} />
              </li>
            </ul>
          )}
        </Hero>
      </>
    )
  }

  return (
    <>
      {mood}
      {/* 글 구역: 가로 = 목록 열(왼쪽) + 종이(가운데), 세로·폰 = 한 단. 오른쪽 세로 띠(책등)는 비운다 */}
      <Hero label="노트" className="notes-hero">
        <h1 className="sr-only">노트</h1>
        <NotesMapToggle on="notes" />
        {head}
        <ul className="recent notes-list enter enter-2" aria-label={q ? '찾은 노트' : '노트 목록'}>
          {!q && today && (
            <li className="notes-today">
              <TodayClassRow today={today} current={focus?.id} onOpen={(pen, el) => void openToday(pen, el)} />
            </li>
          )}
          {rows.slice(0, LIST_MAX).map(({ n, hit }) => {
            const s = subj(n.subjectId)
            const on = n.id === focus?.id
            const name = noteName(n)
            return (
              <li key={n.id}>
                <button
                  type="button"
                  aria-current={on || undefined}
                  className={on ? 'is-on' : undefined}
                  data-tip={`${KIND_NAME[n.kind]} · ${fmtAgo(Date.now(), n.updatedAt)}`}
                  onClick={(e) => open(n.id, e.currentTarget)}
                >
                  <span className="nl-line">
                    <RowMark n={n} s={s} />
                    <span className="nl-t">{hit?.titleRange && n.title.trim() ? <Mark text={name} range={hit.titleRange} /> : name}</span>
                    {thumbs?.get(n.id) && <img className="nl-thumb" src={thumbs.get(n.id)} alt="" aria-hidden="true" />}
                  </span>
                  {hit?.snippet && (
                    <small className="notes-snip">
                      <Mark text={hit.snippet.text} range={hit.snippet.range} />
                    </small>
                  )}
                </button>
              </li>
            )
          })}
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
  onOpenNote: (id: string, from?: Element | null) => void
  onBack?: () => void
  onDeleted: () => void
  thumb?: string
}) {
  const { note } = props
  if (note.kind !== 'doc') {
    const s = props.subjects.find((x) => x.id === note.subjectId)
    return (
      <div className="np np-other" style={{ ['--c' as string]: s ? `var(--s-${s.color})` : 'var(--text-3)' }}>
        <div className="np-skel">
          {props.onBack && (
            <button type="button" className="ibtn np-back" {...tip('노트 목록', { kbd: 'esc' })} onClick={props.onBack}>
              <IconBack size={20} />
            </button>
          )}
          <p className="np-o-t">{noteName(note)}</p>
          <p className="np-o-m">
            <i className={`sdot${s ? '' : ' is-none'}`} style={s ? { ['--c' as string]: `var(--s-${s.color})` } : undefined} {...tip(s?.name ?? '과목 없음')} />
            <span {...tip(KIND_NAME[note.kind])}>{(() => { const K = KIND_ICON[note.kind]; return <K size={14} /> })()}</span>
            {note.kind === 'pdf' && note.pages ? <span className="mono">{note.page ?? 1} / {note.pages}</span> : null}
          </p>
          {note.excerpt && <p className="np-o-x">{note.excerpt}</p>}
          {(note.kind === 'ink' || note.kind === 'pdf') && <PagePreview note={note} fallback={props.thumb} onOpen={(el) => props.onOpenNote(note.id, el)} />}
          <Backlinks noteId={note.id} title={note.title} onOpen={props.onOpenNote} />
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

/**
 * 미리보기 칸의 첫 쪽(검수 M3-2): 칸 너비 · 남은 높이에 맞춰 크게(최대 1쪽). 그림은 엔진의 inkThumbnailURL로
 * 실제 상자 높이(40px 단위)에 맞춰 받는다 — 잉크 청크는 필기 노트를 미리볼 때만 불러온다. 누르면 펼친다.
 */
function PagePreview({ note, fallback, onOpen }: { note: Note; fallback?: string; onOpen: (el: Element) => void }) {
  const box = useRef<HTMLButtonElement>(null)
  const [h, setH] = useState(0)
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setH(Math.max(80, Math.round(el.clientHeight / 40) * 40)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  useEffect(() => {
    if (!h) return
    let alive = true
    void import('@/ink')
      .then((m) => m.inkThumbnailURL({ noteId: note.id, height: h }))
      .then((u) => alive && setUrl(u))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [note.id, note.updatedAt, h])
  const src = url ?? fallback
  return (
    <button type="button" ref={box} className="np-o-page" {...tip('펼치기', { kbd: '↵' })} onClick={(e) => onOpen(e.currentTarget)}>
      {src ? <img src={src} alt="" /> : <IconPen size={22} />}
    </button>
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

function TodayClassRow({ today, current, onOpen }: { today: TodayClass; current?: string; onOpen: (pen: boolean, el: Element) => void }) {
  const hand = useRef('mouse')
  const down = (e: ReactPointerEvent) => {
    hand.current = e.pointerType
  }
  const s = today.subject
  const name = s?.short ?? s?.name ?? '수업'
  const dot = <i className={`sdot${s ? '' : ' is-none'}`} style={s ? { ['--c' as string]: `var(--s-${s.color})` } : undefined} aria-hidden="true" />
  if (today.note) {
    const on = today.note.id === current
    return (
      <button type="button" aria-current={on || undefined} className={`notes-today-row${on ? ' is-on' : ''}`} data-tip="오늘" onPointerDown={down} onClick={(e) => onOpen(hand.current === 'pen', e.currentTarget)}>
        <span className="nl-line">
          <span className="nl-mark" aria-hidden="true">
            <IconDoc size={13} />
            {dot}
          </span>
          <span className="nl-t">{noteName(today.note)}</span>
        </span>
      </button>
    )
  }
  // 없을 때: 점선 고리 ＋ · 과목 점 · 15:00 (이름은 툴팁)
  return (
    <button
      type="button"
      className="notes-today-row is-new"
      {...tip(`오늘 ${name} 수업 노트`)}
      onPointerDown={down}
      onClick={(e) => {
        onOpen(hand.current === 'pen', e.currentTarget)
        hand.current = 'mouse'
      }}
    >
      <span className="nt-ring" aria-hidden="true">
        <IconPlus size={14} />
      </span>
      {dot}
      <span className="mono">{today.slot.start}</span>
    </button>
  )
}

/**
 * 금빛 ＋ — 입력한 손이 정한다(design-ink 1-1 · 리더 결정 4): 펜으로 누르면 필기 노트(빈 쪽 · 줄), 손가락 · 마우스 · 키보드는 글 노트.
 * 길게 누르기(손가락 450ms · 펜 · 마우스 600ms) · 오른쪽 클릭 · 메뉴 키 = 둥근 고르기 3칸: 글(12시) · 필기(4시) · PDF 가져오기(8시).
 */
function NewNoteButton({ onDoc, onInk, onPdf }: { onDoc: () => void; onInk: (el: Element | null) => void; onPdf: () => void }) {
  const [pick, setPick] = useState(false)
  const box = useRef<HTMLSpanElement>(null)
  const press = useRef<{ timer: number; long: boolean; x: number; y: number } | null>(null)
  const hand = useRef('mouse')
  useEffect(() => {
    if (!pick) return
    const off = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setPick(false)
    }
    document.addEventListener('pointerdown', off)
    const release = pushLayer({ id: 'new-note-pick', close: () => setPick(false), restoreFocusTo: box.current?.querySelector('.gold-btn') ?? null, el: box.current })
    return () => {
      document.removeEventListener('pointerdown', off)
      release()
    }
  }, [pick])
  const choose = (k: 'doc' | 'ink' | 'pdf') => {
    setPick(false)
    if (k === 'doc') onDoc()
    else if (k === 'ink') onInk(box.current)
    else onPdf()
  }
  const stop = () => {
    const p = press.current
    if (p) window.clearTimeout(p.timer)
  }
  return (
    <span className={`nn-wrap${pick ? ' is-open' : ''}`} ref={box}>
      <button
        type="button"
        className="gold-btn"
        {...tip('새 노트')}
        data-radial=""
        aria-haspopup="menu"
        aria-expanded={pick}
        onPointerDown={(e) => {
          hand.current = e.pointerType
          if (e.button !== 0) return
          const p = { timer: 0, long: false, x: e.clientX, y: e.clientY }
          p.timer = window.setTimeout(() => {
            p.long = true
            setPick(true)
          }, e.pointerType === 'touch' ? 450 : 600)
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
          setPick(true)
        }}
        onClick={(e) => {
          const p = press.current
          press.current = null
          if (p?.long || pick) return
          // 키보드(detail 0) · 손가락 · 마우스 = 글, 펜 = 필기
          if (e.detail !== 0 && hand.current === 'pen') onInk(e.currentTarget)
          else onDoc()
        }}
        onKeyDown={(e) => {
          if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
            e.preventDefault()
            setPick(true)
          }
        }}
      >
        <IconPlus size={22} />
      </button>
      {pick && (
        <span className="nn-pick" role="menu" aria-label="새 노트">
          <button type="button" role="menuitem" className="nn-i nn-i-0" {...tip('글 노트')} onClick={() => choose('doc')} autoFocus>
            <IconDoc size={20} />
          </button>
          <button type="button" role="menuitem" className="nn-i nn-i-1" {...tip('필기 노트')} onClick={() => choose('ink')}>
            <IconPen size={20} />
          </button>
          <button type="button" role="menuitem" className="nn-i nn-i-2" {...tip('PDF 가져오기')} onClick={() => choose('pdf')}>
            <IconPdf size={20} />
          </button>
        </span>
      )}
    </span>
  )
}
