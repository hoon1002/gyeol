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
import { useLiveQuery } from 'dexie-react-hooks'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useFieldPause, useSkyEvent } from '@/fx'
import { db, uid, type Note, type Subject } from '@/db/schema'
import { useNotes, useNow, useSubjects } from '@/db/hooks'
import { createNote, onNoteCreated } from '@/db/notes'
import { pickPdf, setPendingPdf, usePaperOpen } from '@/editor/inkState'
import { openDust, saveMemo } from '@/capture/api'
import { isIndexReady, scheduleIndexBuild, searchAll, useSearchVersion, type Hit } from '@/search'
import { matchText } from '@/lib/hangul'
import { parseCommand, resolveDue, type ParseResult } from '@/lib/parser'
import { switchTheme } from '@/lib/theme'
import { fmtMD } from '@/lib/time'
import { useSettings, type ThemePref } from '@/stores/settings'
import { useUi } from '@/stores/ui'
import type { MotionLevel } from '@/fx'
import { useEffectiveMotion, useGo, useIsPhone } from './hooks'
import { IconCandidate, IconDeck, IconDoc, IconDust, IconExam, IconExport, IconFlag, IconFocus, IconFresh, IconLock, IconMore, IconMotion, IconNote, IconPdf, IconPen, IconPlan, IconRecall, IconReview, IconSearch, IconTheme, IconUndo } from './icons'
import { openCandidates, openFreshStart } from '@/memory/intent'
import { openRecall } from '@/editor/recallState'
import { tip } from './Tip'
import { useHintCount } from './hints'
import { pushLayer } from './layers'
import '@/styles/search.css'
import { SPACES } from './spaces'

type InkModule = typeof import('@/ink')

/** 손글씨 명령 줄 아이콘(무리별 하나, 첫 화면 번들의 shell 아이콘만) */
const INK_GROUP_ICON: Record<string, (p: { size?: number }) => ReactNode> = {
  tool: IconPen, insert: IconDoc, edit: IconUndo, page: IconNote, tape: IconLock, view: IconSearch, file: IconExport, toggle: IconMotion, note: IconNote, memo: IconDust,
}
/** 빈 입력일 때 먼저 보일 손글씨 명령 */
const INK_FIRST = ['ink.undo', 'ink.redo', 'ink.page.add', 'ink.drawer', 'ink.tool.pen', 'ink.tool.highlighter', 'ink.tool.eraser', 'ink.close']

interface Item {
  id: string
  group: string
  label: string
  icon: ReactNode
  color?: string
  keywords?: string[]
  range?: [number, number] | null
  /** 오른쪽 숫자 메타: 과목 점(색 · null = 빈 고리) + 날짜 "10.12" */
  meta?: { dot?: string | null; text: string }
  /** 본문 일치: 둘째 줄 앞뒤 16자 발췌(데이터) */
  snippet?: { text: string; range: [number, number] } | null
  /** 노트 줄이면 그 노트(미리보기 칸 = 본문 앞 3줄) */
  note?: Note
  /** 툴팁 · 읽기용 이름(줄 글과 다를 때, 예: '메모로 저장') */
  tipLabel?: string
  /** 오른쪽 단축키(모노 11px) — 손글씨 명령 */
  kbd?: string
  /** 지금은 고를 수 없음(30%로 흐림) */
  disabled?: boolean
  /** 켜고 끄는 명령의 지금 상태(줄 끝 점) */
  on?: boolean
  run: (el: Element | null) => void
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
  // 종이가 펼쳐져 있으면 손글씨 명령을 먼저(design-ink 0-4). 잉크 모듈은 그때만 불러온다(첫 화면 번들 밖)
  const paperId = usePaperOpen()
  const [inkMod, setInkMod] = useState<InkModule | null>(null)
  useEffect(() => {
    if (!paperId || inkMod) return
    let alive = true
    void import('@/ink').then((m) => alive && setInkMod(m))
    return () => {
      alive = false
    }
  }, [paperId, inkMod])

  // 겹침 층: Esc는 전역 관리자가 맨 위 층만 닫는다(별 패널 위에 ⌘K를 열어도 ⌘K만 닫힘)
  useEffect(() => pushLayer({ id: 'palette', close: () => close(), el: panelRef.current }), [close])

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

  /** 새 필기 노트 · PDF 가져오기 → 노트 화면에서 종이를 펼친다(노트 화면이 초점을 보고 연다) */
  const newInkAndOpen = async (el: Element | null) => {
    const n = await createNote({ kind: 'ink' })
    ui().setNoteFocusId(n.id)
    void go('/notes', el)
  }
  const importPdfAndOpen = async (el: Element | null) => {
    const f = await pickPdf()
    if (!f) return
    const n = await createNote({ kind: 'pdf', title: f.name.replace(/\.pdf$/i, '') })
    setPendingPdf(n.id, f)
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

    // ---- 해석된 동작 ----
    const p = parsed
    const sb = p.subject
    if (q && p.intent === 'focus') {
      const mn = p.minutes ?? 25
      list.push({
        id: 'act-focus', group: '동작', label: `${sb ? sb.name + ' ' : ''}${mn}분 집중 시작`,
        icon: <IconFocus size={17} />, color: colorOf(sb) ?? 'var(--accent)',
        run: (el) => after(() => { ui().setFocusIntent({ minutes: mn, subjectId: sb?.id ?? null, autostart: true }); void go('/focus', el) }),
      })
    } else if (q && p.intent === 'review') {
      list.push({
        id: 'act-review', group: '동작', label: sb ? `${sb.name} 복습 시작` : '오늘 복습 시작',
        icon: <IconReview size={17} />, color: colorOf(sb) ?? 'var(--accent)',
        run: (el) => after(() => { ui().setReviewIntent(true); void go('/review', el) }),
      })
    } else if (q && p.intent === 'task') {
      const due = resolveDue(p.due, now)
      list.push({
        id: 'act-task', group: '동작', label: `과제 추가 · ${sb ? sb.name : '과목 미정'}`,
        icon: <IconPlan size={17} />, color: colorOf(sb) ?? 'var(--warning)',
        run: () => after(async () => {
          const t = Date.now()
          try {
            await db.tasks.add({ id: uid('task-'), subjectId: sb?.id ?? null, kind: 'assignment', title: `${sb ? sb.name + ' ' : ''}과제`, dueAt: (due ?? new Date(t + 7 * 86_400_000)).getTime(), done: 0, createdAt: t, updatedAt: t })
            ui().showToast('과제 추가')
          } catch {
            ui().showToast('과제 저장 실패')
          }
        }),
      })
    } else if (q && p.intent === 'new') {
      list.push({
        id: 'act-new', group: '동작', label: `새 노트${sb ? ' · ' + sb.name : ''}`,
        icon: <IconDoc size={17} />, color: colorOf(sb),
        run: (el) => after(() => void newNoteAndOpen(sb?.id ?? null, el)),
      })
    } else if (q && p.intent === 'theme' && p.theme) {
      const pref = p.theme
      list.push({
        id: 'act-theme', group: '동작', label: `테마: ${THEME_LABEL[pref]}`,
        icon: <IconTheme size={17} />,
        run: (el) => after(() => switchTheme(pref, setTheme, { origin: el, animate: motionLevel !== 'off' })),
      })
    } else if (q && p.intent === 'motion' && p.motion) {
      const lv = p.motion
      list.push({
        id: 'act-motion', group: '동작', label: `모션: ${MOTION_LABEL[lv]}`,
        icon: <IconMotion size={17} />,
        run: () => after(() => { setMotion(lv); ui().showToast(`모션: ${MOTION_LABEL[lv]}`) }),
      })
    } else if (q && sb && !p.intent) {
      list.push({
        id: 'act-subject-focus', group: '동작', label: `${sb.name} 25분 집중`,
        icon: <IconFocus size={17} />, color: colorOf(sb),
        run: (el) => after(() => { ui().setFocusIntent({ minutes: 25, subjectId: sb.id, autostart: true }); void go('/focus', el) }),
      })
    }

    // ---- 이동 ----
    SPACES.forEach((s) => {
      const Icon = s.icon
      list.push({
        id: 'go-' + s.path, group: '이동', label: s.name, keywords: s.keywords,
        icon: <Icon size={17} />,
        run: (el) => after(() => void go(s.path, el)),
      })
    })
    list.push({
      id: 'go-settings', group: '이동', label: '설정', keywords: ['settings', '설정', '테마', '모션', '환경', '회전'],
      icon: <IconMore size={17} />,
      // 팔레트가 다 물러난 뒤(닫힘 연출 260ms + 포커스 복귀) 연다 — 시트가 포커스를 받게
      run: () => { close(); setTimeout(() => ui().openSettings(origin), motionLevel === 'off' ? 0 : 320) },
    })

    // ---- 명령 ----
    ;(['dark', 'light', 'system'] as ThemePref[]).forEach((pref) =>
      list.push({
        id: 'theme-' + pref, group: '명령', label: `테마: ${THEME_LABEL[pref]}`,
        keywords: ['테마', 'theme', pref === 'dark' ? '어둡게' : pref === 'light' ? '밝게' : 'os'],
        icon: <IconTheme size={17} />,
        run: (el) => after(() => switchTheme(pref, setTheme, { origin: el, animate: motionLevel !== 'off' })),
      }),
    )
    ;(['rich', 'calm', 'off'] as MotionLevel[]).forEach((lv) =>
      list.push({
        id: 'motion-' + lv, group: '명령', label: `모션: ${MOTION_LABEL[lv]}`,
        keywords: ['모션', 'motion', '움직임', '애니메이션'],
        icon: <IconMotion size={17} />,
        run: () => after(() => { setMotion(lv); ui().showToast(`모션: ${MOTION_LABEL[lv]}`) }),
      }),
    )
    ;(['fly', 'short', 'off'] as const).forEach((tv) =>
      list.push({
        id: 'travel-' + tv, group: '명령', label: `공간 이동 ${{ fly: '비행', short: '짧게', off: '끔' }[tv]}`, keywords: ['공간 이동', '비행', '카메라', 'travel'],
        icon: <IconMotion size={17} />,
        run: () => after(() => { setTravel(tv); ui().showToast(`공간 이동 ${{ fly: '비행', short: '짧게', off: '끔' }[tv]}`) }),
      }),
    )
    ;(['on', 'slow', 'off'] as const).forEach((rv) =>
      list.push({
        id: 'rotation-' + rv, group: '명령', label: `은하 회전 ${{ on: '켬', slow: '느리게', off: '끔' }[rv]}`, keywords: ['은하 회전', '회전', '공전', 'rotation'],
        icon: <IconMotion size={17} />,
        run: () => after(() => { setRotation(rv); ui().showToast(`은하 회전 ${{ on: '켬', slow: '느리게', off: '끔' }[rv]}`) }),
      }),
    )
    list.push({
      id: 'cmd-focus25', group: '명령', label: '25분 집중', keywords: ['집중', '뽀모도로', 'pomodoro', '타이머'],
      icon: <IconFocus size={17} />, color: 'var(--accent)',
      run: (el) => after(() => { ui().setFocusIntent({ minutes: 25, subjectId: null, autostart: true }); void go('/focus', el) }),
    })

    // ---- 과목 렌즈 ----
    list.push({
      id: 'lens-all', group: '과목 렌즈', label: '전체', tipLabel: '과목 렌즈', keywords: ['렌즈', 'lens', '모든 과목'],
      icon: <i className="sdot is-lg is-none" />,
      run: () => after(() => { setLens(null); ui().showToast('렌즈 끔') }),
    })
    subjects.forEach((s) =>
      list.push({
        id: 'lens-' + s.id, group: '과목 렌즈', label: s.name, tipLabel: '과목 렌즈', keywords: ['렌즈', 'lens', ...s.aliases],
        icon: <i className="sdot is-lg" style={{ ['--c' as string]: `var(--s-${s.color})` }} />, color: `var(--s-${s.color})`,
        run: () => after(() => { setLens(s.id); ui().showToast(`렌즈 ${s.name}`) }),
      }),
    )

    // ---- 노트 · 별가루 명령 ----
    list.push({
      id: 'cmd-new-note', group: '명령', label: '새 노트', keywords: ['새 노트', '노트 만들기', 'new note', '문서'],
      icon: <IconDoc size={17} />,
      run: (el) => after(() => void newNoteAndOpen(null, el)),
    })
    list.push({
      id: 'cmd-new-ink', group: '명령', label: '새 필기 노트', keywords: ['필기', '손글씨', '새 필기', '펜', 'ink', 'pen'],
      icon: <IconPen size={17} />,
      run: (el) => after(() => void newInkAndOpen(el)),
    })
    list.push({
      id: 'cmd-pdf-import', group: '명령', label: 'PDF 가져오기', keywords: ['pdf', '가져오기', '파일', 'import', '필기'],
      icon: <IconPdf size={17} />,
      run: (el) => after(() => void importPdfAndOpen(el)),
    })
    // M4 기억: 후보함 · 떠올리기 · 새 출발 · 시험 넣기(앱 B의 시험 판은 window 'gyeol:exam-new'로 연다)
    list.push({
      id: 'cmd-candidates', group: '명령', label: '후보함', keywords: ['후보', '후보함', '카드 후보', '카드 고르기', 'candidates'],
      icon: <IconCandidate size={17} />,
      run: (el) => after(() => { openCandidates(null); void go('/review', el) }),
    })
    list.push({
      id: 'cmd-recall', group: '명령', label: '떠올리기', keywords: ['떠올리기', '회상', '백지 복습', 'recall', '기억해 쓰기'],
      icon: <IconRecall size={17} />,
      run: (el) =>
        after(() => {
          void (async () => {
            // 보고 있는 노트, 없으면 가장 최근 노트
            const id = ui().noteFocusId ?? (await db.notes.orderBy('updatedAt').reverse().filter((n) => !n.deletedAt).first())?.id
            if (!id) return
            ui().setNoteFocusId(id)
            openRecall(id)
            void go('/notes', el)
          })()
        }),
    })
    list.push({
      id: 'cmd-fresh', group: '명령', label: '새 출발', keywords: ['새 출발', '다시 나누기', '복습 나누기', 'fresh start'],
      icon: <IconFresh size={17} />,
      run: (el) => after(() => { openFreshStart(); void go('/review', el) }),
    })
    list.push({
      id: 'cmd-exam', group: '명령', label: '시험 넣기', keywords: ['시험', '시험 넣기', '중간고사', '기말고사', 'exam'],
      icon: <IconExam size={17} />,
      run: (el) => after(() => void go('/plan', el).then(() => window.dispatchEvent(new CustomEvent('gyeol:exam-new')))),
    })
    list.push({
      id: 'cmd-dust', group: '이동', label: '별가루', keywords: ['별가루', '메모', '메모함', 'inbox', 'dust', '별가루함'],
      icon: <IconDust size={17} />,
      run: (el) => after(() => openDust(el)),
    })

    const noteRow = (n: Note, hit?: Hit): Item => {
      const s = subjOf(n.subjectId)
      return {
        id: 'note-' + n.id, group: '노트', label: n.title.trim() || fmtMD(n.createdAt), range: n.title.trim() ? (hit?.titleRange ?? null) : null,
        meta: { dot: s ? `var(--s-${s.color})` : null, text: fmtMD(n.updatedAt) }, snippet: hit?.field === 'body' ? hit.snippet : null,
        icon: <NoteIcon kind={n.kind} />, color: colorOf(s), note: n,
        run: (el) => after(() => { ui().setNoteFocusId(n.id); sky.glintNotes([n.id]); void go('/notes', el) }),
      }
    }

    // ---- 손글씨 명령(종이가 펼쳐져 있을 때만, 먼저) ----
    const inkRows: Item[] = []
    if (paperId && inkMod) {
      const eng = inkMod.getActiveInkEngine()
      const cmds = inkMod.INK_COMMANDS.filter((c) => !c.noEngine)
      const ordered = q ? cmds : [...INK_FIRST.map((id) => cmds.find((c) => c.id === id)).filter((c): c is (typeof cmds)[number] => !!c)]
      for (const c of ordered) {
        const m = q ? matchText(c.name, q, c.aliases ?? []) : { score: 1, range: null }
        if (m.score <= 0) continue
        const Ic = INK_GROUP_ICON[c.group] ?? IconPen
        inkRows.push({
          id: 'ink-' + c.id, group: '손글씨', label: c.name, range: m.range, tipLabel: '손글씨', kbd: c.kbd,
          disabled: !!(eng && c.enabled && !c.enabled(eng)), on: !!(eng && c.on?.(eng)),
          icon: <Ic size={17} />,
          run: () => after(() => void inkMod.runInkCommand(c.id)),
        })
      }
    }

    // ---- 빈 입력: 종이가 펼쳐져 있으면 손글씨 명령, 아니면 최근 노트 5 ----
    if (!q) return inkRows.length ? inkRows.slice(0, 8) : notes.slice(0, 5).map((n) => ({ ...noteRow(n), group: '최근' }))

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
        meta: { dot: s ? `var(--s-${s.color})` : null, text: fmtMD(h.updatedAt) }, snippet: h.field === 'body' ? h.snippet : null,
        icon: <IconDust size={17} />, color: colorOf(s),
        run: (el) => after(() => openDust(el)),
      }
    })

    // ④ 늘 마지막: 메모로 저장
    const save: Item = {
      id: 'save-memo', group: '메모', label: `‘${q}’`, tipLabel: '메모로 저장',
      icon: <IconDust size={17} />, color: 'var(--accent)',
      run: () => {
        close()
        void saveMemo(q)
      },
    }
    // 노트 제목과 정확히(없으면 앞부분이) 맞으면 그 노트가 늘 첫 줄
    const ql = q.toLowerCase()
    const titleOf = (it: Item) => (it.note ? it.note.title : it.label).trim().toLowerCase()
    const lead = noteHits.find((it) => titleOf(it) === ql) ?? noteHits.find((it) => titleOf(it).startsWith(ql))
    const rows = [...inkRows.slice(0, 4), ...(lead ? [lead] : []), ...strongHead, ...noteHits.filter((it) => it !== lead), ...memoHits, ...weakHead]
    // 8줄 고정: 마지막 줄은 늘 '메모로 저장'
    return [...rows.slice(0, 7), save]
  }, [query, parsed, subjects, notes, now, themePref, motionLevel, indexVer, sky, paperId, inkMod])

  const selected = items.find((it) => it.id === value) ?? items[0]
  // 미리보기 칸 = 노트를 고를 때만, 본문 앞 3줄(데이터). 본문이 없거나 노트가 아니면 칸이 없다(리더 결정 5)
  const selNoteId = selected?.note?.id ?? null
  const pvText = useLiveQuery(async () => (selNoteId ? ((await db.noteBodies.get(selNoteId))?.text ?? '') : null), [selNoteId])
  const pvLines = pvText ? pvText.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 3) : []
  const showPv = !phone && !!selected?.note && pvLines.length > 0

  // 해석 칩 = 아이콘 + 값(머리말 없음): 과목 점 물리 · ◷ 25 · ⚑ 금 18:00
  const chips: Array<{ k: string; icon: ReactNode; v: string }> = []
  if (query.trim()) {
    if (parsed.subject) chips.push({ k: '과목', icon: <i className="sdot" style={{ ['--c' as string]: `var(--s-${parsed.subject.color})` }} />, v: parsed.subject.name })
    if (parsed.minutes !== null && parsed.intent === 'focus') chips.push({ k: '시간', icon: <IconFocus size={14} />, v: String(parsed.minutes) })
    if (parsed.due && (parsed.due.day || parsed.due.time)) chips.push({ k: '마감', icon: <IconFlag size={14} />, v: `${parsed.due.day ?? ''} ${parsed.due.time ?? ''}`.trim() })
  }

  // 처음 3번만: 자리표시 예시 '물리 25분' + 아래 키 안내(design-quiet 1-9 · H8). 그 뒤엔 빈 칸 + ⌕, esc 하나
  const example = useHintCount('cmdk-example', 3)
  const [showExample] = useState(example.fresh)
  const bumpExample = example.bump
  useEffect(() => {
    if (showExample) bumpExample()
  }, [showExample, bumpExample])

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
              placeholder={showExample ? '물리 25분' : undefined}
              onKeyDown={(e) => {
                // 한글 조합 중 Enter는 무시 (IME 보호)
                if (e.key === 'Enter' && (e.nativeEvent.isComposing || e.keyCode === 229)) e.stopPropagation()
              }}
            />
            <button type="button" className="kbd pal-esc" onClick={close} {...tip('닫기')}>esc</button>
          </div>
          {chips.length > 0 && (
            <div className="pal-parse" aria-live="polite">
              {chips.map((c, i) => (
                <span key={c.k + i} className="tok" aria-label={`${c.k} ${c.v}`}>
                  {c.icon}
                  {c.v}
                </span>
              ))}
            </div>
          )}
          <div className={`pal-body${showPv ? '' : ' no-pv'}`}>
            <Command.List className="pal-list" label="결과">
              {items.map((it) => (
                <Command.Item
                  key={it.id}
                  value={it.id}
                  data-id={it.id}
                  onSelect={runSelected}
                  disabled={it.disabled}
                  className={`pal-item pal-k-${it.group === '최근' ? 'note' : it.id.split('-')[0]}`}
                  style={{ ['--c' as string]: it.color ?? 'var(--text-2)' }}
                  {...(it.tipLabel ? { 'aria-label': `${it.tipLabel} ${it.label}`, 'data-tip': it.tipLabel } : {})}
                >
                  <span className="pal-ic">{it.icon}</span>
                  <span className="pal-txt">
                    <span className="pal-label">
                      <Highlight text={it.label} range={it.range} />
                    </span>
                    {it.snippet && (
                      <small className="pal-snip">
                        <Highlight text={it.snippet.text} range={it.snippet.range} />
                      </small>
                    )}
                  </span>
                  {it.kbd || it.on ? (
                    <span className="pal-meta pal-kbd">
                      {it.on && <i className="pal-on" aria-label="켬" />}
                      {it.kbd}
                    </span>
                  ) : it.meta ? (
                    <span className="pal-meta">
                      <i className={`sdot${it.meta.dot ? '' : ' is-none'}`} style={it.meta.dot ? { ['--c' as string]: it.meta.dot } : undefined} aria-hidden="true" />
                      {it.meta.text}
                    </span>
                  ) : (
                    <span className="pal-hint" aria-hidden="true">↵</span>
                  )}
                </Command.Item>
              ))}
            </Command.List>
            {showPv && selected?.note && <NotePreview key={selected.id} note={selected.note} color={selected.meta?.dot ?? null} lines={pvLines} />}
          </div>
          {!phone && showExample && (
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

/** 미리보기 칸: 노트 제목 + 과목 점 + 본문 앞 3줄(데이터만) */
function NotePreview({ note, color, lines }: { note: Note; color: string | null; lines: string[] }) {
  return (
    <aside className="pal-preview" aria-label="미리보기">
      <div className="pv-anim">
        <p className="pv-title">
          <i className={`sdot${color ? '' : ' is-none'}`} style={color ? { ['--c' as string]: color } : undefined} aria-hidden="true" /> {note.title.trim() || fmtMD(note.createdAt)}
        </p>
        {lines.map((l, i) => (
          <p key={i} className="pv-body">
            {l}
          </p>
        ))}
      </div>
    </aside>
  )
}
