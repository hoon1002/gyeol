/**
 * 별가루함 (design-m2 2장). 가로 화면의 오늘 = 오늘 글 구역을 그 자리에서 바꾼다(inline),
 * 그 밖(세로·폰, 다른 장소에서 ⌘K로 열 때) = 아래 시트(세로 56% · 폰 60%). 하늘은 어둡게 하지 않고 공전만 ×0.3(useFieldPause).
 * 줄 키: ↑↓ 이동 · Enter 노트로 · T 할 일로 · E 보관 · S 과목 바꾸기. 맨 아래 '보관함 ›'(되돌리기).
 */
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useFieldPause } from '@/fx'
import { useAssetUrl, useMemos, useSubjects } from '@/db/hooks'
import type { Memo, Subject } from '@/db/schema'
import { fmtHM } from '@/lib/time'
import { useEffectiveMotion, useIsPhone } from '@/shell/hooks'
import { useCapture } from './store'
import { fileMemo, restoreMemo, setMemoSubject } from './file'
import { SubjectPicker } from './SubjectPicker'
import '@/styles/capture.css'

function Row({ memo, subjects, archive, onFocusMove }: { memo: Memo; subjects: Subject[]; archive: boolean; onFocusMove: (el: HTMLElement, d: 1 | -1) => void }) {
  const url = useAssetUrl(memo.assetId)
  const phone = useIsPhone()
  const [open, setOpen] = useState(false)
  const [pick, setPick] = useState(false)
  const s = subjects.find((x) => x.id === memo.subjectId) ?? null
  const act = (to: 'note' | 'task' | 'archive') => void fileMemo(memo, to)
  const onKey = (e: KeyboardEvent<HTMLLIElement>) => {
    if (e.target !== e.currentTarget || e.nativeEvent.isComposing) return
    const k = e.key.toLowerCase()
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      onFocusMove(e.currentTarget, e.key === 'ArrowDown' ? 1 : -1)
    } else if (e.metaKey || e.ctrlKey || e.altKey) {
      return
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
    } else if (k === 's') {
      e.preventDefault()
      setPick(true)
    }
  }
  const label = `${memo.text || '사진 메모'}, ${s?.name ?? '과목 없음'}, ${fmtHM(memo.createdAt)}`
  return (
    <motion.li
      className={`dust-row${open ? ' is-open' : ''}`}
      tabIndex={0}
      aria-label={label}
      onKeyDown={onKey}
      onClick={() => phone && setOpen((v) => !v)}
      initial={false}
      exit={{ height: 0, opacity: 0, paddingTop: 0, paddingBottom: 0 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="dust-main">
        <p className="dust-text">{memo.text || '사진'}</p>
        <p className="dust-meta mono">
          <span className="dust-chip-wrap">
            <button type="button" className="dust-subj" tabIndex={-1} onClick={(e) => { e.stopPropagation(); setPick(true) }}>
              {s && <i style={{ background: `var(--s-${s.color})` }} aria-hidden="true" />}
              {s?.name ?? '과목 없음'}
            </button>
            {pick && (
              <SubjectPicker
                className="is-down"
                subjects={subjects}
                value={memo.subjectId ?? null}
                onPick={(id) => {
                  void setMemoSubject(memo.id, id)
                  setPick(false)
                }}
                onClose={() => setPick(false)}
              />
            )}
          </span>
          <span> · {fmtHM(memo.createdAt)}</span>
        </p>
      </div>
      {url && <img className="dust-img" src={url} alt="" />}
      <div className="dust-acts" onClick={(e) => e.stopPropagation()}>
        {archive ? (
          <button type="button" className="btn-ghost small" onClick={() => void restoreMemo(memo.id)}>되돌리기</button>
        ) : (
          <>
            <button type="button" className="btn-ghost small" onClick={() => act('note')}>노트로</button>
            <button type="button" className="btn-ghost small" onClick={() => act('task')}>할 일로</button>
            <button type="button" className="btn-ghost small" onClick={() => act('archive')}>보관</button>
          </>
        )}
      </div>
    </motion.li>
  )
}

export function DustBox({ variant }: { variant: 'inline' | 'sheet' }) {
  const archive = useCapture((s) => s.archive)
  const setArchive = useCapture((s) => s.setArchive)
  const close = useCapture((s) => s.closeDust)
  const list = useMemos(archive ? 'archived' : 'inbox')
  const subjects = useSubjects() ?? []
  const ref = useRef<HTMLDivElement>(null)
  useFieldPause(true, 'overlay')

  useEffect(() => {
    const t = setTimeout(() => ref.current?.querySelector<HTMLElement>('.dust-row, .dust-back')?.focus({ preventScroll: true }), 30)
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (document.querySelector('.subj-pop')) return
      e.preventDefault()
      if (useCapture.getState().archive) setArchive(false)
      else close()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(t)
      window.removeEventListener('keydown', onKey)
    }
  }, [archive, close, setArchive])

  const move = (el: HTMLElement, d: 1 | -1) => {
    const rows = Array.from(ref.current?.querySelectorAll<HTMLElement>('.dust-row') ?? [])
    const i = rows.indexOf(el)
    ;(rows[i + d] ?? rows[i - d] ?? ref.current?.querySelector<HTMLElement>('.dust-foot button'))?.focus({ preventScroll: true })
  }
  const n = list?.length ?? 0

  return (
    <div ref={ref} className={`dust dust-${variant}`} role="region" aria-label={archive ? '보관함' : '별가루'}>
      <header className="dust-head">
        {variant === 'inline' && (
          <button type="button" className="dust-back mono" onClick={() => (archive ? setArchive(false) : close())}>
            ‹ {archive ? '별가루' : '오늘'}
          </button>
        )}
        {variant === 'sheet' && archive && (
          <button type="button" className="dust-back mono" onClick={() => setArchive(false)}>‹ 별가루</button>
        )}
        <h2 className="dust-h">
          {archive ? '보관함' : '별가루'} <span className="dust-n mono">{list ? (n ? n : '비었어요') : ''}</span>
        </h2>
      </header>
      {n > 0 && (
        <ul className="dust-list">
          <AnimatePresence initial={false}>
            {list!.map((m) => (
              <Row key={m.id} memo={m} subjects={subjects} archive={archive} onFocusMove={move} />
            ))}
          </AnimatePresence>
        </ul>
      )}
      {!archive && (
        <p className="dust-foot">
          <button type="button" className="quiet-line mono" onClick={() => setArchive(true)}>보관함 ›</button>
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
