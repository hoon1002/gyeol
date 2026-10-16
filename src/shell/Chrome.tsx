/**
 * 셸 v2 크롬 (design-v2 3장): 상단 바 · 떠 있는 독/레일 · 과목 렌즈 · 토스트.
 * 상시 내비 표면은 독 하나. 아래로 스크롤하면 상단 바·독이 숨고, 위로 올리면 나타난다.
 */
import { useRouterState } from '@tanstack/react-router'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, type MouseEvent } from 'react'
import { useProfile, useSubjects } from '@/db/hooks'
import { useSettings } from '@/stores/settings'
import { useUi } from '@/stores/ui'
import { useEffectiveMotion, useGo, useIsPhone, isTypingTarget } from './hooks'
import { IconChevron, IconCmd, IconSearch, Symbol } from './icons'
import { SPACES, spaceOf, type SpacePath } from './spaces'

function usePath(): string {
  return useRouterState({ select: (s) => s.location.pathname })
}

/** 링크 클릭을 결 와이프 이동으로 (수정 키를 누르면 브라우저 기본 동작) */
function useLinkNav() {
  const go = useGo()
  return (to: SpacePath) => (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    void go(to, e.currentTarget)
  }
}

/* ---------- 상단 바 ---------- */

export function TopBar() {
  const path = usePath()
  const space = spaceOf(path)
  const hidden = useUi((s) => s.scrollHidden || s.chromeHidden)
  const openPalette = useUi((s) => s.openPalette)
  const profile = useProfile()
  const nav = useLinkNav()

  return (
    <header className={`topbar${hidden ? ' is-hidden' : ''}`} inert={hidden ? true : undefined}>
      <div className="topbar-here">
        <a href="/" className="topbar-sym" aria-label="결 · 오늘로" onClick={nav('/')}>
          <Symbol size={26} />
        </a>
        <span className="topbar-brand" aria-hidden="true">결</span>
        <span className="topbar-dot" aria-hidden="true">·</span>
        <span className="topbar-name">{space.name}</span>
      </div>
      <LensPill />
      <div className="topbar-right">
        <button type="button" className="cmdk-wide" onClick={(e) => openPalette('', e.currentTarget)}>
          <IconSearch size={16} />
          <span className="sr-only">검색·명령</span>
          <span className="kbd-pair" aria-hidden="true"><span className="kbd">⌘</span><span className="kbd">K</span></span>
        </button>
        <button type="button" className="icon-btn cmdk-small" aria-label="검색·명령 열기 (⌘K)" onClick={(e) => openPalette('', e.currentTarget)}>
          <IconCmd size={19} />
        </button>
        <a href="/settings" className={`avatar${path === '/settings' ? ' is-on' : ''}`} aria-label={`${profile.name} · 설정`} onClick={nav('/settings')}>
          <span aria-hidden="true">{profile.initial}</span>
        </a>
      </div>
    </header>
  )
}

/* ---------- 과목 렌즈 ---------- */

function LensPill() {
  const subjects = useSubjects() ?? []
  const lens = useSettings((s) => s.lens)
  const setLens = useSettings((s) => s.setLens)
  const open = useUi((s) => s.lensOpen)
  const setOpen = useUi((s) => s.setLensOpen)
  const phone = useIsPhone()
  const level = useEffectiveMotion()
  const wrapRef = useRef<HTMLDivElement>(null)
  const pillRef = useRef<HTMLButtonElement>(null)
  const current = subjects.find((s) => s.id === lens) ?? null

  // 단축키 L · Esc · 바깥 누르면 닫힘
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && useUi.getState().lensOpen) {
        setOpen(false)
        pillRef.current?.focus()
      }
      if ((e.key === 'l' || e.key === 'L') && !e.metaKey && !e.ctrlKey && !e.altKey && !isTypingTarget(e.target) && !useUi.getState().paletteOpen) {
        e.preventDefault()
        setOpen(!useUi.getState().lensOpen)
      }
    }
    const onDown = (e: PointerEvent) => {
      if (!useUi.getState().lensOpen) return
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onDown)
    }
  }, [setOpen])

  const pick = (id: string | null) => {
    setLens(id)
    setOpen(false)
    pillRef.current?.focus()
  }
  const off = level === 'off'
  const list = (
    <ul className="lens-list" role="listbox" aria-label="과목 렌즈">
      {[null, ...subjects].map((s) => {
        const id = s?.id ?? null
        const on = id === lens
        return (
          <li key={id ?? 'all'}>
            <button type="button" role="option" aria-selected={on} className={`lens-opt${on ? ' is-on' : ''}`} onClick={() => pick(id)}>
              <i style={{ background: s ? `var(--s-${s.color})` : 'var(--text-3)' }} />
              {s ? s.name : '전체'}
            </button>
          </li>
        )
      })}
    </ul>
  )

  return (
    <div className="lens" ref={wrapRef}>
      <button
        ref={pillRef}
        type="button"
        className="lens-pill"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`과목 렌즈: ${current?.name ?? '전체'}`}
        onClick={() => setOpen(!open)}
      >
        <i style={{ background: current ? `var(--s-${current.color})` : 'var(--text-3)' }} />
        <span>{current?.short ?? '전체'}</span>
        <IconChevron size={14} />
      </button>
      <AnimatePresence>
        {open &&
          (phone ? (
            <motion.div key="sheet" className="lens-sheet-wrap">
              <motion.div className="sheet-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: off ? 0 : 0.18 }} onClick={() => setOpen(false)} />
              <motion.div
                className="lens-sheet"
                role="dialog"
                aria-label="과목 렌즈"
                initial={{ y: off ? 0 : '100%' }}
                animate={{ y: 0 }}
                exit={{ y: off ? 0 : '100%' }}
                transition={{ duration: off ? 0 : 0.32, ease: [0.22, 1, 0.36, 1] }}
              >
                <span className="sheet-grip" aria-hidden="true" />
                <p className="sheet-title">과목 렌즈</p>
                {list}
              </motion.div>
            </motion.div>
          ) : (
            <motion.div
              key="pop"
              className="lens-pop"
              initial={{ opacity: 0, y: off ? 0 : -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: off ? 0 : -4 }}
              transition={{ duration: off ? 0 : 0.24, ease: [0.22, 1, 0.36, 1] }}
            >
              {list}
            </motion.div>
          ))}
      </AnimatePresence>
    </div>
  )
}

/* ---------- 떠 있는 독 / 레일 ---------- */

export function Dock() {
  const path = usePath()
  const hidden = useUi((s) => s.scrollHidden || s.chromeHidden)
  const openPalette = useUi((s) => s.openPalette)
  const nav = useLinkNav()
  return (
    <nav className={`dock${hidden ? ' is-hidden' : ''}`} aria-label="공간" inert={hidden ? true : undefined}>
      {SPACES.filter((s) => s.dock).map((s) => {
        const Icon = s.icon
        const on = path === s.path
        return (
          <a
            key={s.path}
            href={s.path}
            className={`dock-item${s.phoneHidden ? ' dock-g' : ''}`}
            aria-current={on ? 'page' : undefined}
            aria-label={s.name}
            onClick={nav(s.path)}
          >
            <Icon size={22} />
            <span className="dock-label" aria-hidden="true">{s.name}</span>
          </a>
        )
      })}
      <span className="dock-sep" aria-hidden="true" />
      <button type="button" className="dock-item" aria-label="검색·명령 (⌘K)" onClick={(e) => openPalette('', e.currentTarget)}>
        <IconCmd size={22} />
        <span className="dock-label" aria-hidden="true">검색·명령 <span className="kbd">⌘K</span></span>
      </button>
    </nav>
  )
}

/* ---------- 토스트 ---------- */

export function Toaster() {
  const toast = useUi((s) => s.toast)
  const clear = useUi((s) => s.clearToast)
  const level = useEffectiveMotion()
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(clear, 2800)
    return () => clearTimeout(t)
  }, [toast, clear])
  const off = level === 'off'
  return (
    <div className="toast-wrap" role="status" aria-live="polite">
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.id}
            className="toast"
            initial={{ opacity: 0, y: off ? 0 : -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: off ? 0 : -6 }}
            transition={{ duration: off ? 0 : 0.26, ease: [0.22, 1, 0.36, 1] }}
          >
            {toast.color && <i style={{ background: toast.color }} aria-hidden="true" />}
            {toast.text}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
