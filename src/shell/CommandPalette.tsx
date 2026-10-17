/**
 * ⌘K 팔레트 (design-v2 4-4 → design-m2 5장 · 리더 결정 4). cmdk 기반, 거르기는 직접(shouldFilter=false).
 * 한 목록 8줄 고정: ① 장소·명령(해석된 동작 포함) ≤ 2 ② 노트 ≤ 4(제목 일치 → 본문 일치, src/search 역색인)
 * ③ 메모 ≤ 2 ④ 마지막 줄은 늘 '메모로 저장 · ‘입력어’'(B의 saveMemo). 빈 입력은 '최근' 노트 5.
 * 노트 제목과 정확히·앞부분이 맞으면 그 노트가 늘 첫 줄. 자연어 명령은 동작 신호(parser intent)가 있을 때만 위에,
 * 과목 별칭만 맞으면 아래쪽 제안('… ›')으로.
 * 노트를 고르면 그 별이 지도에서 반짝인다(glintNotes).
 * 한글 조합 중 Enter는 cmdk가 무시한다(isComposing / keyCode 229) — 입력창에서도 한 번 더 막는다.
 * 폰(<600)은 아래에서 올라오는 시트(입력창이 엄지 쪽 아래).
 * 루트에 늘 마운트되므로 검색 색인 만들기(유휴 시간)와 새 노트 birthStar도 여기서 건다.
 */
import { Command } from 'cmdk'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useFieldPause, useSkyEvent } from '@/fx'
import { db, uid, type Note, type Subject } from '@/db/schema'
import { useNotes, useNow, useSubjects } from '@/db/hooks'
import { createNote, onNoteCreated } from '@/db/notes'
import { openDust, saveMemo } from '@/capture/api'
import { isIndexReady, scheduleIndexBuild, searchAll, useSearchVersion, type Hit } from '@/search'
import { matchText } from '@/lib/hangul'
import { parseCommand, resolveDue, type ParseResult } from '@/lib/parser'
import { switchTheme } from '@/lib/theme'
import { ddayOf, fmtDday, fmtMD, weekdayShort, fmtHM } from '@/lib/time'
import { useSettings, type ThemePref } from '@/stores/settings'
import { useUi } from '@/stores/ui'
import type { MotionLevel } from '@/fx'
import { useEffectiveMotion, useGo, useIsPhone } from './hooks'
import { IconArrow, IconDeck, IconDoc, IconFocus, IconMore, IconMotion, IconPdf, IconPen, IconPlan, IconPlus, IconReview, IconSearch, IconTheme } from './icons'
import '@/styles/search.css'
import { SPACES, type SpacePath } from './spaces'

type Preview =
  | { kind: 'go'; path: SpacePath }
  | { kind: 'settings' }
  | { kind: 'focus'; minutes: number; subject: Subject | null; note: Note | null }
  | { kind: 'review'; subject: Subject | null }
  | { kind: 'task'; subject: Subject | null; due: Date | null }
  | { kind: 'theme'; pref: ThemePref }
  | { kind: 'motion'; level: MotionLevel }
  | { kind: 'lens'; subject: Subject | null }
  | { kind: 'note'; note: Note; subject: Subject | null }
  | { kind: 'new'; subject: Subject | null }
  | { kind: 'memo'; text: string; subject: Subject | null }
  | { kind: 'save'; text: string }
  | { kind: 'dust' }

interface Item {
  id: string
  group: string
  label: string
  sub?: string
  icon: ReactNode
  color?: string
  keywords?: string[]
  range?: [number, number] | null
  /** 오른쪽 모노 11px "물리 · 10.12" */
  meta?: string
  /** 본문 일치: 둘째 줄 앞뒤 16자 발췌 */
  snippet?: { text: string; range: [number, number] } | null
  preview: Preview
  run: (el: Element | null) => void
}

const SPACE_DESC: Record<SpacePath, string> = {
  '/': '지금 무엇을 하면 되는지 한 문장으로',
  '/notes': '이어서 쓰기 · 과목 책등 · 최근 노트',
  '/map': '노트와 개념이 이어진 별자리',
  '/review': '오늘 복습할 카드',
  '/plan': '이번 주 시간표 · 과제 · 시험',
  '/focus': '25분 집중 · 은하 시계',
}

const THEME_LABEL: Record<ThemePref, string> = { dark: '밤', light: '낮', system: '시스템' }
const MOTION_LABEL: Record<MotionLevel, string> = { rich: '풍부', calm: '절제', off: '정지' }

function NoteIcon({ kind }: { kind: Note['kind'] }) {
  if (kind === 'ink') return <IconPen size={17} />
  if (kind === 'pdf') return <IconPdf size={17} />
  if (kind === 'deck') return <IconDeck size={17} />
  return <IconDoc size={17} />
}

function Highlight({ text, range }: { text: string; range?: [number, number] | null }) {
  if (!range) return <>{text}</>
  const a = Array.from(text)
  return (
    <>
      {a.slice(0, range[0]).join('')}
      <mark>{a.slice(range[0], range[1]).join('')}</mark>
      {a.slice(range[1]).join('')}
    </>
  )
}

export function CommandPalette() {
  const open = useUi((s) => s.paletteOpen)
  const openPalette = useUi((s) => s.openPalette)
  const closePalette = useUi((s) => s.closePalette)
  const sky = useSkyEvent()
  useFieldPause(open, 'overlay')

  // 검색 색인: 첫 화면이 뜬 뒤 유휴 시간에 (이후 저장마다 부분 갱신)
  useEffect(() => scheduleIndexBuild(), [])
  // 새 노트 → 하늘 birthStar (D6). 별가루 '노트로'는 fileDust가 맡는다(quiet)
  useEffect(() => onNoteCreated((n) => sky.birthStar({ id: n.id, kind: 'note', subject: n.subjectId ?? undefined })), [sky])

  // 어디서나 ⌘K / Ctrl+K
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        if (useUi.getState().paletteOpen) closePalette()
        else openPalette('', document.activeElement)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openPalette, closePalette])

  return <AnimatePresence>{open ? <Palette key="palette" /> : null}</AnimatePresence>
}

function Palette() {
  const initial = useUi((s) => s.paletteQuery)
  const origin = useUi((s) => s.paletteOrigin)
  const close = useUi((s) => s.closePalette)
  const ui = useUi.getState
  const [query, setQuery] = useState(initial)
  const [value, setValue] = useState('')
  const subjects = useSubjects() ?? []
  const notes = useNotes() ?? []
  const { now } = useNow()
  const go = useGo()
  const phone = useIsPhone()
  const motionLevel = useEffectiveMotion()
  const setTheme = useSettings((s) => s.setTheme)
  const setMotion = useSettings((s) => s.setMotion)
  const setLens = useSettings((s) => s.setLens)
  const setTravel = useSettings((s) => s.setTravel)
  const setRotation = useSettings((s) => s.setRotation)
  const themePref = useSettings((s) => s.theme)
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const sky = useSkyEvent()
  const indexVer = useSearchVersion()

  // 열려 있는 동안 뒤 페이지 스크롤 잠금 · 닫히면 포커스 복귀
  useEffect(() => {
    const root = document.documentElement
    const prev = root.style.overflow
    root.style.overflow = 'hidden'
    const t = setTimeout(() => inputRef.current?.focus(), 0)
    return () => {
      clearTimeout(t)
      root.style.overflow = prev
      const el = origin as HTMLElement | null
      if (el && typeof el.focus === 'function' && document.contains(el)) el.focus({ preventScroll: true })
    }
  }, [origin])

  const subjOf = (id: string | null | undefined) => subjects.find((s) => s.id === id) ?? null
  const colorOf = (s: Subject | null) => (s ? `var(--s-${s.color})` : undefined)
  const delay = motionLevel === 'off' ? 0 : 180

  /** 새 문서 노트를 만들고 노트 화면에서 연다(제목에 커서는 노트 화면이 맡지 않으므로 목록 맨 위에 선다) */
  const newNoteAndOpen = async (subjectId: string | null, el: Element | null) => {
    const n = await createNote({ subjectId })
    ui().setNoteFocusId(n.id)
    void go('/notes', el)
  }

  /** 닫고 나서 실행 (팔레트가 먼저 물러난다) */
  const after = (fn: () => void) => {
    close()
    setTimeout(fn, delay)
  }

  const parsed: ParseResult<Subject> = useMemo(() => parseCommand(query, subjects), [query, subjects])

  const items = useMemo<Item[]>(() => {
    const list: Item[] = []
    const q = query.trim()
    const recentFor = (s: Subject | null) => (s ? notes.find((n) => n.subjectId === s.id) ?? null : null)

    // ---- 해석된 동작 ----
    const p = parsed
    const sb = p.subject
    if (q && p.intent === 'focus') {
      const mn = p.minutes ?? 25
      const note = recentFor(sb)
      list.push({
        id: 'act-focus', group: '동작', label: `${sb ? sb.name + ' ' : ''}${mn}분 집중 시작`,
        sub: sb && note ? `‘${note.title}’ 곁에서 숨 고르기 → ${mn}분` : `${mn}분 집중 → 휴식 5분${sb ? '' : ' · 과목 없이'}`,
        icon: <IconFocus size={17} />, color: colorOf(sb) ?? 'var(--accent)',
        preview: { kind: 'focus', minutes: mn, subject: sb, note },
        run: (el) => after(() => { ui().setFocusIntent({ minutes: mn, subjectId: sb?.id ?? null, autostart: true }); void go('/focus', el) }),
      })
    } else if (q && p.intent === 'review') {
      list.push({
        id: 'act-review', group: '동작', label: sb ? `${sb.name} 복습 시작` : '오늘 복습 시작', sub: 'FSRS 순서대로 한 장씩',
        icon: <IconReview size={17} />, color: colorOf(sb) ?? 'var(--accent)', preview: { kind: 'review', subject: sb },
        run: (el) => after(() => { ui().setReviewIntent(true); void go('/review', el) }),
      })
    } else if (q && p.intent === 'task') {
      const due = resolveDue(p.due, now)
      const d = due ? ddayOf(now, due) : null
      list.push({
        id: 'act-task', group: '동작', label: `과제 추가 · ${sb ? sb.name : '과목 미정'}`,
        sub: `마감 ${due ? `${weekdayShort(due.getDay())}요일 ${fmtHM(due)}` : '날짜 미정'}${d !== null ? ' · ' + fmtDday(d) : ''}`,
        icon: <IconPlan size={17} />, color: colorOf(sb) ?? 'var(--warning)', preview: { kind: 'task', subject: sb, due },
        run: () => after(async () => {
          const t = Date.now()
          try {
            await db.tasks.add({ id: uid('task-'), subjectId: sb?.id ?? null, kind: 'assignment', title: `${sb ? sb.name + ' ' : ''}과제`, dueAt: (due ?? new Date(t + 7 * 86_400_000)).getTime(), done: 0, createdAt: t, updatedAt: t })
            ui().showToast('과제 추가 · 계획', colorOf(sb))
          } catch {
            ui().showToast('과제 저장 실패')
          }
        }),
      })
    } else if (q && p.intent === 'new') {
      list.push({
        id: 'act-new', group: '동작', label: `새 노트${sb ? ' · ' + sb.name : ''}`, sub: '문서 · / 블록 · [[ 링크',
        icon: <IconDoc size={17} />, color: colorOf(sb), preview: { kind: 'new', subject: sb },
        run: (el) => after(() => void newNoteAndOpen(sb?.id ?? null, el)),
      })
    } else if (q && p.intent === 'theme' && p.theme) {
      const pref = p.theme
      list.push({
        id: 'act-theme', group: '동작', label: `테마: ${THEME_LABEL[pref]}`, sub: '원형으로 번지며 바뀌어요',
        icon: <IconTheme size={17} />, preview: { kind: 'theme', pref },
        run: (el) => after(() => switchTheme(pref, setTheme, { origin: el, animate: motionLevel !== 'off' })),
      })
    } else if (q && p.intent === 'motion' && p.motion) {
      const lv = p.motion
      list.push({
        id: 'act-motion', group: '동작', label: `모션: ${MOTION_LABEL[lv]}`, sub: '결 필드와 화면 전환에 바로 적용',
        icon: <IconMotion size={17} />, preview: { kind: 'motion', level: lv },
        run: () => after(() => { setMotion(lv); ui().showToast(`모션: ${MOTION_LABEL[lv]}`) }),
      })
    } else if (q && sb && !p.intent) {
      const note = recentFor(sb)
      list.push({
        id: 'act-subject-focus', group: '동작', label: `${sb.name} 25분 집중`, sub: `숫자를 붙이면 시간이 바뀌어요 · 예: ${sb.short} 50분`,
        icon: <IconFocus size={17} />, color: colorOf(sb), preview: { kind: 'focus', minutes: 25, subject: sb, note },
        run: (el) => after(() => { ui().setFocusIntent({ minutes: 25, subjectId: sb.id, autostart: true }); void go('/focus', el) }),
      })
    }

    // ---- 이동 ----
    SPACES.forEach((s) => {
      const Icon = s.icon
      list.push({
        id: 'go-' + s.path, group: '이동', label: s.name, sub: SPACE_DESC[s.path], keywords: s.keywords,
        icon: <Icon size={17} />, preview: { kind: 'go', path: s.path },
        run: (el) => after(() => void go(s.path, el)),
      })
    })
    list.push({
      id: 'go-settings', group: '이동', label: '설정', sub: '지금 장소 위에 시트로 · ⌘,', keywords: ['settings', '설정', '테마', '모션', '환경', '회전'],
      icon: <IconMore size={17} />, preview: { kind: 'settings' },
      // 팔레트가 다 물러난 뒤(닫힘 연출 260ms + 포커스 복귀) 연다 — 시트가 포커스를 받게
      run: () => { close(); setTimeout(() => ui().openSettings(origin), motionLevel === 'off' ? 0 : 320) },
    })

    // ---- 명령 ----
    ;(['dark', 'light', 'system'] as ThemePref[]).forEach((pref) =>
      list.push({
        id: 'theme-' + pref, group: '명령', label: `테마: ${THEME_LABEL[pref]}`, sub: pref === themePref ? '지금 쓰는 테마' : '원형으로 번지며 바뀌어요',
        keywords: ['테마', 'theme', pref === 'dark' ? '어둡게' : pref === 'light' ? '밝게' : 'os'],
        icon: <IconTheme size={17} />, preview: { kind: 'theme', pref },
        run: (el) => after(() => switchTheme(pref, setTheme, { origin: el, animate: motionLevel !== 'off' })),
      }),
    )
    ;(['rich', 'calm', 'off'] as MotionLevel[]).forEach((lv) =>
      list.push({
        id: 'motion-' + lv, group: '명령', label: `모션: ${MOTION_LABEL[lv]}`, sub: lv === 'rich' ? '결이 살아 움직여요 (기본)' : lv === 'calm' ? '느리게, 위치 이동 없이' : '정지 화면 · 즉시 전환',
        keywords: ['모션', 'motion', '움직임', '애니메이션'],
        icon: <IconMotion size={17} />, preview: { kind: 'motion', level: lv },
        run: () => after(() => { setMotion(lv); ui().showToast(`모션: ${MOTION_LABEL[lv]}`) }),
      }),
    )
    ;(['fly', 'short', 'off'] as const).forEach((tv) =>
      list.push({
        id: 'travel-' + tv, group: '명령', label: `공간 이동 ${{ fly: '비행', short: '짧게', off: '끔' }[tv]}`, keywords: ['공간 이동', '비행', '카메라', 'travel'],
        icon: <IconMotion size={17} />, preview: { kind: 'motion', level: tv === 'off' ? 'off' : 'rich' },
        run: () => after(() => { setTravel(tv); ui().showToast(`공간 이동 ${{ fly: '비행', short: '짧게', off: '끔' }[tv]}`) }),
      }),
    )
    ;(['on', 'slow', 'off'] as const).forEach((rv) =>
      list.push({
        id: 'rotation-' + rv, group: '명령', label: `은하 회전 ${{ on: '켬', slow: '느리게', off: '끔' }[rv]}`, keywords: ['은하 회전', '회전', '공전', 'rotation'],
        icon: <IconMotion size={17} />, preview: { kind: 'motion', level: rv === 'off' ? 'off' : rv === 'slow' ? 'calm' : 'rich' },
        run: () => after(() => { setRotation(rv); ui().showToast(`은하 회전 ${{ on: '켬', slow: '느리게', off: '끔' }[rv]}`) }),
      }),
    )
    list.push({
      id: 'cmd-focus25', group: '명령', label: '25분 집중', sub: '과목 없이 바로 시작', keywords: ['집중', '뽀모도로', 'pomodoro', '타이머'],
      icon: <IconFocus size={17} />, color: 'var(--accent)', preview: { kind: 'focus', minutes: 25, subject: null, note: null },
      run: (el) => after(() => { ui().setFocusIntent({ minutes: 25, subjectId: null, autostart: true }); void go('/focus', el) }),
    })

    // ---- 과목 렌즈 ----
    list.push({
      id: 'lens-all', group: '과목 렌즈', label: '전체', sub: '렌즈 끄기', keywords: ['렌즈', 'lens', '모든 과목'],
      icon: <span className="pal-dot" style={{ background: 'var(--text-3)' }} />, preview: { kind: 'lens', subject: null },
      run: () => after(() => { setLens(null); ui().showToast('렌즈를 껐어요 · 모든 과목') }),
    })
    subjects.forEach((s) =>
      list.push({
        id: 'lens-' + s.id, group: '과목 렌즈', label: s.name, sub: '앱 전체를 이 과목으로 좁혀요', keywords: ['렌즈', 'lens', ...s.aliases],
        icon: <span className="pal-dot" style={{ background: `var(--s-${s.color})` }} />, color: `var(--s-${s.color})`, preview: { kind: 'lens', subject: s },
        run: () => after(() => { setLens(s.id); ui().showToast(`${s.name} 렌즈 · 필드가 이 과목 색으로 물들어요`, `var(--s-${s.color})`) }),
      }),
    )

    // ---- 노트 · 별가루 명령 ----
    list.push({
      id: 'cmd-new-note', group: '명령', label: '새 노트', sub: '문서 · / 블록 · [[ 링크', keywords: ['새 노트', '노트 만들기', 'new note', '문서'],
      icon: <IconDoc size={17} />, preview: { kind: 'new', subject: null },
      run: (el) => after(() => void newNoteAndOpen(null, el)),
    })
    list.push({
      id: 'cmd-dust', group: '이동', label: '별가루', sub: '1초 메모 모음 · 노트로 · 할 일로 · 보관', keywords: ['별가루', '메모', '메모함', 'inbox', 'dust', '별가루함'],
      icon: <span className="pal-dot pal-dust" />, preview: { kind: 'dust' },
      run: (el) => after(() => openDust(el)),
    })

    const noteRow = (n: Note, hit?: Hit): Item => {
      const s = subjOf(n.subjectId)
      return {
        id: 'note-' + n.id, group: '노트', label: n.title || '제목 없음', range: hit?.titleRange ?? null,
        meta: `${s?.short ?? '과목 없음'} · ${fmtMD(n.updatedAt)}`, snippet: hit?.field === 'body' ? hit.snippet : null,
        icon: <NoteIcon kind={n.kind} />, color: colorOf(s), preview: { kind: 'note', note: n, subject: s },
        run: (el) => after(() => { ui().setNoteFocusId(n.id); sky.glintNotes([n.id]); void go('/notes', el) }),
      }
    }

    // ---- 빈 입력: 최근 노트 5 ----
    if (!q) return notes.slice(0, 5).map((n) => ({ ...noteRow(n), group: '최근' }))

    // ① 장소·명령 ≤ 2. 자연어 명령(동작)은 질의에 동작 신호(집중 · n분 · 추가 · 마감 · 복습 …, parser intent)가 있을 때만 위에 둔다.
    //    신호 없이 과목 별칭만 맞으면('라플라스', '물리') 노트·메모가 먼저, 그 과목 명령·렌즈는 아래쪽 제안('공업수학 25분 집중 ›')으로만.
    const signal = !!p.intent
    const actions = list.filter((it) => it.group === '동작')
    const scored = list
      .filter((it) => it.group !== '동작')
      .map((it) => {
        const m = matchText(it.label, q, it.keywords)
        const bySubject = !!sb && it.id === 'lens-' + sb.id
        return { it: { ...it, range: m.range }, score: m.score || (bySubject ? 1 : 0), weak: bySubject && !signal }
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
    const strong = [...(signal ? actions : []), ...scored.filter((x) => !x.weak).map((x) => x.it)]
    const weak = [...(signal ? [] : actions.map((a) => ({ ...a, label: a.label + ' ›' }))), ...scored.filter((x) => x.weak).map((x) => x.it)]
    const strongHead = strong.slice(0, 2)
    const weakHead = weak.slice(0, 2 - strongHead.length)

    // ② 노트 ≤ 4: 역색인(제목 일치 → 본문 일치). 색인이 아직이면 제목만
    const byId = new Map(notes.map((n) => [n.id, n]))
    let noteHits: Item[] = searchAll(q, { kinds: ['note'], limit: 12 })
      .map((h) => (byId.get(h.id) ? noteRow(byId.get(h.id)!, h) : null))
      .filter((x): x is Item => !!x)
    if (!isIndexReady()) {
      noteHits = notes
        .map((n) => ({ n, m: matchText(n.title, q) }))
        .filter((x) => x.m.score > 0)
        .sort((a, b) => b.m.score - a.m.score)
        .map(({ n, m }) => ({ ...noteRow(n), range: m.range }))
    }
    // 과목 이름만 쳤으면 그 과목 최근 노트로 채운다
    if (sb && noteHits.length < 4) {
      const have = new Set(noteHits.map((x) => x.id))
      notes.filter((n) => n.subjectId === sb.id && !have.has('note-' + n.id)).forEach((n) => noteHits.push(noteRow(n)))
    }
    noteHits = noteHits.slice(0, 4)

    // ③ 메모 ≤ 2
    const memoHits: Item[] = searchAll(q, { kinds: ['memo'], limit: 2 }).map((h) => {
      const s = subjOf(h.subjectId)
      return {
        id: 'memo-' + h.id, group: '메모', label: h.title, range: h.titleRange,
        meta: `${s?.short ? s.short + ' · ' : ''}${fmtMD(h.updatedAt)}`, snippet: h.field === 'body' ? h.snippet : null,
        icon: <span className="pal-dot pal-dust" />, color: colorOf(s), preview: { kind: 'memo', text: h.title, subject: s },
        run: (el) => after(() => openDust(el)),
      }
    })

    // ④ 늘 마지막: 메모로 저장
    const save: Item = {
      id: 'save-memo', group: '메모', label: `메모로 저장 · ‘${q}’`,
      icon: <IconPlus size={17} />, color: 'var(--accent)', preview: { kind: 'save', text: q },
      run: () => {
        close()
        void saveMemo(q)
      },
    }
    // 노트 제목과 정확히(없으면 앞부분이) 맞으면 그 노트가 늘 첫 줄
    const ql = q.toLowerCase()
    const titleOf = (it: Item) => (it.preview.kind === 'note' ? it.preview.note.title : it.label).trim().toLowerCase()
    const lead = noteHits.find((it) => titleOf(it) === ql) ?? noteHits.find((it) => titleOf(it).startsWith(ql))
    const rows = [...(lead ? [lead] : []), ...strongHead, ...noteHits.filter((it) => it !== lead), ...memoHits, ...weakHead]
    // 8줄 고정: 마지막 줄은 늘 '메모로 저장'
    return [...rows.slice(0, 7), save]
  }, [query, parsed, subjects, notes, now, themePref, motionLevel, indexVer, sky])

  const selected = items.find((it) => it.id === value) ?? items[0]

  const chips: Array<{ k: string; v: string; c?: string }> = []
  if (query.trim()) {
    if (parsed.cho) chips.push({ k: '초성', v: parsed.text, c: 'var(--info)' })
    if (parsed.subject) chips.push({ k: '과목', v: parsed.subject.name, c: `var(--s-${parsed.subject.color})` })
    if (parsed.minutes !== null && parsed.intent === 'focus') chips.push({ k: '시간', v: `${parsed.minutes}분`, c: 'var(--accent)' })
    if (parsed.due && (parsed.due.day || parsed.due.time))
      chips.push({ k: '마감', v: `${parsed.due.day ? (parsed.due.day.length === 1 ? parsed.due.day + '요일' : parsed.due.day) : ''} ${parsed.due.time ?? ''}`.trim(), c: 'var(--warning)' })
    const intentName = parsed.intent ? { focus: '집중 시작', review: '복습', task: '과제 추가', new: '새 노트', theme: '테마', motion: '모션' }[parsed.intent] : null
    if (intentName) chips.push({ k: '동작', v: intentName })
  }

  const runSelected = (id: string) => {
    const it = items.find((x) => x.id === id)
    if (!it) return
    const el = panelRef.current?.querySelector(`[data-id="${CSS.escape(id)}"]`) ?? panelRef.current
    it.run(el)
  }

  const off = motionLevel === 'off'
  const panelMotion = phone
    ? { initial: { y: off ? 0 : '100%' }, animate: { y: 0 }, exit: { y: off ? 0 : '100%' } }
    : { initial: { opacity: 0, y: off ? 0 : -10, scale: off ? 1 : 0.97 }, animate: { opacity: 1, y: 0, scale: 1 }, exit: { opacity: 0, y: off ? 0 : -6, scale: off ? 1 : 0.985 } }

  return (
    <div className={`palette ${phone ? 'is-sheet' : ''}`}>
      <motion.div
        className="palette-scrim"
        aria-hidden="true"
        onClick={close}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: off ? 0 : 0.18 }}
      />
      <motion.div
        ref={panelRef}
        className="palette-panel pal-m2"
        role="dialog"
        aria-modal="true"
        aria-label="검색·명령"
        {...panelMotion}
        transition={{ duration: off ? 0 : phone ? 0.32 : 0.26, ease: [0.22, 1, 0.36, 1] }}
      >
        <Command
          label="검색·명령"
          shouldFilter={false}
          loop
          vimBindings={false}
          value={selected?.id ?? ''}
          onValueChange={setValue}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              close()
            } else if (e.key === 'Tab') {
              e.preventDefault()
            }
          }}
        >
          <div className="pal-input">
            <IconSearch size={20} />
            <Command.Input
              ref={inputRef}
              value={query}
              onValueChange={setQuery}
              placeholder="무엇을 할까요? 예: 물리 25분"
              onKeyDown={(e) => {
                // 한글 조합 중 Enter는 무시 (IME 보호)
                if (e.key === 'Enter' && (e.nativeEvent.isComposing || e.keyCode === 229)) e.stopPropagation()
              }}
            />
            <button type="button" className="kbd pal-esc" onClick={close} aria-label="닫기">esc</button>
          </div>
          {chips.length > 0 && (
            <div className="pal-parse" aria-live="polite">
              <span className="pal-parse-k">이렇게 읽었어요</span>
              {chips.map((c, i) => (
                <span key={c.k + i} className="tok" style={{ ['--c' as string]: c.c ?? 'var(--text-2)' }}>
                  <em>{c.k}</em>
                  {c.v}
                </span>
              ))}
            </div>
          )}
          <div className="pal-body">
            <Command.List className="pal-list" label="결과">
              {items.length === 0 && (
                <div className="pal-empty" role="status">
                  결과 없음 · 예: 물리 25분
                </div>
              )}
              {items.map((it) => (
                <Command.Item key={it.id} value={it.id} data-id={it.id} onSelect={runSelected} className={`pal-item pal-k-${it.group === '최근' ? 'note' : it.id.split('-')[0]}`} style={{ ['--c' as string]: it.color ?? 'var(--text-2)' }}>
                  <span className="pal-ic">{it.icon}</span>
                  <span className="pal-txt">
                    <span className="pal-label">
                      <Highlight text={it.label} range={it.range} />
                    </span>
                    {it.snippet ? (
                      <small className="pal-snip">
                        <Highlight text={it.snippet.text} range={it.snippet.range} />
                      </small>
                    ) : it.sub && !it.meta ? (
                      <small>{it.sub}</small>
                    ) : null}
                  </span>
                  {it.meta ? <span className="pal-meta">{it.meta}</span> : <span className="pal-hint" aria-hidden="true">↵</span>}
                </Command.Item>
              ))}
            </Command.List>
            {!phone && selected && <PreviewPane key={selected.id} p={selected.preview} />}
          </div>
          {!phone && (
            <div className="pal-foot" aria-hidden="true">
              <span><span className="kbd">↑</span><span className="kbd">↓</span> 이동</span>
              <span><span className="kbd">↵</span> 실행</span>
              <span><span className="kbd">esc</span> 닫기</span>
              <span className="r">초성 검색 · ㅇㅌㄹㅍ</span>
            </div>
          )}
        </Command>
      </motion.div>
    </div>
  )
}

function PreviewPane({ p }: { p: Preview }) {
  let body: ReactNode = null
  if (p.kind === 'go') {
    const s = SPACES.find((x) => x.path === p.path)!
    const Icon = s.icon
    body = (
      <>
        <p className="pv-k">미리보기 · 이동</p>
        <div className="pv-space"><Icon size={28} /></div>
        <p className="pv-title">{s.name}</p>
        <p className="pv-tag">{SPACE_DESC[p.path]}</p>
        <p className="pv-tag">은하 속 그 장소로 날아가요</p>
      </>
    )
  } else if (p.kind === 'settings') {
    body = (
      <>
        <p className="pv-k">미리보기 · 설정</p>
        <div className="pv-space"><IconMore size={28} /></div>
        <p className="pv-title">설정</p>
        <p className="pv-tag">테마 · 움직임 · 은하 회전 · 데이터</p>
        <p className="pv-tag">은하는 날지 않고 어두워져요</p>
      </>
    )
  } else if (p.kind === 'focus') {
    const c = p.subject ? `var(--s-${p.subject.color})` : 'var(--accent)'
    body = (
      <>
        <p className="pv-k">미리보기 · 집중</p>
        <div className="pv-ring">
          <svg viewBox="0 0 100 100" width="84" height="84" aria-hidden="true">
            <circle cx="50" cy="50" r="44" fill="none" stroke="var(--surface-3)" strokeWidth="3" />
            <circle cx="50" cy="50" r="44" fill="none" stroke={c} strokeWidth="3" strokeLinecap="round" strokeDasharray="276.5" strokeDashoffset="0" transform="rotate(-90 50 50)" />
          </svg>
          <span className="mono">{String(p.minutes).padStart(2, '0')}:00</span>
        </div>
        <p className="pv-title">{p.subject ? p.subject.name : '자유 집중'}</p>
        <ol className="pv-steps">
          <li>{p.note ? `‘${p.note.title}’ 곁에서` : '빈 집중 화면'}</li>
          <li>숨 고르기 — 화면이 한 번 어두워짐</li>
          <li>{p.minutes}분 뒤 휴식 5분</li>
        </ol>
      </>
    )
  } else if (p.kind === 'review') {
    body = (
      <>
        <p className="pv-k">미리보기 · 복습</p>
        <p className="pv-title">{p.subject ? `${p.subject.name} 카드` : '오늘 복습 카드'}</p>
        <div className="pv-seg"><i style={{ background: 'var(--s-phys)', flex: 6 }} /><i style={{ background: 'var(--s-math)', flex: 4 }} /><i style={{ background: 'var(--s-eng)', flex: 3 }} /></div>
        <ol className="pv-steps"><li>한 장씩 떠올리고 뒤집기</li><li>기억한 만큼 평가 → 다음 날짜가 정해져요</li></ol>
      </>
    )
  } else if (p.kind === 'task') {
    const d = p.due ? ddayOf(new Date(), p.due) : null
    body = (
      <>
        <p className="pv-k">미리보기 · 계획</p>
        <p className="pv-title">{p.subject ? p.subject.name : '과목 미정'} 과제</p>
        <p className="pv-dday">{d !== null ? fmtDday(d) : 'D-?'}</p>
        <ol className="pv-steps"><li>계획의 시간 띠에 놓여요</li><li>오늘 화면에 D-day가 나타나요</li></ol>
      </>
    )
  } else if (p.kind === 'theme') {
    body = (
      <>
        <p className="pv-k">미리보기 · 테마</p>
        <p className="pv-title">{THEME_LABEL[p.pref]}</p>
        <div className="pv-swatch">
          <i style={{ background: '#0B0C0E', borderColor: '#3A3F47', opacity: p.pref === 'light' ? 0.4 : 1 }} />
          <i style={{ background: '#F6F4EF', borderColor: '#C7C1B5', opacity: p.pref === 'dark' ? 0.4 : 1 }} />
        </div>
        <p className="pv-tag">{p.pref === 'system' ? '기기 설정을 따라가요' : '누른 자리에서 원형으로 번져요'}</p>
      </>
    )
  } else if (p.kind === 'motion') {
    body = (
      <>
        <p className="pv-k">미리보기 · 움직임</p>
        <p className="pv-title">{MOTION_LABEL[p.level]}</p>
        <p className="pv-tag">{p.level === 'rich' ? '물결·와이프·숨 쉬는 대기까지 모두' : p.level === 'calm' ? '속도 0.3배, opacity만 200ms 이하' : '정지 프레임 한 장, 모든 전환 즉시'}</p>
      </>
    )
  } else if (p.kind === 'lens') {
    body = (
      <>
        <p className="pv-k">미리보기 · 과목 렌즈</p>
        <p className="pv-title" style={{ color: p.subject ? `var(--s-${p.subject.color})` : undefined }}>{p.subject ? p.subject.name : '전체'}</p>
        <p className="pv-tag">{p.subject ? '노트 · 카드 · 마감이 이 과목으로 좁혀지고, 옹이 주변이 과목색으로 물들어요' : '모든 과목을 다시 보여 줘요'}</p>
      </>
    )
  } else if (p.kind === 'note') {
    body = (
      <>
        <p className="pv-k">미리보기 · 노트</p>
        <p className="pv-title">{p.note.title}</p>
        <p className="pv-tag"><i className="pal-dot" style={{ background: p.subject ? `var(--s-${p.subject.color})` : 'var(--text-3)' }} /> {p.subject?.name ?? '과목 없음'}</p>
        <div className="pv-skel"><i /><i /><i /></div>
      </>
    )
  } else if (p.kind === 'new') {
    body = (
      <>
        <p className="pv-k">미리보기 · 새 노트</p>
        <p className="pv-title">새 노트{p.subject ? ` · ${p.subject.name}` : ''}</p>
        <div className="pv-skel"><i /><i /></div>
        <p className="pv-tag">/ 블록 · [[ 링크</p>
      </>
    )
  } else if (p.kind === 'memo' || p.kind === 'save') {
    body = (
      <>
        <p className="pv-k">{p.kind === 'memo' ? '미리보기 · 별가루' : '메모로 저장'}</p>
        <p className="pv-title pv-memo">{p.text}</p>
        <p className="pv-tag">{p.kind === 'memo' ? '별가루함에서 노트로 · 할 일로 · 보관' : 'Enter · 하늘에 별가루 한 점'}</p>
      </>
    )
  } else if (p.kind === 'dust') {
    body = (
      <>
        <p className="pv-k">미리보기 · 별가루</p>
        <p className="pv-title">별가루</p>
        <p className="pv-tag">1초 메모 모음</p>
      </>
    )
  }
  return (
    <aside className="pal-preview" aria-label="미리보기">
      <div className="pv-anim">{body}</div>
      <IconArrow size={16} className="pv-arrow" />
    </aside>
  )
}
