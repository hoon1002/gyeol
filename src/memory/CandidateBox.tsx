/**
 * 후보함 (design-m4 2장 · 앱 A, 지연 조각). 복습 글 구역을 그 자리에서 바꾼다: 가로 (0.08, 0.10)–(0.42, 0.90), 세로 · 폰은 아래 시트 72% · 85%.
 * 줄: 규칙 아이콘 · 과목 점 · 앞면 2줄 · 뒷면 1줄(빈칸 ▁▁) · 테이프는 덮인 그림 64×40.
 * 동작: ✓ 받기 · ✕ 버리기 · ✎ 고치기(hover · 포커스), 터치는 밀기(40%) · 누르기 = 고치기, 길게 · ⇧/⌘ 클릭 = 고르기.
 * 키: ↑↓ · A/Enter 받기 · X/Backspace 버리기 · E 고치기 · ⇧A 고른 것(없으면 모두) 받기 · Esc 닫기. 되돌리기 5초.
 */
import { useLiveQuery } from 'dexie-react-hooks'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as RKE, type PointerEvent as RPE } from 'react'
import { db } from '@/db/schema'
import { useSubjects } from '@/db/hooks'
import { useSkyEvent } from '@/fx'
import { IconBack, IconCandidate, IconCheck, IconClose, IconDust, IconPen, IconRecall, IconUndo } from '@/shell/icons'
import { tip } from '@/shell/Tip'
import { Hint } from '@/shell/Hint'
import { pushLayer } from '@/shell/layers'
import { useEffectiveMotion } from '@/shell/hooks'
import { acceptCandidates, dismissCandidates, restoreCandidates, sortCands, type Cand } from './candidates'
import '@/styles/memory.css'

const RULE_GLYPH: Record<string, string> = { qa: '::', cloze: '{ }', term: '—', bold: 'B', table: '▥', list: '≡', qline: 'Q', ask: '?' }
const RULE_TIP: Record<string, string> = { qa: '질문 :: 답', cloze: '빈칸', term: '용어 — 설명', bold: '굵은 글씨', table: '표', list: '목록', qline: 'Q · A', ask: '물음', tape: '테이프', recall: '떠올리기', memo: '메모' }

const H11_ART = (
  <svg width="96" height="64" viewBox="0 0 96 64" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect className="cb-h11-card" x="30" y="16" width="36" height="28" rx="5" strokeDasharray="3 2.6" />
    <path d="M78 30l4 4 7-8" opacity=".8" />
    <path d="M8 26l8 8M16 26l-8 8" opacity=".5" />
  </svg>
)

export function blankify(s: string) {
  const parts = s.split('[…]')
  return parts.flatMap((p, i) => (i ? [<span key={i} className="cb-blank" aria-label="빈칸">▁▁</span>, p] : [p]))
}

function night() {
  return document.documentElement.dataset.theme !== 'light'
}

function TapeThumb({ itemId, region }: { itemId?: string | null; region?: { pageId: string; rect: [number, number, number, number] } | null }) {
  const [img, setImg] = useState<{ url: string; flag: boolean } | null>(null)
  useEffect(() => {
    let alive = true
    void import('@/ink').then(async (ink) => {
      const r = itemId ? await ink.renderTapeRegion(itemId, { covered: true, scale: 1, night: night() }) : region ? await ink.renderPageRegion(region.pageId, region.rect, { covered: true, scale: 1, night: night() }) : null
      if (alive && r) setImg({ url: r.url, flag: r.flag })
    }).catch(() => {})
    return () => {
      alive = false
    }
  }, [itemId, region?.pageId, region?.rect.join()])
  return (
    <span className="cb-tape">
      {img && <img src={img.url} alt="" draggable={false} />}
      {img?.flag && <i className="cb-flag" aria-label="헷갈림" />}
    </span>
  )
}

function RuleIcon({ rule }: { rule: string }) {
  const t = RULE_TIP[rule] ?? rule
  if (rule === 'recall') return <span className="cb-rule" {...tip(t)}><IconRecall size={16} /></span>
  if (rule === 'memo') return <span className="cb-rule" {...tip(t)}><IconDust size={16} /></span>
  if (rule === 'tape')
    return (
      <span className="cb-rule" {...tip(t)}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true"><path d="M4 15.5L15.5 4l4.5 4.5L8.5 20z" /><path d="M8 12l4 4M11.5 8.5l4 4" opacity=".5" /></svg>
      </span>
    )
  return <span className="cb-rule mono" {...tip(t)}>{RULE_GLYPH[rule] ?? '·'}</span>
}

const regionOf = (a?: string | null) => {
  const m = /^region:([^:]+):([-\d.]+),([-\d.]+),([-\d.]+),([-\d.]+)$/.exec(a ?? '')
  return m ? { pageId: m[1]!, rect: [Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])] as [number, number, number, number] } : null
}

export default function CandidateBox({ noteId, onClose }: { noteId?: string | null; onClose: () => void }) {
  const data = useLiveQuery(async () => {
    const all = await db.cardCandidates.where('status').equals('new').toArray()
    const mine = (noteId ? all.filter((c) => c.noteId === noteId) : all) as Cand[]
    const notes = await db.notes.bulkGet([...new Set(mine.map((c) => c.noteId))])
    const info = new Map(notes.filter((n) => n && !n.deletedAt).map((n) => [n!.id, { subjectId: n!.subjectId, updatedAt: n!.updatedAt }]))
    return sortCands(mine.filter((c) => info.has(c.noteId)), (id) => info.get(id)?.updatedAt ?? 0).map((c) => ({ c, subjectId: info.get(c.noteId)?.subjectId ?? null }))
  }, [noteId])
  const subjects = useSubjects() ?? []
  const sky = useSkyEvent()
  const level = useEffectiveMotion()
  const [cur, setCur] = useState(0)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [edit, setEdit] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, { front: string; back: string }>>({})
  const [undo, setUndo] = useState<{ prev: Cand[]; cardIds: string[] } | null>(null)
  const undoTimer = useRef(0)
  const box = useRef<HTMLElement>(null)
  const editRef = useRef(edit)
  editRef.current = edit
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const list = useMemo(() => data ?? [], [data])
  const count = list.length

  // 겹침 층: Esc는 고치기를 먼저 접고, 그다음 판을 닫는다
  useEffect(() => {
    const release = pushLayer({
      id: 'candidates',
      el: box.current,
      restoreFocusTo: null,
      close: () => {
        if (editRef.current) {
          setEdit(null)
          return false
        }
        closeRef.current()
      },
    })
    box.current?.focus({ preventScroll: true })
    return release
  }, [])

  // 비었으면 복습 시작 화면으로(되돌리기를 기다리는 동안은 둔다)
  useEffect(() => {
    if (data && !data.length && !undo) onClose()
  }, [data, undo, onClose])

  useEffect(() => () => window.clearTimeout(undoTimer.current), [])
  useEffect(() => {
    if (cur >= count && count) setCur(count - 1)
  }, [cur, count])

  const remember = (prev: Cand[], cardIds: string[]) => {
    window.clearTimeout(undoTimer.current)
    setUndo({ prev, cardIds })
    undoTimer.current = window.setTimeout(() => setUndo(null), 5000)
  }
  const clearSel = (ids: string[]) =>
    setSel((s) => {
      const n = new Set(s)
      ids.forEach((id) => n.delete(id))
      return n
    })

  const accept = async (cs: Cand[]) => {
    if (!cs.length) return
    const ed: Record<string, { front: string; back: string }> = {}
    cs.forEach((c) => drafts[c.id] && (ed[c.id] = drafts[c.id]!))
    setEdit(null)
    clearSel(cs.map((c) => c.id))
    const ids = await acceptCandidates(cs, ed)
    remember(cs, ids)
    if (ids[0]) sky.birthStar({ id: ids[0], kind: 'card', level: 0.3 })
  }
  const dismiss = async (cs: Cand[]) => {
    if (!cs.length) return
    setEdit(null)
    clearSel(cs.map((c) => c.id))
    await dismissCandidates(cs)
    remember(cs, [])
  }
  const doUndo = async () => {
    if (!undo) return
    window.clearTimeout(undoTimer.current)
    const u = undo
    setUndo(null)
    await restoreCandidates(u.prev, u.cardIds)
  }
  const picked = () => list.filter((x) => sel.has(x.c.id)).map((x) => x.c)
  const toggleSel = (id: string) =>
    setSel((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const focusRow = (i: number) => {
    setCur(i)
    requestAnimationFrame(() => (box.current?.querySelector(`[data-row="${i}"]`) as HTMLElement | null)?.focus({ preventScroll: false }))
  }

  const onKey = (e: RKE) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && undo && !(e.target as HTMLElement).closest('textarea')) {
      e.preventDefault()
      void doUndo()
      return
    }
    if (e.nativeEvent.isComposing || e.metaKey || e.ctrlKey || e.altKey) return
    const t = e.target as HTMLElement
    if (t.closest('textarea, input')) return
    const it = list[cur]?.c
    const k = e.key
    if (k === 'ArrowDown' || k === 'ArrowUp') {
      e.preventDefault()
      focusRow(Math.max(0, Math.min(count - 1, cur + (k === 'ArrowDown' ? 1 : -1))))
    } else if (k === 'A' && e.shiftKey) {
      e.preventDefault()
      void accept(sel.size ? picked() : list.map((x) => x.c))
    } else if ((k === 'a' || k === 'Enter') && it && !t.closest('button')) {
      e.preventDefault()
      void accept(sel.size ? picked() : [it])
    } else if ((k === 'x' || k === 'Backspace') && it) {
      e.preventDefault()
      void dismiss(sel.size ? picked() : [it])
    } else if (k === 'e' && it) {
      e.preventDefault()
      setEdit(it.id)
    }
  }

  const subjColor = (id: string | null) => {
    const s = subjects.find((x) => x.id === id)
    return s ? `var(--s-${s.color})` : 'var(--text-3)'
  }
  const quick = level === 'off'

  return (
    <section className="cb" ref={box} tabIndex={-1} aria-label="후보함" onKeyDown={onKey}>
      <header className="cb-head">
        <button type="button" className="ibtn" {...tip('복습으로', { kbd: 'esc' })} onClick={onClose}>
          <IconBack size={18} />
        </button>
        <span className="cb-count inum" {...tip(`후보 ${count}`)}>
          <IconCandidate size={18} />
          <span className="mono">{count > 99 ? '99+' : count}</span>
        </span>
        <span className="cb-head-acts">
          {sel.size ? (
            <>
              <button type="button" className="ibtn cb-n" {...tip(`${sel.size}개 받기`, { kbd: '⇧A' })} onClick={() => void accept(picked())}>
                <IconCheck size={18} />
                <span className="mono">{sel.size}</span>
              </button>
              <button type="button" className="ibtn cb-n" {...tip(`${sel.size}개 버리기`, { kbd: 'X' })} onClick={() => void dismiss(picked())}>
                <IconClose size={18} />
                <span className="mono">{sel.size}</span>
              </button>
            </>
          ) : (
            <button type="button" className="ibtn cb-all" {...tip('모두 받기', { kbd: '⇧A' })} onClick={() => void accept(list.map((x) => x.c))} disabled={!count}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M2.5 12.5l4 4 8-9" />
                <path d="M10.5 15.5l1 1 8-9" />
              </svg>
            </button>
          )}
        </span>
        <span className="cb-hint" aria-hidden="true">
          <Hint id="H11" side="bottom" art={H11_ART} />
        </span>
      </header>
      <ul className="cb-list" role="listbox" aria-label="후보" aria-multiselectable="true">
        <AnimatePresence initial={false}>
          {list.map(({ c, subjectId }, i) => (
            <motion.li
              key={c.id}
              className="cb-li"
              exit={quick ? { opacity: 0, transition: { duration: 0.12 } } : { height: 0, opacity: 0, transition: { duration: 0.2, ease: [0.4, 0, 1, 1] } }}
            >
              <Row
                c={c}
                i={i}
                color={subjColor(subjectId)}
                active={i === cur}
                selected={sel.has(c.id)}
                editing={edit === c.id}
                draft={drafts[c.id]}
                onFocus={() => setCur(i)}
                onToggleSel={() => toggleSel(c.id)}
                onEdit={(v) => setEdit(v ? c.id : null)}
                onDraft={(d) => setDrafts((m) => ({ ...m, [c.id]: d }))}
                onAccept={() => void accept([c])}
                onDismiss={() => void dismiss([c])}
              />
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      <footer className="cb-foot">
        {undo && (
          <button type="button" className="ibtn cb-undo" {...tip('되돌리기', { kbd: '⌘Z' })} onClick={() => void doUndo()} autoFocus={false}>
            <IconUndo size={18} />
          </button>
        )}
      </footer>
    </section>
  )
}

function Row(p: {
  c: Cand
  i: number
  color: string
  active: boolean
  selected: boolean
  editing: boolean
  draft?: { front: string; back: string }
  onFocus: () => void
  onToggleSel: () => void
  onEdit: (v: boolean) => void
  onDraft: (d: { front: string; back: string }) => void
  onAccept: () => void
  onDismiss: () => void
}) {
  const { c } = p
  const el = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number; id: number; dx: number; long: boolean; timer: number; moved: boolean; kind: string } | null>(null)
  const [dx, setDx] = useState(0)
  const region = c.rule === 'tape' ? null : regionOf(c.anchor)
  const isImg = c.rule === 'tape' || !!region
  const d = p.draft ?? { front: c.front, back: c.back }

  const down = (e: RPE<HTMLDivElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button, textarea')) return
    const g = { x: e.clientX, y: e.clientY, id: e.pointerId, dx: 0, long: false, timer: 0, moved: false, kind: e.pointerType }
    g.timer = window.setTimeout(() => {
      if (!g.moved) {
        g.long = true
        p.onToggleSel()
      }
    }, 500)
    drag.current = g
  }
  const move = (e: RPE<HTMLDivElement>) => {
    const g = drag.current
    if (!g || g.id !== e.pointerId) return
    const mx = e.clientX - g.x
    if (!g.moved && Math.hypot(mx, e.clientY - g.y) > 8) {
      g.moved = true
      window.clearTimeout(g.timer)
      // 가로로 미는 것만(세로는 목록 스크롤) — 마우스는 밀지 않는다
      if (g.kind === 'mouse' || Math.abs(mx) < Math.abs(e.clientY - g.y)) {
        drag.current = null
        return
      }
      try {
        el.current?.setPointerCapture(e.pointerId)
      } catch {
        /* 무시 */
      }
    }
    if (g.moved) {
      g.dx = mx
      setDx(mx)
    }
  }
  const up = (e: RPE<HTMLDivElement>) => {
    const g = drag.current
    drag.current = null
    if (!g || g.id !== e.pointerId) return
    window.clearTimeout(g.timer)
    const w = el.current?.offsetWidth ?? 300
    setDx(0)
    if (g.moved) {
      if (g.dx > 0.4 * w) p.onAccept()
      else if (g.dx < -0.4 * w) p.onDismiss()
      return
    }
    if (g.long) return
    if (e.shiftKey || e.metaKey) return p.onToggleSel()
    p.onEdit(!p.editing)
  }

  return (
    <div
      ref={el}
      className={`cb-row${p.active ? ' is-cur' : ''}${p.selected ? ' is-sel' : ''}${p.editing ? ' is-edit' : ''}${dx > 0 ? ' to-ok' : dx < 0 ? ' to-no' : ''}`}
      role="option"
      aria-selected={p.selected}
      tabIndex={p.active ? 0 : -1}
      data-row={p.i}
      style={dx ? { translate: `${dx}px 0`, transition: 'none' } : undefined}
      onFocus={p.onFocus}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={() => {
        if (drag.current) window.clearTimeout(drag.current.timer)
        drag.current = null
        setDx(0)
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span className="cb-lead">
        <RuleIcon rule={c.rule} />
        <i className="sdot" style={{ ['--c' as string]: p.color }} />
      </span>
      {isImg ? (
        <span className="cb-body">
          <TapeThumb itemId={c.rule === 'tape' ? c.anchor : null} region={region} />
        </span>
      ) : p.editing ? (
        <span className="cb-body cb-edit">
          <textarea
            className="cb-in cb-in-f"
            value={d.front}
            rows={2}
            aria-label="앞면"
            autoFocus
            onChange={(e) => p.onDraft({ ...d, front: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                p.onAccept()
              }
            }}
          />
          <textarea
            className="cb-in cb-in-b"
            value={d.back}
            rows={1}
            aria-label="뒷면"
            onChange={(e) => p.onDraft({ ...d, back: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                p.onAccept()
              }
            }}
          />
        </span>
      ) : (
        <span className="cb-body">
          <span className="cb-front">{blankify(d.front)}</span>
          {d.back && <span className="cb-back">{d.back}</span>}
        </span>
      )}
      <span className="cb-acts">
        <button type="button" className="ibtn" {...tip('받기', { kbd: 'A' })} onClick={p.onAccept}>
          <IconCheck size={18} />
        </button>
        <button type="button" className="ibtn" {...tip('버리기', { kbd: 'X' })} onClick={p.onDismiss}>
          <IconClose size={18} />
        </button>
        {!isImg && (
          <button type="button" className="ibtn" {...tip('고치기', { kbd: 'E' })} onClick={() => p.onEdit(!p.editing)} aria-pressed={p.editing}>
            <IconPen size={18} />
          </button>
        )}
      </span>
    </div>
  )
}
