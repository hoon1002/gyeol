/**
 * 셸 v4 크롬 (design-m1 2-0): 상단 바(심볼 · 과목 렌즈 · ⌘K · 점 3개 = 설정 시트) · 독/레일 · 토스트.
 * 너비 ≥ 600: 왼쪽 레일에 장소 6. 폰(< 600): 아래 독 4(오늘 · 노트 · 복습 · 집중) + ⌘K.
 * 지도는 노트 위 '노트 | 지도' 토글, 계획은 오늘 맨 아래 줄. 아래로 스크롤하면 상단 바·독이 숨는다.
 */
import { useRouterState } from '@tanstack/react-router'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, type MouseEvent } from 'react'
import { useSubjects } from '@/db/hooks'
import { useSettings } from '@/stores/settings'
import { useUi } from '@/stores/ui'
import { useEffectiveMotion, useGo, useIsPhone, useIsRail, isTypingTarget } from './hooks'
import { IconCmd, IconMore, IconPlus, IconSearch, Symbol } from './icons'
import { openMemoFromButton } from '@/capture/MemoSheet'
import { tip } from './Tip'
import { Hint, HINT_ART } from './Hint'

/** H7: 데스크톱(pointer: fine)은 N 키 그림, 터치는 ＋ 톡 그림 */
const plusArt = HINT_ART.H7
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
  const openSettings = useUi((s) => s.openSettings)
  const settingsOpen = useUi((s) => s.settingsOpen)
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
        <button type="button" className="icon-btn cmdk-one" {...tip('검색', { kbd: '⌘K' })} onClick={(e) => openPalette('', e.currentTarget)}>
          <IconSearch size={19} />
        </button>
        <button
          type="button"
          className="icon-btn more-btn"
          {...tip('설정', { kbd: '⌘,' })}
          aria-haspopup="dialog"
          aria-expanded={settingsOpen}
          onClick={(e) => openSettings(e.currentTarget)}
        >
          <IconMore size={20} />
        </button>
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
        {...tip(`과목 렌즈 · ${current?.short ?? '전체'}`)}
        onClick={() => setOpen(!open)}
      >
        <i className={`sdot is-lg${current ? '' : ' is-none'}`} style={current ? { ['--c' as string]: `var(--s-${current.color})` } : undefined} />
        <Hint id="H9" side="bottom" />
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

/** 폰 독에 없는 장소는 독의 어느 칸을 켜 두나 (지도 → 노트, 계획 → 오늘) */
const PHONE_HOME: Partial<Record<string, SpacePath>> = { '/map': '/notes', '/plan': '/' }

export function Dock() {
  const path = usePath()
  const hidden = useUi((s) => s.scrollHidden || s.chromeHidden)
  const openPalette = useUi((s) => s.openPalette)
  const rail = useIsRail()
  const nav = useLinkNav()
  const here = rail ? path : (PHONE_HOME[path] ?? path)
  const plus = (
    <button key="plus" type="button" className="dock-item dock-plus" {...tip('메모', { kbd: 'N' })} onClick={(e) => openMemoFromButton(e.currentTarget, (e.nativeEvent as PointerEvent).pointerType)}>
      <IconPlus size={22} />
      <Hint id="H7" art={plusArt} />
    </button>
  )
  // 폰 독: 오늘 · 노트 · ＋ · 복습 · 집중 (＋가 가운데), 레일: 장소 6 아래 맨 끝에 ＋
  const items = SPACES.map((s) => {
        const Icon = s.icon
        const on = here === s.path
        return (
          <a
            key={s.path}
            href={s.path}
            className={`dock-item${s.phoneDock ? '' : ' dock-rail-only'}`}
            aria-current={on ? 'page' : undefined}
            {...tip(s.name)}
            onClick={nav(s.path)}
          >
            <Icon size={22} />
          </a>
        )
      })
  const phoneMid = rail ? -1 : items.findIndex((_, i) => SPACES.slice(0, i + 1).filter((x) => x.phoneDock).length === 2)
  const list = rail ? [...items, <span key="sep" className="dock-sep" aria-hidden="true" />, plus] : [...items.slice(0, phoneMid + 1), plus, ...items.slice(phoneMid + 1)]
  return (
    <nav className={`dock${hidden ? ' is-hidden' : ''}`} aria-label="장소" inert={hidden ? true : undefined}>
      {list}
      <span className="dock-sep dock-phone-only" aria-hidden="true" />
      <button type="button" className="dock-item dock-phone-only" {...tip('검색', { kbd: '⌘K' })} onClick={(e) => openPalette('', e.currentTarget)}>
        <IconCmd size={22} />
      </button>
    </nav>
  )
}

/* ---------- 토스트 → 스크린리더 알림 (design-quiet 0장: 토스트는 모두 뺀다) ---------- */

/** useUi.showToast(…)는 그대로 부를 수 있다. 화면에는 보이지 않고 aria-live로 같은 말을 읽어 준다 */
export function Toaster() {
  const toast = useUi((s) => s.toast)
  const clear = useUi((s) => s.clearToast)
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(clear, 2800)
    return () => clearTimeout(t)
  }, [toast, clear])
  return (
    <div className="sr-only" role="status" aria-live="polite">
      {toast?.text ?? ''}
    </div>
  )
}
