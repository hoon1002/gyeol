/**
 * 공용 툴팁 (design-quiet 4-1 · 리더 결정 7). 모두가 이것만 쓴다.
 *
 *   <Tip label="검색" kbd="⌘K"><button …><IconSearch/></button></Tip>     — 자식에 aria-label·data-tip을 붙인다
 *   <button {...tip('검색', { kbd: '⌘K' })}>…</button>                    — 같은 것을 펼쳐 쓰는 꼴
 *
 * 규칙: 글 = aria-label(한 곳에서 정하고 두 곳에 쓴다) · 12자 이하 한 줄 · 높이 24px.
 *  - 마우스 hover 600ms · 키보드 :focus-visible 바로 · 터치/펜 길게 500ms(동작은 실행하지 않고, 떼도 1.5초 더 보인다).
 *  - 지는 때: 떠나고 100ms · Esc · 스크롤 · 누르기. 한 번에 하나.
 *  - 안 뜨는 때: 첫 실행 · 잉크 쓰는 중(:root[data-inking]) · 끌기 중 · :root[data-no-tips].
 *  - 둥근 메뉴가 있는 요소(data-radial)는 길게 누르기를 메뉴에 양보한다.
 * <TipLayer/>는 RootLayout에 한 번만 둔다(전역 위임 — 요소마다 리스너를 달지 않는다).
 */
import { cloneElement, useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react'
import '@/styles/quiet.css'

export type TipSide = 'top' | 'bottom' | 'right' | 'left'

export interface TipOpts {
  /** 단축키 (모노 11px, 예: '⌘K') */
  kbd?: string
  /** 기본: 레일 = 오른쪽, 폰 독 = 위, 상단 바 = 아래, 그 밖 = 위 */
  side?: TipSide
}

/** 펼쳐 쓰는 툴팁 속성: aria-label = 툴팁 글 */
export function tip(label: string, o: TipOpts = {}): Record<string, string> {
  const p: Record<string, string> = { 'aria-label': label, 'data-tip': '' }
  if (o.kbd) p['data-tip-kbd'] = o.kbd
  if (o.side) p['data-tip-side'] = o.side
  return p
}

export function Tip({ label, kbd, side, children }: { label: string; children: ReactElement<Record<string, unknown>> } & TipOpts) {
  return cloneElement(children, tip(label, { kbd, side }))
}

interface Shown {
  el: Element
  text: string
  kbd: string | null
  side: TipSide
  touch: boolean
}

const HOVER_MS = 600
const LONG_MS = 500
const KEEP_AFTER_LONG_MS = 1500

function blocked(): boolean {
  const r = document.documentElement
  return r.hasAttribute('data-onboarding') || r.hasAttribute('data-inking') || r.hasAttribute('data-no-tips')
}

function sideFor(el: Element): TipSide {
  const forced = el.getAttribute('data-tip-side') as TipSide | null
  if (forced) return forced
  if (el.closest('.dock')) return innerWidth >= 600 ? 'right' : 'top'
  if (el.closest('.topbar')) return 'bottom'
  return 'top'
}

function textOf(el: Element): string {
  return el.getAttribute('data-tip') || el.getAttribute('aria-label') || ''
}

export function TipLayer() {
  const [shown, setShown] = useState<Shown | null>(null)
  const [out, setOut] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let pending = 0
    let hideT = 0
    let longT = 0
    let current: Element | null = null
    let suppress: Element | null = null
    let down: { x: number; y: number; el: Element } | null = null

    const clear = () => {
      clearTimeout(pending)
      clearTimeout(longT)
      pending = longT = 0
    }
    const show = (el: Element, touch: boolean) => {
      if (blocked() || !el.isConnected) return
      const text = textOf(el)
      if (!text) return
      clearTimeout(hideT)
      current = el
      setOut(false)
      setShown({ el, text, kbd: el.getAttribute('data-tip-kbd'), side: touch ? 'top' : sideFor(el), touch })
    }
    const hide = (delay = 0) => {
      clearTimeout(hideT)
      const go = () => {
        if (!current) return
        current = null
        setOut(true)
        window.setTimeout(() => setShown((s) => (current ? s : null)), 80)
      }
      if (delay) hideT = window.setTimeout(go, delay)
      else go()
    }

    const onOver = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || e.buttons) return
      const el = (e.target as Element | null)?.closest?.('[data-tip]')
      if (!el) return
      if (el === current) {
        clearTimeout(hideT)
        return
      }
      clearTimeout(pending)
      // 다른 툴팁이 떠 있으면 바로 옮겨 탄다
      if (current) show(el, false)
      else pending = window.setTimeout(() => show(el, false), HOVER_MS)
    }
    const onOut = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return
      const el = (e.target as Element | null)?.closest?.('[data-tip]')
      if (!el) return
      const to = e.relatedTarget as Node | null
      if (to && el.contains(to)) return
      clearTimeout(pending)
      if (el === current) hide(100)
    }
    const onDown = (e: PointerEvent) => {
      clear()
      if (current && !(e.pointerType !== 'mouse' && current.contains(e.target as Node))) hide()
      if (e.pointerType === 'mouse') return
      const el = (e.target as Element | null)?.closest?.('[data-tip]')
      if (!el || el.closest('[data-radial]')) return
      down = { x: e.clientX, y: e.clientY, el }
      longT = window.setTimeout(() => {
        show(el, true)
        suppress = el
      }, LONG_MS)
    }
    const onMove = (e: PointerEvent) => {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) {
        clearTimeout(longT)
        down = null
      }
    }
    const onUp = () => {
      clearTimeout(longT)
      if (down && current === down.el) hide(KEEP_AFTER_LONG_MS)
      down = null
    }
    // 길게 눌러 툴팁을 본 뒤의 click은 동작으로 치지 않는다
    const onClick = (e: MouseEvent) => {
      if (suppress && suppress.contains(e.target as Node)) {
        e.preventDefault()
        e.stopPropagation()
      }
      suppress = null
    }
    const onFocusIn = (e: FocusEvent) => {
      const el = e.target as Element
      if (!el.hasAttribute?.('data-tip')) return
      let fv = false
      try {
        fv = el.matches(':focus-visible')
      } catch {
        fv = false
      }
      if (fv) show(el, false)
    }
    const onFocusOut = (e: FocusEvent) => {
      if (e.target === current) hide()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && current) hide()
    }
    const onScroll = () => {
      clear()
      if (current) hide()
    }
    const onContext = (e: Event) => {
      // 터치 길게 누르기의 기본 메뉴(iOS 콜아웃·안드로이드 문맥 메뉴)는 툴팁 요소에서 막는다
      if (suppress || (down && (e.target as Element)?.closest?.('[data-tip]'))) e.preventDefault()
    }

    document.addEventListener('pointerover', onOver, true)
    document.addEventListener('pointerout', onOut, true)
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('pointermove', onMove, true)
    document.addEventListener('pointerup', onUp, true)
    document.addEventListener('pointercancel', onUp, true)
    document.addEventListener('click', onClick, true)
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', onFocusOut)
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('contextmenu', onContext, true)
    window.addEventListener('scroll', onScroll, { capture: true, passive: true })
    return () => {
      clear()
      clearTimeout(hideT)
      document.removeEventListener('pointerover', onOver, true)
      document.removeEventListener('pointerout', onOut, true)
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('pointermove', onMove, true)
      document.removeEventListener('pointerup', onUp, true)
      document.removeEventListener('pointercancel', onUp, true)
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', onFocusOut)
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('contextmenu', onContext, true)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [])

  // 자리: 대상 둘레 8px(터치는 손가락에 가리지 않게 위 44px), 화면 밖이면 뒤집고 가로는 8px 안으로
  useLayoutEffect(() => {
    const box = boxRef.current
    if (!box || !shown) return
    const r = shown.el.getBoundingClientRect()
    const w = box.offsetWidth
    const h = box.offsetHeight
    const gap = shown.touch ? 44 : 8
    let side = shown.side
    if (side === 'top' && r.top - gap - h < 4) side = 'bottom'
    else if (side === 'bottom' && r.bottom + gap + h > innerHeight - 4) side = 'top'
    else if (side === 'right' && r.right + gap + w > innerWidth - 4) side = 'left'
    else if (side === 'left' && r.left - gap - w < 4) side = 'right'
    let x = side === 'right' ? r.right + gap : side === 'left' ? r.left - gap - w : r.left + r.width / 2 - w / 2
    let y = side === 'top' ? r.top - gap - h : side === 'bottom' ? r.bottom + gap : r.top + r.height / 2 - h / 2
    x = Math.max(8, Math.min(innerWidth - w - 8, x))
    y = Math.max(4, Math.min(innerHeight - h - 4, y))
    box.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`
    box.dataset.side = side
  }, [shown])

  if (!shown) return null
  return (
    <div ref={boxRef} className={`tip${out ? ' is-out' : ''}`} role="tooltip" aria-hidden="true">
      <span>{shown.text}</span>
      {shown.kbd && <kbd>{shown.kbd}</kbd>}
    </div>
  )
}
