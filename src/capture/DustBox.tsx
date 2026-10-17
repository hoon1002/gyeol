/**
 * 별가루함 — M3 조용한 판 + 메모 강화 (design-quiet 1-10 · m3-brief B).
 * 가로 화면의 오늘 = 오늘 글 구역을 그 자리에서 바꾼다(inline), 그 밖 = 아래 시트. 하늘은 어둡게 하지 않고 공전만 ×0.3.
 * 머리 = ‹ + ✦ n(보관함이면 ▣ n) + 과목 점 거르기 + 순서. 줄 = 메모 글(데이터) + 과목 점(시각은 툴팁) + 아이콘 동작.
 * 줄 키: ↑↓ 이동 · Enter 노트로 · T 할 일로 · E 보관 · P 고정 · S 과목 · X 고르기. 길게 누르기(500ms) = 고르기 모드 → 한꺼번에 옮기기.
 * 메모 종류: 글 · 체크리스트(줄을 눌러 체크) · 사진 · 음성(▶ 재생 · 길이).
 */
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as RPointerEvent } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useFieldPause } from '@/fx'
import { useAssetUrl, useMemos, useSubjects } from '@/db/hooks'
import { db, type Subject } from '@/db/schema'
import { fmtHM, fmtMD } from '@/lib/time'
import { useEffectiveMotion, useIsPhone } from '@/shell/hooks'
import { tip } from '@/shell/Tip'
import { announce } from '@/shell/announce'
import { IconArchive, IconBack, IconChevron, IconClose, IconDust, IconMic, IconPin, IconPlay, IconPause, IconSelect, IconTask, IconToNote, IconUndo } from '@/shell/icons'
import { useCapture } from './store'
import { fileMemo, restoreMemo, setMemoSubject } from './file'
import { memoItems, type AssetX, type MemoX } from './api'
import { fmtSec } from './voice'
import { SubjectPicker } from './SubjectPicker'
import { skyPinDust } from './sky'
import '@/styles/capture.css'

type To = 'note' | 'task' | 'archive'

async function setPinned(id: string, pinned: boolean) {
  await db.memos.update(id, { pinned, updatedAt: Date.now() } as Partial<MemoX>)
  skyPinDust(id, pinned)
}

function VoicePlay({ assetId, ms }: { assetId: string; ms?: number | null }) {
  const url = useAssetUrl(assetId)
  const assetMs = useLiveQuery(async () => (ms ? ms : (((await db.assets.get(assetId)) as AssetX | undefined)?.durationMs ?? 0)), [assetId, ms])
  const dur = ms || assetMs
  const [playing, setPlaying] = useState(false)
  const audio = useRef<HTMLAudioElement | null>(null)
  useEffect(() => () => audio.current?.pause(), [])
  const toggle = () => {
    if (!url) return
    if (!audio.current) {
      audio.current = new Audio(url)
      audio.current.onended = () => setPlaying(false)
    }
    if (playing) {
      audio.current.pause()
      setPlaying(false)
    } else {
      void audio.current.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
    }
  }
  return (
    <button type="button" className="ibtn inum dust-voice" {...tip(playing ? '멈춤' : '재생')} onClick={(e) => { e.stopPropagation(); toggle() }}>
      {playing ? <IconPause size={16} /> : <IconPlay size={16} />}
      <span aria-hidden="true">{fmtSec(dur ?? 0)}</span>
    </button>
  )
}

function Row({ memo, subjects, archive, selecting, selected, onSelect, onFocusMove }: {
  memo: MemoX
  subjects: Subject[]
  archive: boolean
  selecting: boolean
  selected: boolean
  onSelect: (id: string, on?: boolean) => void
  onFocusMove: (el: HTMLElement, d: 1 | -1) => void
}) {
  const asset = useLiveQuery(async () => (memo.assetId ? ((await db.assets.get(memo.assetId)) as AssetX | undefined)?.mime ?? null : null), [memo.assetId])
  const isVoice = memo.kind === 'voice' || (!!asset && asset.startsWith('audio/'))
  const url = useAssetUrl(isVoice ? null : memo.assetId)
  const phone = useIsPhone()
  const [open, setOpen] = useState(false)
  const [pick, setPick] = useState(false)
  const long = useRef<{ t: number; x: number; y: number; fired: boolean } | null>(null)
  const s = subjects.find((x) => x.id === memo.subjectId) ?? null
  const act = (to: To) => void fileMemo(memo, to).then(() => announce(to === 'note' ? '노트로 옮겼어요' : to === 'task' ? '할 일로 옮겼어요' : '보관했어요'))
  const lines = memoItems(memo)

  const onKey = (e: KeyboardEvent<HTMLLIElement>) => {
    if (e.target !== e.currentTarget || e.nativeEvent.isComposing) return
    const k = e.key.toLowerCase()
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      onFocusMove(e.currentTarget, e.key === 'ArrowDown' ? 1 : -1)
    } else if (e.metaKey || e.ctrlKey || e.altKey) {
      return
    } else if (k === 'x' || (selecting && e.key === ' ')) {
      e.preventDefault()
      onSelect(memo.id)
    } else if (archive) {
      if (e.key === 'Enter') {
        e.preventDefault()
        onFocusMove(e.currentTarget, 1)
        void restoreMemo(memo.id)
      }
    } else if (e.key === 'Enter' || k === 't' || k === 'e') {
      e.preventDefault()
      onFocusMove(e.currentTarget, 1)
      act(e.key === 'Enter' ? 'note' : k === 't' ? 'task' : 'archive')
    } else if (k === 'p') {
      e.preventDefault()
      void setPinned(memo.id, !memo.pinned)
    } else if (k === 's') {
      e.preventDefault()
      setPick(true)
    }
  }
  // 길게 누르기 500ms → 고르기 모드(이 줄 고름). 움직이면 취소
  const down = (e: RPointerEvent) => {
    if ((e.target as HTMLElement).closest('button, input')) return
    const st = { t: 0, x: e.clientX, y: e.clientY, fired: false }
    st.t = window.setTimeout(() => {
      st.fired = true
      onSelect(memo.id, true)
    }, 500)
    long.current = st
  }
  const move = (e: RPointerEvent) => {
    const st = long.current
    if (st && Math.hypot(e.clientX - st.x, e.clientY - st.y) > 8) {
      clearTimeout(st.t)
      long.current = null
    }
  }
  const up = () => {
    if (long.current) clearTimeout(long.current.t)
  }
  const click = () => {
    const fired = long.current?.fired
    long.current = null
    if (fired) return
    if (selecting) onSelect(memo.id)
    else if (phone) setOpen((v) => !v)
  }
  const toggleLine = async (i: number) => {
    if (!lines) return
    const next = lines.map((l, j) => (j === i ? { ...l, done: !l.done } : l))
    await db.memos.update(memo.id, { kind: 'check', items: next, text: next.map((x) => x.text).join('\n'), updatedAt: Date.now() })
  }

  const when = fmtHM(memo.createdAt)
  const label = `${memo.text || (isVoice ? '음성 메모' : '사진 메모')}, ${s?.name ?? '과목 없음'}, ${when}${memo.pinned ? ', 고정' : ''}`
  return (
    <motion.li
      className={`dust-row${open ? ' is-open' : ''}${selected ? ' is-sel' : ''}${memo.pinned ? ' is-pin' : ''}`}
      tabIndex={0}
      aria-label={label}
      aria-selected={selecting ? selected : undefined}
      onKeyDown={onKey}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onClick={click}
      onContextMenu={(e) => phone && e.preventDefault()}
      initial={false}
      exit={{ height: 0, opacity: 0, paddingTop: 0, paddingBottom: 0 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
    >
      {selecting && <span className={`dust-check${selected ? ' is-on' : ''}`} aria-hidden="true" />}
      <div className="dust-main">
        {lines ? (
          <ul className="dust-checklist" aria-label="체크리스트">
            {/* 처음 2항목 + "+n" (design-ink 8-3) */}
            {lines.slice(0, 2).map((l, i) => (
              <li key={l.id}>
                <label onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={l.done} onChange={() => void toggleLine(i)} disabled={selecting} />
                  <span className={l.done ? 'is-done' : ''}>{l.text}</span>
                </label>
              </li>
            ))}
            {lines.length > 2 && <li className="dust-more mono" aria-label={`항목 ${lines.length - 2}개 더`}>+{lines.length - 2}</li>}
          </ul>
        ) : (
          memo.text && <p className="dust-text">{memo.text}</p>
        )}
        <p className="dust-meta">
          <span className="dust-chip-wrap">
            <button type="button" className="ibtn dust-subj" tabIndex={-1} {...tip(`${s?.name ?? '과목 없음'} · ${fmtMD(memo.createdAt)} ${when}`)} onClick={(e) => { e.stopPropagation(); setPick(true) }}>
              <i className={`sdot${s ? '' : ' is-none'}`} style={s ? { ['--c' as string]: `var(--s-${s.color})` } : undefined} />
            </button>
            {pick && (
              <SubjectPicker className="is-down" subjects={subjects} value={memo.subjectId ?? null} onPick={(id) => { void setMemoSubject(memo.id, id); setPick(false) }} onClose={() => setPick(false)} />
            )}
          </span>
          {memo.pinned && <IconPin size={13} filled />}
          {isVoice && memo.assetId && <VoicePlay assetId={memo.assetId} ms={memo.durationMs} />}
          {isVoice && !memo.assetId && <IconMic size={14} />}
        </p>
      </div>
      {url && <img className="dust-img" src={url} alt="" />}
      {!selecting && (
        <div className="dust-acts" onClick={(e) => e.stopPropagation()}>
          {archive ? (
            <button type="button" className="ibtn" {...tip('되돌리기', { kbd: '↵' })} onClick={() => void restoreMemo(memo.id)}><IconUndo size={18} /></button>
          ) : (
            <>
              <button type="button" className="ibtn" {...tip('노트로', { kbd: '↵' })} onClick={() => act('note')}><IconToNote size={18} /></button>
              <button type="button" className="ibtn" {...tip('할 일로', { kbd: 'T' })} onClick={() => act('task')}><IconTask size={18} /></button>
              <button type="button" className="ibtn" {...tip('보관', { kbd: 'E' })} onClick={() => act('archive')}><IconArchive size={18} /></button>
              <button type="button" className={`ibtn${memo.pinned ? ' is-on' : ''}`} aria-pressed={!!memo.pinned} {...tip(memo.pinned ? '고정 풀기' : '고정', { kbd: 'P' })} onClick={() => void setPinned(memo.id, !memo.pinned)}><IconPin size={18} filled={!!memo.pinned} /></button>
            </>
          )}
        </div>
      )}
    </motion.li>
  )
}

export function DustBox({ variant }: { variant: 'inline' | 'sheet' }) {
  const archive = useCapture((s) => s.archive)
  const setArchive = useCapture((s) => s.setArchive)
  const close = useCapture((s) => s.closeDust)
  const raw = useMemos(archive ? 'archived' : 'inbox') as MemoX[] | undefined
  const archivedN = useLiveQuery(() => db.memos.where('state').equals('archived').count(), [])
  const subjects = useSubjects() ?? []
  const [oldFirst, setOldFirst] = useState(false)
  const [only, setOnly] = useState<string | null | undefined>(undefined)
  const [sel, setSel] = useState<Set<string> | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  useFieldPause(true, 'overlay')

  // 고정이 위, 그다음 새 순(또는 오래된 순). 과목 점으로 거르기
  const list = useMemo(() => {
    if (!raw) return undefined
    const xs = raw.filter((m) => only === undefined || (m.subjectId ?? null) === only)
    return xs.sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || (oldFirst ? a.createdAt - b.createdAt : b.createdAt - a.createdAt))
  }, [raw, only, oldFirst])
  const present = useMemo(() => {
    const ids = new Set((raw ?? []).map((m) => m.subjectId ?? null))
    return [...ids]
  }, [raw])

  useEffect(() => {
    const t = setTimeout(() => ref.current?.querySelector<HTMLElement>('.dust-row, .dust-back')?.focus({ preventScroll: true }), 30)
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (document.querySelector('.subj-pop')) return
      e.preventDefault()
      if (sel) setSel(null)
      else if (useCapture.getState().archive) setArchive(false)
      else close()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(t)
      window.removeEventListener('keydown', onKey)
    }
  }, [archive, close, setArchive, sel])

  useEffect(() => setSel(null), [archive])

  const move = (el: HTMLElement, d: 1 | -1) => {
    const rows = Array.from(ref.current?.querySelectorAll<HTMLElement>('.dust-row') ?? [])
    const i = rows.indexOf(el)
    ;(rows[i + d] ?? rows[i - d] ?? ref.current?.querySelector<HTMLElement>('.dust-foot button'))?.focus({ preventScroll: true })
  }
  const onSelect = (id: string, on?: boolean) =>
    setSel((cur) => {
      const n = new Set(cur ?? [])
      if (on ?? !n.has(id)) n.add(id)
      else n.delete(id)
      return n
    })
  const bulk = async (to: To | 'restore') => {
    const ids = [...(sel ?? [])]
    const memos = (list ?? []).filter((m) => ids.includes(m.id))
    setSel(null)
    for (const m of memos) {
      if (to === 'restore') await restoreMemo(m.id)
      else await fileMemo(m, to)
    }
    announce(`${memos.length}개 옮겼어요`)
  }
  const n = list?.length ?? 0
  const selecting = !!sel

  return (
    <div ref={ref} className={`dust dust-${variant}`} role="region" aria-label={archive ? '보관함' : '별가루'}>
      <header className="dust-head">
        <div className="dust-bar">
          {(variant === 'inline' || archive) && (
            <button type="button" className="ibtn dust-back" {...tip(archive ? '별가루' : '오늘')} onClick={() => (archive ? setArchive(false) : close())}>
              <IconBack size={20} />
            </button>
          )}
          <h2 className="dust-h inum" aria-label={`${archive ? '보관함' : '별가루'} ${n}개`}>
            {archive ? <IconArchive size={20} /> : <IconDust size={20} />}
            {n > 0 && <span aria-hidden="true">{selecting ? `${sel!.size} / ${n}` : n}</span>}
          </h2>
          <span className="dust-tools">
            {selecting ? (
              <>
                {archive ? (
                  <button type="button" className="ibtn" disabled={!sel!.size} {...tip('되돌리기')} onClick={() => void bulk('restore')}><IconUndo size={18} /></button>
                ) : (
                  <>
                    <button type="button" className="ibtn" disabled={!sel!.size} {...tip('노트로')} onClick={() => void bulk('note')}><IconToNote size={18} /></button>
                    <button type="button" className="ibtn" disabled={!sel!.size} {...tip('할 일로')} onClick={() => void bulk('task')}><IconTask size={18} /></button>
                    <button type="button" className="ibtn" disabled={!sel!.size} {...tip('보관')} onClick={() => void bulk('archive')}><IconArchive size={18} /></button>
                  </>
                )}
                <button type="button" className="ibtn" {...tip('고르기 끝', { kbd: 'esc' })} onClick={() => setSel(null)}><IconClose size={18} /></button>
              </>
            ) : (
              n > 1 && (
                <>
                  <button type="button" className="ibtn" {...tip('고르기', { kbd: 'X' })} onClick={() => setSel(new Set())}><IconSelect size={18} /></button>
                  <button type="button" className="ibtn" aria-pressed={oldFirst} {...tip(oldFirst ? '오래된 순' : '새 순')} onClick={() => setOldFirst((v) => !v)}>
                    <IconChevron size={18} style={{ rotate: oldFirst ? '180deg' : '0deg' }} />
                  </button>
                </>
              )
            )}
          </span>
        </div>
        {present.length > 1 && !selecting && (
          <div className="dust-filter" role="radiogroup" aria-label="과목">
            {present.map((id) => {
              const s = subjects.find((x) => x.id === id)
              const on = only === id
              return (
                <button key={id ?? 'none'} type="button" role="radio" aria-checked={on} className={`ibtn${on ? ' is-on' : ''}`} {...tip(s?.name ?? '과목 없음')} onClick={() => setOnly(on ? undefined : id)}>
                  <i className={`sdot is-lg${s ? '' : ' is-none'}`} style={s ? { ['--c' as string]: `var(--s-${s.color})` } : undefined} />
                </button>
              )
            })}
          </div>
        )}
      </header>
      {n > 0 && (
        <ul className="dust-list" aria-multiselectable={selecting || undefined}>
          <AnimatePresence initial={false}>
            {list!.map((m) => (
              <Row key={m.id} memo={m} subjects={subjects} archive={archive} selecting={selecting} selected={!!sel?.has(m.id)} onSelect={onSelect} onFocusMove={move} />
            ))}
          </AnimatePresence>
        </ul>
      )}
      {!archive && !selecting && (archivedN ?? 0) > 0 && (
        <p className="dust-foot">
          <button type="button" className="ibtn inum" {...tip('보관함')} aria-label={`보관함 ${archivedN}개`} onClick={() => setArchive(true)}>
            <IconArchive size={18} />
            <span aria-hidden="true">{archivedN}</span>
          </button>
        </p>
      )}
    </div>
  )
}

/** 세로·폰·다른 장소: 아래 시트 */
export function DustSheet({ inlineOnToday }: { inlineOnToday: boolean }) {
  const open = useCapture((s) => s.dustOpen)
  const close = useCapture((s) => s.closeDust)
  const off = useEffectiveMotion() === 'off'
  const show = open && !inlineOnToday
  const drag = useRef<{ y: number } | null>(null)
  return (
    <AnimatePresence>
      {show && (
        <div className="dust-layer" key="dust">
          <div className="dust-catch" onClick={close} />
          <motion.div
            className="dust-sheet"
            role="dialog"
            aria-label="별가루"
            initial={{ y: off ? 0 : '100%' }}
            animate={{ y: 0 }}
            exit={{ y: off ? 0 : '100%' }}
            transition={{ duration: off ? 0 : 0.3, ease: [0.22, 1, 0.36, 1] }}
          >
            <span
              className="sheet-grip"
              aria-hidden="true"
              onPointerDown={(e) => (drag.current = { y: e.clientY })}
              onPointerMove={(e) => {
                if (drag.current && e.clientY - drag.current.y > 40) {
                  drag.current = null
                  close()
                }
              }}
              onPointerUp={() => (drag.current = null)}
            />
            <DustBox variant="sheet" />
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
