/**
 * 설정 시트 (M1 · design-m1 2-1): 장소가 아니라 지금 장소 위에 열린다. 은하는 비행하지 않고 useSkySheet로 어둡고 느리게만.
 * 가로 화면 = 오른쪽 패널(데스크톱 420 · 태블릿 380, 높이 100%), 세로 = 아래 시트 64%, 폰 = 아래 시트 88%.
 * 열기: ⌘K '설정' · 상단 점 3개 · ⌘, / Ctrl+, / ',' (입력 중이 아닐 때) · 주소 /settings.
 * 닫기: Esc · 바깥 누르기 · 닫기 버튼. 열려 있는 동안 Tab을 시트 안에 가두고, 닫으면 연 자리로 포커스를 돌려준다.
 */
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef } from 'react'
import { useSkySheet } from '@/fx'
import { SettingsBody } from '@/screens/Settings'
import { tip } from './Tip'
import { useUi } from '@/stores/ui'
import { isTypingTarget, useEffectiveMotion, useMediaQuery } from './hooks'
import { IconClose } from './icons'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** 어디서나 ⌘, · Ctrl+, · ',' 로 연다/닫는다 */
function useSettingsShortcut() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== ',' || e.altKey || e.shiftKey) return
      const mod = e.metaKey || e.ctrlKey
      if (!mod && isTypingTarget(e.target)) return
      const ui = useUi.getState()
      if (ui.paletteOpen) return
      e.preventDefault()
      if (ui.settingsOpen) ui.closeSettings()
      else ui.openSettings(document.activeElement)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

export function SettingsSheet() {
  const open = useUi((s) => s.settingsOpen)
  useSettingsShortcut()
  useSkySheet(open)
  return <AnimatePresence>{open ? <Sheet key="settings" /> : null}</AnimatePresence>
}

function Sheet() {
  const close = useUi((s) => s.closeSettings)
  const origin = useUi((s) => s.settingsOrigin)
  const level = useEffectiveMotion()
  const off = level === 'off'
  const side = useMediaQuery('(min-width: 600px) and (min-aspect-ratio: 1/1)')
  const panelRef = useRef<HTMLDivElement>(null)

  // 열 때: 뒤 스크롤 잠금 + 시트로 포커스 / 닫을 때: 연 자리로 포커스
  useEffect(() => {
    const root = document.documentElement
    const prev = root.style.overflow
    root.style.overflow = 'hidden'
    const t = setTimeout(() => panelRef.current?.querySelector<HTMLElement>('.sheet-close')?.focus({ preventScroll: true }), 0)
    return () => {
      clearTimeout(t)
      root.style.overflow = prev
      const el = origin as HTMLElement | null
      if (el && typeof el.focus === 'function' && document.contains(el)) el.focus({ preventScroll: true })
    }
  }, [origin])

  // Esc · Tab 가두기 (⌘K 팔레트가 위에 열려 있으면 팔레트 몫)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useUi.getState().paletteOpen) return
      const panel = panelRef.current
      if (!panel) return
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        close()
        return
      }
      if (e.key !== 'Tab') return
      const list = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement)
      if (!list.length) return
      const first = list[0]!
      const last = list[list.length - 1]!
      const inside = panel.contains(document.activeElement)
      if (e.shiftKey && (document.activeElement === first || !inside)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [close])

  const enter = side ? { x: off ? 0 : '100%' } : { y: off ? 0 : '100%' }
  const rest = side ? { x: 0 } : { y: 0 }

  return (
    <div className={`sheet-layer ${side ? 'is-side' : 'is-bottom'}`}>
      <motion.div
        className="settings-scrim"
        aria-hidden="true"
        onClick={close}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: off ? 0 : 0.2 }}
      />
      <motion.div
        ref={panelRef}
        className="settings-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        initial={enter}
        animate={rest}
        exit={enter}
        transition={{ duration: off ? 0 : 0.34, ease: [0.22, 1, 0.36, 1] }}
      >
        {!side && <span className="sheet-grip" aria-hidden="true" />}
        <header className="sheet-head">
          <h2 id="settings-title" className="sr-only">설정</h2>
          <button type="button" className="icon-btn ghost sheet-close" {...tip('닫기', { kbd: 'esc' })} onClick={close}>
            <IconClose size={18} />
          </button>
        </header>
        <div className="sheet-body">
          <SettingsBody />
        </div>
      </motion.div>
    </div>
  )
}
