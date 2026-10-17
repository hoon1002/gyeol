/**
 * 시간표 격자 + 그리기 (design-m2 6장). 계획 화면과 첫 실행 2단계가 같이 쓴다.
 * 가로·태블릿: 빈 칸을 세로로 끌어 30분 단위 칸 → 옆 팝오버(과목 · 강의실 · 매주). 폰: 누르면 1시간 칸 + 위·아래 손잡이, 입력은 아래 시트.
 * 칸 누르기 = 고치기 + '지우기'(확인 없음, 5초 '되돌리기').
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as RPointerEvent, type RefObject } from 'react'
import type { CourseSlot, Subject, SubjectColor } from '@/db/schema'
import { addDays, hm, minutesOfDay, startOfWeek, weekdayShort } from '@/lib/time'
import { useIsPhone } from '@/shell/hooks'
import { COLORS, COLOR_NAME, nextColor, type TimetableStore } from './slots'
import { tip } from '@/shell/Tip'
import { announce } from '@/shell/announce'
import { pushLayer } from '@/shell/layers'
import { IconCheck, IconChevron, IconClose, IconRepeat, IconRoom, IconTrash, IconUndo } from '@/shell/icons'
import '@/styles/capture.css'

const STEP = 30
const toHM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

interface Draft {
  id?: string
  weekday: number
  a: number
  b: number
  name: string
  color: SubjectColor
  room: string
}

export function Timetable({ store, now, knotRef, className = '' }: { store: TimetableStore; now: Date; knotRef?: RefObject<HTMLSpanElement | null>; className?: string }) {
  const { subjects, slots } = store
  const phone = useIsPhone()
  const [weekend, setWeekend] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [undo, setUndo] = useState<CourseSlot | null>(null)
  const drag = useRef<{ weekday: number; a: number; el: HTMLElement; moved: boolean } | null>(null)
  const gridRef = useRef<HTMLDivElement>(null)

  const todayIdx = (now.getDay() + 6) % 7
  const showWeekend = weekend || slots.some((s) => s.weekday === 0 || s.weekday === 6) || (!phone && todayIdx >= 5)
  const days = showWeekend ? 7 : 5
  const startH = Math.min(9, ...slots.map((s) => Math.floor(hm(s.start) / 60)))
  const endH = Math.max(18, ...slots.map((s) => Math.ceil(hm(s.end) / 60)))
  const span = (endH - startH) * 60
  const ws = startOfWeek(now)
  const nowMin = minutesOfDay(now)
  const sub = (id: string) => subjects.find((s) => s.id === id)

  /* 겹침 (QA #28): 그리는 동안 빨간 점선, 놓으면 가장 가까운 빈 자리로 붙인다. 저장 때 같은 과목이면 합치고, 다른 과목이면 막는다 */
  const clashes = (wd: number, a: number, b: number, except?: string) => slots.filter((x) => x.weekday === wd && x.id !== except && hm(x.start) < b && a < hm(x.end))
  const freeSpot = (wd: number, a: number, b: number, except?: string): [number, number] | null => {
    const len = b - a
    for (let k = 0; k <= span / STEP; k++)
      for (const dir of [1, -1]) {
        const na = a + dir * k * STEP
        const nb = na + len
        if (na < startH * 60 || nb > endH * 60) continue
        if (!clashes(wd, na, nb, except).length) return [na, nb]
      }
    return null
  }
  const [shake, setShake] = useState<string[]>([])
  useEffect(() => {
    if (!shake.length) return
    const t = setTimeout(() => setShake([]), 420)
    return () => clearTimeout(t)
  }, [shake])
  const draftClash = draft ? clashes(draft.weekday, draft.a, draft.b, draft.id).map((x) => x.id) : []

  useEffect(() => {
    if (!undo) return
    const t = setTimeout(() => setUndo(null), 5000)
    return () => clearTimeout(t)
  }, [undo])

  const minAt = (el: HTMLElement, clientY: number, round: 'floor' | 'ceil') => {
    const r = el.getBoundingClientRect()
    const m = startH * 60 + ((clientY - r.top) / r.height) * span
    const q = Math[round](m / STEP) * STEP
    return Math.max(startH * 60, Math.min(endH * 60, q))
  }

  const newDraft = (weekday: number, a: number, b: number): Draft => ({ weekday, a, b, name: '', color: nextColor(subjects), room: '' })

  const onDown = (e: RPointerEvent<HTMLDivElement>, weekday: number) => {
    if (e.button !== 0 || e.target !== e.currentTarget) return
    const el = e.currentTarget
    // 마우스 누름이 #stage로 포커스를 가져가 팝오버 입력 포커스를 빼앗지 않게(QA #8)
    if (e.pointerType === 'mouse') e.preventDefault()
    const a = minAt(el, e.clientY, 'floor')
    if (phone) {
      // 폰: 끌기는 스크롤과 겹치므로 누르기만 (pointerup에서 만든다)
      drag.current = { weekday, a, el, moved: false }
      return
    }
    try {
      el.setPointerCapture(e.pointerId)
    } catch {
      /* 합성 포인터 등 */
    }
    drag.current = { weekday, a, el, moved: false }
    setDraft(newDraft(weekday, a, a + STEP))
  }
  const onMove = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || phone) return
    const m = minAt(d.el, e.clientY, 'ceil')
    const lo = Math.min(d.a, m - STEP)
    const hi = Math.max(d.a + STEP, m)
    if (hi - lo > STEP) d.moved = true
    setDraft((x) => (x && !x.id ? { ...x, a: lo, b: hi } : x))
  }
  const onUp = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    drag.current = null
    if (!d) return
    if (phone) {
      if (Math.abs(minAt(d.el, e.clientY, 'floor') - d.a) <= STEP) {
        const b = Math.min(endH * 60, d.a + 60)
        const f = clashes(d.weekday, d.a, b).length ? freeSpot(d.weekday, d.a, b) : null
        setDraft(newDraft(d.weekday, f ? f[0] : d.a, f ? f[1] : b))
      }
      return
    }
    // 끌지 않고 누르기만 했으면 1시간. 겹치면 가장 가까운 빈 자리로 붙인다
    setDraft((x) => {
      if (!x || x.id) return x
      const y = d.moved ? x : { ...x, b: Math.min(endH * 60, x.a + 60) }
      if (!clashes(y.weekday, y.a, y.b).length) return y
      const f = freeSpot(y.weekday, y.a, y.b)
      return f ? { ...y, a: f[0], b: f[1] } : y
    })
  }

  // 폰 손잡이: 위·아래로 늘리기
  const handle = (edge: 'a' | 'b') => ({
    onPointerDown: (e: RPointerEvent<HTMLSpanElement>) => {
      e.stopPropagation()
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        /* noop */
      }
    },
    onPointerMove: (e: RPointerEvent<HTMLSpanElement>) => {
      if (!e.currentTarget.hasPointerCapture(e.pointerId) || !draft) return
      const body = e.currentTarget.closest('.tt-body') as HTMLElement
      const m = minAt(body, e.clientY, 'floor')
      setDraft((x) => (x ? (edge === 'a' ? { ...x, a: Math.min(m, x.b - STEP) } : { ...x, b: Math.max(m, x.a + STEP) }) : x))
    },
  })

  const edit = (s: CourseSlot) => {
    const subj = sub(s.subjectId)
    setDraft({ id: s.id, weekday: s.weekday, a: hm(s.start), b: hm(s.end), name: subj?.name ?? '', color: subj?.color ?? nextColor(subjects), room: s.room })
  }

  const save = async (d: Draft) => {
    const name = d.name.trim()
    if (!name) return
    const exist = subjects.find((s) => s.name === name || s.short === name)
    const touching = slots.filter((x) => x.weekday === d.weekday && x.id !== d.id && hm(x.start) <= d.b && d.a <= hm(x.end))
    const same = exist ? touching.filter((x) => x.subjectId === exist.id) : []
    const other = clashes(d.weekday, d.a, d.b, d.id).filter((x) => !same.includes(x))
    if (other.length) {
      // 다른 수업과 겹친다: 저장하지 않고 겹친 칸을 흔든다
      setShake(other.map((x) => x.id))
      announce('다른 수업과 겹쳐요')
      return
    }
    const subj = exist ?? (await store.createSubject(name, d.color))
    if (same.length) {
      // 같은 과목을 이어 붙이거나 겹쳤다: 한 칸으로 합친다
      const a = Math.min(d.a, ...same.map((x) => hm(x.start)))
      const b = Math.max(d.b, ...same.map((x) => hm(x.end)))
      const keep = same[0]!
      await store.saveSlot({ id: keep.id, subjectId: subj.id, weekday: d.weekday, start: toHM(a), end: toHM(b), room: d.room.trim() || keep.room })
      for (const x of same.slice(1)) await store.deleteSlot(x.id)
      if (d.id && d.id !== keep.id) await store.deleteSlot(d.id)
      announce('같은 과목 칸을 합쳤어요')
      setDraft(null)
      return
    }
    await store.saveSlot({ id: d.id, subjectId: subj.id, weekday: d.weekday, start: toHM(d.a), end: toHM(d.b), room: d.room.trim() })
    setDraft(null)
  }
  const remove = async (d: Draft) => {
    const s = slots.find((x) => x.id === d.id)
    if (!s) return
    await store.deleteSlot(s.id)
    setUndo(s)
    setDraft(null)
  }

  const colIdx = draft ? (draft.weekday + 6) % 7 : 0
  const popSide = colIdx >= Math.ceil(days / 2) ? 'left' : 'right'

  return (
    <div className={`tt ${className}`}>
      <div className="tt-tools">
        {phone && (
          <button type="button" className={`ibtn tt-toggle${showWeekend ? ' is-on' : ''}`} aria-pressed={showWeekend} {...tip('주말')} onClick={() => setWeekend((v) => !v)}>
            <IconChevron size={18} style={{ rotate: showWeekend ? '90deg' : '-90deg' }} />
          </button>
        )}
        {undo && (
          <button type="button" className="ibtn tt-undo" {...tip('되돌리기')} onClick={() => { void store.restoreSlot(undo); setUndo(null) }}>
            <IconUndo size={18} />
          </button>
        )}
      </div>
      <div ref={gridRef} className="week-grid tt-grid" style={{ ['--days' as string]: days, ['--rows' as string]: endH - startH }}>
        <div className="wg-hours" aria-hidden="true">
          {Array.from({ length: endH - startH + 1 }, (_, i) => (
            <span key={i} style={{ top: `${(i / (endH - startH)) * 100}%` }}>{startH + i}</span>
          ))}
        </div>
        {Array.from({ length: days }, (_, d) => {
          const weekday = (d + 1) % 7
          const isToday = d === todayIdx
          const date = addDays(ws, d)
          const list = slots.filter((s) => s.weekday === weekday).sort((a, b) => hm(a.start) - hm(b.start))
          const dr = draft && draft.weekday === weekday ? draft : null
          return (
            <div key={d} className={`wg-col${isToday ? ' is-today' : ''}`} role="group" aria-label={`${weekdayShort(weekday)}요일, 수업 ${list.length}개${isToday ? ', 오늘' : ''}`}>
              <div className="wg-head">
                <span>{weekdayShort(weekday)}</span>
                <span className="mono">{date.getDate()}</span>
              </div>
              <div className="wg-body tt-body" onPointerDown={(e) => onDown(e, weekday)} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => (drag.current = null)}>
                {list.map((s) => {
                  if (dr?.id === s.id) return null
                  const subj = sub(s.subjectId)
                  return (
                    <button
                      type="button"
                      key={s.id}
                      className={`wg-slot tt-slot${draftClash.includes(s.id) ? ' is-clash' : ''}${shake.includes(s.id) ? ' is-shake' : ''}`}
                      style={{ top: `${((hm(s.start) - startH * 60) / span) * 100}%`, height: `${((hm(s.end) - hm(s.start)) / span) * 100}%`, ['--c' as string]: subj ? `var(--s-${subj.color})` : 'var(--text-3)' }}
                      aria-label={`${subj?.name ?? '과목'} ${s.start}–${s.end} ${s.room}, 고치기`}
                      data-tip={[s.room, `${s.start}–${s.end}`].filter(Boolean)[0]}
                      onClick={() => edit(s)}
                    >
                      {/* 과목 이름 = 데이터(남김), 강의실·시각 = 길게(툴팁) — design-quiet 1-7 */}
                      <b>{phone ? subj?.short : subj?.name}</b>
                    </button>
                  )
                })}
                {dr && (
                  <div className={`wg-slot tt-draft${draftClash.length ? ' is-clash' : ''}`} style={{ top: `${((dr.a - startH * 60) / span) * 100}%`, height: `${((dr.b - dr.a) / span) * 100}%`, ['--c' as string]: `var(--s-${dr.color})` }}>
                    <b>{dr.name || `${toHM(dr.a)}`}</b>
                    <small className="mono">{toHM(dr.a)}–{toHM(dr.b)}</small>
                    {phone && (
                      <>
                        <span className="tt-handle is-top" aria-hidden="true" {...handle('a')} />
                        <span className="tt-handle is-bottom" aria-hidden="true" {...handle('b')} />
                      </>
                    )}
                  </div>
                )}
                {isToday && nowMin >= startH * 60 && nowMin <= endH * 60 && (
                  <div className="wg-now" style={{ top: `${((nowMin - startH * 60) / span) * 100}%` }}>
                    <span ref={knotRef} className="wg-now-dot" />
                  </div>
                )}
              </div>
            </div>
          )
        })}
        {draft && !phone && <SlotForm key={draft.id ?? `${draft.weekday}`} draft={draft} subjects={subjects} side={popSide} style={popStyle(draft, colIdx, days, startH, span)} onChange={setDraft} onSave={save} onCancel={() => setDraft(null)} onDelete={remove} />}
      </div>
      {draft && phone && (
        <div className="tt-sheet-layer">
          <div className="tt-sheet-catch" onClick={() => setDraft(null)} />
          <SlotForm key={draft.id ?? 'new'} draft={draft} subjects={subjects} side="sheet" onChange={setDraft} onSave={save} onCancel={() => setDraft(null)} onDelete={remove} />
        </div>
      )}
    </div>
  )
}

function popStyle(d: Draft, col: number, days: number, startH: number, span: number) {
  const top = Math.min(78, Math.max(0, ((d.a - startH * 60) / span) * 100))
  const x = ((col + (col >= Math.ceil(days / 2) ? 0 : 1)) / days) * 100
  return { top: `calc(28px + ${top}% * (1 - 28px / 100%))`, ['--px' as string]: `${x}%` }
}

function SlotForm({ draft, subjects, side, style, onChange, onSave, onCancel, onDelete }: {
  draft: Draft
  subjects: Subject[]
  side: 'left' | 'right' | 'sheet'
  style?: Record<string, string>
  onChange: (d: Draft) => void
  onSave: (d: Draft) => void | Promise<void>
  onCancel: () => void
  onDelete: (d: Draft) => void | Promise<void>
}) {
  const nameRef = useRef<HTMLInputElement>(null)
  const exist = subjects.find((s) => s.name === draft.name.trim() || s.short === draft.name.trim())
  const matches = useMemo(() => {
    const q = draft.name.trim().toLowerCase()
    return subjects.filter((s) => !q || s.name.toLowerCase().includes(q) || s.aliases.some((a) => a.toLowerCase().includes(q))).slice(0, 6)
  }, [draft.name, subjects])
  const cancelRef = useRef(onCancel)
  cancelRef.current = onCancel
  // 그리면 과목 칸에 바로 포커스(뒤따르는 click이 빼앗지 않게 다음 프레임에 한 번 더) — QA #8. Esc = 겹침 층
  useEffect(() => {
    nameRef.current?.focus({ preventScroll: true })
    const r = requestAnimationFrame(() => nameRef.current?.focus({ preventScroll: true }))
    const release = pushLayer({ id: 'timetable-pop', close: () => cancelRef.current() })
    return () => {
      cancelAnimationFrame(r)
      release()
    }
  }, [])
  const onKey = (e: KeyboardEvent) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    if (e.key === 'Enter') {
      e.preventDefault()
      void onSave(draft)
    }
  }
  return (
    <div className={`tt-pop is-${side}`} style={style} role="dialog" aria-label="수업" onKeyDown={onKey} onPointerDown={(e) => e.stopPropagation()}>
      <p className="tt-pop-meta mono">{weekdayShort(draft.weekday)} {toHM(draft.a)}–{toHM(draft.b)}</p>
      <label className="tt-field">
        <i className="sdot is-lg" style={{ ['--c' as string]: `var(--s-${exist?.color ?? draft.color})` }} aria-hidden="true" />
        <input ref={nameRef} className="tt-in" aria-label="과목" value={draft.name} onChange={(e) => onChange({ ...draft, name: e.target.value })} autoComplete="off" enterKeyHint="next" />
      </label>
      {matches.length > 0 && !exist && (
        <div className="tt-sugg">
          {matches.map((s) => (
            <button type="button" key={s.id} className="tt-chip" onClick={() => onChange({ ...draft, name: s.name, color: s.color })}>
              <i style={{ background: `var(--s-${s.color})` }} />{s.name}
            </button>
          ))}
        </div>
      )}
      {!exist && draft.name.trim() && (
        <div className="tt-colors" role="radiogroup" aria-label="색">
          {COLORS.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={draft.color === c} {...tip(COLOR_NAME[c])} className="tt-swatch" style={{ background: `var(--s-${c})` }} onClick={() => onChange({ ...draft, color: c })} />
          ))}
        </div>
      )}
      <label className="tt-field">
        <IconRoom size={16} />
        <input className="tt-in" aria-label="강의실" value={draft.room} onChange={(e) => onChange({ ...draft, room: e.target.value })} autoComplete="off" enterKeyHint="done" />
      </label>
      <div className="tt-acts">
        {/* 매주: 수업 칸은 늘 매주 반복(한 번만은 스키마에 없음) — 켜진 토글로 보인다 */}
        <span className="ibtn tt-weekly is-on" role="img" {...tip('매주')}><IconRepeat size={18} /></span>
        {draft.id && <button type="button" className="ibtn is-danger tt-del" {...tip('지우기')} onClick={() => void onDelete(draft)}><IconTrash size={18} /></button>}
        <button type="button" className="ibtn" {...tip('취소', { kbd: 'esc' })} onClick={onCancel}><IconClose size={18} /></button>
        <button type="button" className="gold-btn is-sm" {...tip('저장', { kbd: '↵' })} disabled={!draft.name.trim()} onClick={() => void onSave(draft)}><IconCheck size={20} /></button>
      </div>
    </div>
  )
}

