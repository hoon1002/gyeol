/**
 * 화면 공용 부품 — "한 화면 한 초점" (design-v2 2장).
 * 초점 문장(Hahmlet 600) 1 + 인주 주 버튼 1 + 조용한 동작 ≤1 + 주변부 ≤3(상자 없이 글자만).
 * 주변부 항목은 버튼: 누르면 그 자리에서 선반이 펼쳐진다(한 번에 하나, 최대 5줄, Esc·바깥 누르면 닫힘).
 */
import { AnimatePresence, LayoutGroup, motion } from 'motion/react'
import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react'
import { RevealText } from '@/fx'
import type { Peri } from '@/lib/situation'
import { IconArrow } from '@/shell/icons'
import { useEffectiveMotion } from '@/shell/hooks'

export const GENTLE = { type: 'spring' as const, stiffness: 170, damping: 26 }

/* ---------- 초점 영역 ---------- */

export function Hero({
  children,
  knotRef,
  className = '',
  label,
  variant = 'split',
}: {
  children: ReactNode
  knotRef?: RefObject<HTMLSpanElement | null>
  className?: string
  label?: string
  /** split: 가로 화면에서 글은 왼쪽·옹이는 오른쪽 / center: 가운데 */
  variant?: 'split' | 'center' | 'low'
}) {
  return (
    <section className={`hero hero-${variant} ${className}`} aria-label={label}>
      <span className="knot-anchor" ref={knotRef} aria-hidden="true" />
      <LayoutGroup>
        <div className="hero-col">{children}</div>
      </LayoutGroup>
    </section>
  )
}

/** 레이아웃이 바뀔 때(선반 열림) 위치만 부드럽게 따라가는 블록 */
export function Block({ children, className }: { children: ReactNode; className?: string }) {
  const level = useEffectiveMotion()
  if (level !== 'rich') return <div className={className}>{children}</div>
  return (
    <motion.div layout="position" transition={GENTLE} className={className}>
      {children}
    </motion.div>
  )
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="eyebrow">{children}</p>
}

/** 초점 문장 2줄 (줄 마스크 등장, swapKey가 바뀌면 나감 → 들어옴) */
export function FocusLines({ lines, swapKey, as = 'h1', className = '' }: { lines: ReactNode[]; swapKey?: string | number; as?: 'h1' | 'h2'; className?: string }) {
  return <RevealText as={as} className={`focus-lines ${className}`} lines={lines} swapKey={swapKey} stagger={90} />
}

export function PrimaryButton({ children, onClick, arrow = false, disabled }: { children: ReactNode; onClick?: (el: HTMLButtonElement) => void; arrow?: boolean; disabled?: boolean }) {
  return (
    <button type="button" className="btn-primary" disabled={disabled} onClick={(e) => onClick?.(e.currentTarget)}>
      <span>{children}</span>
      {arrow && <IconArrow size={18} />}
    </button>
  )
}

export function QuietButton({ children, onClick }: { children: ReactNode; onClick?: (el: HTMLButtonElement) => void }) {
  return (
    <button type="button" className="btn-quiet" onClick={(e) => onClick?.(e.currentTarget)}>
      {children}
    </button>
  )
}

/** 주 동작 + 조용한 동작 줄. swapKey가 바뀌면 +360ms 뒤 다시 페이드인 */
export function Actions({ children, swapKey }: { children: ReactNode; swapKey?: string | number }) {
  return (
    <Block className="actions-wrap">
      <div className="actions enter enter-1" key={swapKey}>
        {children}
      </div>
    </Block>
  )
}

/* ---------- 주변부 + 선반 ---------- */

export function Periphery({ items, swapKey, extra }: { items: Peri[]; swapKey?: string | number; extra?: ReactNode }) {
  const [open, setOpen] = useState<string | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const shelfId = useId()
  const level = useEffectiveMotion()

  useEffect(() => setOpen(null), [swapKey])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(null)
        wrapRef.current?.querySelector<HTMLButtonElement>('[aria-expanded="true"]')?.focus()
      }
    }
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(null)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onDown)
    }
  }, [open])

  if (!items.length && !extra) return null
  const cur = items.find((p) => p.id === open) ?? null
  const off = level === 'off'

  return (
    <div ref={wrapRef} className="peri-wrap">
      <Block>
        <div className="peri enter enter-2" key={swapKey}>
          {items.map((p) => (
            <button
              key={p.id}
              type="button"
              className="peri-item"
              aria-expanded={open === p.id}
              aria-controls={shelfId}
              onClick={() => setOpen(open === p.id ? null : p.id)}
            >
              <i style={{ background: p.color }} aria-hidden="true" />
              {p.label} <b>{p.value}</b>
            </button>
          ))}
          {extra}
        </div>
      </Block>
      <div id={shelfId} className="shelf-slot">
        <AnimatePresence mode="wait" initial={false}>
          {cur && (
            <motion.ul
              key={cur.id}
              className="shelf"
              initial={{ opacity: 0, y: off ? 0 : -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: off ? 0 : -4, transition: { duration: off ? 0 : 0.14 } }}
              transition={off ? { duration: 0 } : GENTLE}
            >
              {cur.shelf.slice(0, 5).map((r, i) => (
                <li key={i}>
                  <span className="shelf-k">{r.k}</span>
                  <span className="shelf-v">
                    {r.color && <i style={{ background: r.color }} aria-hidden="true" />}
                    {r.v}
                  </span>
                </li>
              ))}
            </motion.ul>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

/* ---------- 스크롤 아래 장 ---------- */

export function Chapter({ id, eyebrow, title, children, className = '' }: { id?: string; eyebrow: string; title: ReactNode[]; children?: ReactNode; className?: string }) {
  return (
    <section className={`chapter ${className}`} id={id} aria-label={eyebrow}>
      <Reveal>
        <p className="eyebrow">{eyebrow}</p>
      </Reveal>
      {title.length > 0 && <RevealText as="h2" className="chapter-title" lines={title} trigger="inView" stagger={90} />}
      {children && <Reveal delay={1}>{children}</Reveal>}
    </section>
  )
}

/** 화면에 들어오면 한 번 떠오른다 (opacity·transform만) */
export function Reveal({ children, delay = 0, className = '' }: { children: ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (!('IntersectionObserver' in window)) {
      setSeen(true)
      return
    }
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) {
          setSeen(true)
          io.disconnect()
        }
      },
      { threshold: 0.15 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return (
    <div ref={ref} className={`rv${seen ? ' in' : ''} ${className}`} style={{ ['--d' as string]: delay }}>
      {children}
    </div>
  )
}

/** 빈 상태: 문장 2줄 + 동작 1 */
export function EmptyState({ lines, action, onAction, children }: { lines: [string, string]; action?: string; onAction?: (el: HTMLButtonElement) => void; children?: ReactNode }) {
  return (
    <div className="empty">
      <FocusLines as="h1" lines={[lines[0]]} />
      <p className="meta">{lines[1]}</p>
      {children}
      {action && (
        <div className="actions enter enter-1">
          <PrimaryButton onClick={onAction}>{action}</PrimaryButton>
        </div>
      )}
    </div>
  )
}
