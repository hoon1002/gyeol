/** 작은 과목 팝오버 (메모 칸 · 별가루함 'S') — 과목 없음 + 과목들. ↑↓ · Enter · Esc */
import { useEffect, useRef } from 'react'
import type { Subject } from '@/db/schema'
import { pushLayer } from '@/shell/layers'
import { COLOR_NAME } from './slots'

export function SubjectPicker({ subjects, value, onPick, onClose, className = '' }: { subjects: Subject[]; value: string | null; onPick: (id: string | null) => void; onClose: () => void; className?: string }) {
  const ref = useRef<HTMLUListElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => pushLayer({ id: 'subject-picker', close: () => closeRef.current(), el: ref.current }), [])
  useEffect(() => {
    const el = ref.current
    el?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus({ preventScroll: true })
    const onDown = (e: PointerEvent) => {
      if (el && !el.contains(e.target as Node) && !(e.target as HTMLElement).closest('.memo-chip, .dust-chip')) onClose()
    }
    window.addEventListener('pointerdown', onDown, true)
    return () => window.removeEventListener('pointerdown', onDown, true)
  }, [onClose])
  const opts: Array<Subject | null> = [null, ...subjects]
  return (
    <ul
      ref={ref}
      className={`subj-pop ${className}`}
      role="listbox"
      aria-label="과목"
      onKeyDown={(e) => {
        const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('button') ?? [])
        const i = items.indexOf(document.activeElement as HTMLElement)
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault()
          items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          onClose()
        }
      }}
    >
      {opts.map((s) => (
        <li key={s?.id ?? 'none'}>
          <button type="button" role="option" aria-selected={(s?.id ?? null) === value} aria-label={s ? `${s.name} · ${COLOR_NAME[s.color]}` : '과목 없음'} onClick={() => onPick(s?.id ?? null)}>
            <i style={{ background: s ? `var(--s-${s.color})` : 'transparent', borderColor: s ? 'transparent' : 'var(--text-3)' }} aria-hidden="true" />
            {s ? s.name : '과목 없음'}
          </button>
        </li>
      ))}
    </ul>
  )
}
