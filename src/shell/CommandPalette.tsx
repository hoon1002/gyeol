/**
 * ⌘K 팔레트 (design-v2 4-4, design.md W6). cmdk 기반, 거르기는 직접(초성 검색 때문에 shouldFilter=false).
 * 그룹 순서: (해석된 동작) → 이동 → 명령 → 과목 렌즈 → 노트.
 * 한글 조합 중 Enter는 cmdk가 무시한다(isComposing / keyCode 229) — 입력창에서도 한 번 더 막는다.
 * 폰(<600)은 아래에서 올라오는 시트(입력창이 엄지 쪽 아래).
 */
import { Command } from 'cmdk'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useFieldPause } from '@/fx'
import { db, uid, type Note, type Subject } from '@/db/schema'
import { useNotes, useNow, useSubjects } from '@/db/hooks'
import { matchText } from '@/lib/hangul'
import { parseCommand, resolveDue, type ParseResult } from '@/lib/parser'
import { switchTheme } from '@/lib/theme'
import { ddayOf, fmtAgo, fmtDday, weekdayShort, fmtHM } from '@/lib/time'
import { useSettings, type ThemePref } from '@/stores/settings'
import { useUi } from '@/stores/ui'
import type { MotionLevel } from '@/fx'
import { useEffectiveMotion, useGo, useIsPhone } from './hooks'
import { IconArrow, IconDeck, IconDoc, IconFocus, IconMore, IconMotion, IconPdf, IconPen, IconPlan, IconReview, IconSearch, IconTheme } from './icons'
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

interface Item {
  id: string
  group: string
  label: string
  sub?: string
  icon: ReactNode
  color?: string
  keywords?: string[]
  range?: [number, number] | null
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
  useFieldPause(open, 'overlay')

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
        id: 'act-new', group: '동작', label: `새 필기 노트${sb ? ' · ' + sb.name : ''}`, sub: 'A4 · 모눈 · 펜 전용 모드 (편집기는 M1)',
        icon: <IconPen size={17} />, color: colorOf(sb), preview: { kind: 'new', subject: sb },
        run: (el) => after(() => { void go('/notes', el); ui().showToast('펜 필기 편집기는 다음 단계(M1)에서 열려요', colorOf(sb)) }),
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
      run: () => after(() => ui().openSettings(origin)),
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

    // ---- 노트 ----
    notes.forEach((n) => {
      const s = subjOf(n.subjectId)
      const kindName = n.kind === 'ink' ? '필기' : n.kind === 'pdf' ? `PDF${n.page ? ` ${n.page}/${n.pages}쪽` : ''}` : n.kind === 'deck' ? '카드 덱' : '문서'
      list.push({
        id: 'note-' + n.id, group: '노트', label: n.title, sub: `${s?.name ?? '과목 없음'} · ${kindName} · ${fmtAgo(Date.now(), n.updatedAt)}`,
        keywords: s ? [s.name, ...s.aliases] : [],
        icon: <NoteIcon kind={n.kind} />, color: colorOf(s), preview: { kind: 'note', note: n, subject: s },
        run: (el) => after(() => { ui().setNoteFocusId(n.id); void go('/notes', el) }),
      })
    })

    // ---- 거르기 ----
    if (!q) {
      // 빈 입력: 노트는 최근 5개만
      let noteCount = 0
      return list.filter((it) => it.group !== '노트' || ++noteCount <= 5)
    }
    const actions = list.filter((it) => it.group === '동작')
    const rest = list
      .filter((it) => it.group !== '동작')
      .map((it) => {
        // 과목 이름이 해석됐으면 그 과목 노트·렌즈를 함께 보여 준다
        const m = matchText(it.label, q, it.keywords)
        const bySubject = sb && (it.id === 'lens-' + sb.id || (it.group === '노트' && it.preview.kind === 'note' && it.preview.note.subjectId === sb.id))
        return { it: { ...it, range: m.range }, score: m.score || (bySubject ? 1 : 0) }
      })
      .filter((x) => x.score > 0)
    const groupOrder = ['이동', '명령', '과목 렌즈', '노트']
    rest.sort((a, b) => groupOrder.indexOf(a.it.group) - groupOrder.indexOf(b.it.group) || b.score - a.score)
    let nc = 0
    return [...actions, ...rest.map((x) => x.it).filter((it) => it.group !== '노트' || ++nc <= 6)]
  }, [query, parsed, subjects, notes, now, themePref, motionLevel])

  const groups = useMemo(() => {
    const g: Array<[string, Item[]]> = []
    items.forEach((it) => {
      const last = g[g.length - 1]
      if (last && last[0] === it.group) last[1].push(it)
      else g.push([it.group, [it]])
    })
    return g
  }, [items])

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
        className="palette-panel"
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
              {groups.map(([name, list]) => (
                <Command.Group key={name} heading={name}>
                  {list.map((it) => (
                    <Command.Item key={it.id} value={it.id} data-id={it.id} onSelect={runSelected} className="pal-item" style={{ ['--c' as string]: it.color ?? 'var(--text-2)' }}>
                      <span className="pal-ic">{it.icon}</span>
                      <span className="pal-txt">
                        <span className="pal-label">
                          <Highlight text={it.label} range={it.range} />
                        </span>
                        {it.sub && <small>{it.sub}</small>}
                      </span>
                      <span className="pal-hint" aria-hidden="true">↵</span>
                    </Command.Item>
                  ))}
                </Command.Group>
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
        <p className="pv-title">새 필기 노트</p>
        <div className="pv-skel"><i /><i /></div>
        <p className="pv-tag">펜이 닿으면 크롬이 3px 결 줄로 접혀요</p>
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
