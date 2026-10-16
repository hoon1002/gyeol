/** 테마 적용 · 원형 리빌 (design.md 6-1 '테마 전환': 680ms in-out, View Transitions) */
import type { ThemePref } from '@/stores/settings'

export type Eff = 'dark' | 'light'

const THEME_COLOR: Record<Eff, string> = { dark: '#070A14', light: '#F3F1EC' }

export function systemTheme(): Eff {
  try {
    return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

export function resolveTheme(pref: ThemePref): Eff {
  return pref === 'system' ? systemTheme() : pref
}

export function applyTheme(eff: Eff): void {
  const root = document.documentElement
  if (root.dataset.theme !== eff) root.dataset.theme = eff
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta && meta.getAttribute('content') !== THEME_COLOR[eff]) meta.setAttribute('content', THEME_COLOR[eff])
}

type VTDoc = Document & {
  startViewTransition?: (cb: () => void) => { ready: Promise<void>; finished: Promise<void> }
}

/**
 * 테마를 바꾼다. 모션이 켜져 있고 브라우저가 지원하면 origin에서 원형으로 번진다.
 * set: 스토어 갱신(React 반영은 나중이어도 된다 — DOM은 여기서 바로 바꾼다).
 */
export function switchTheme(pref: ThemePref, set: (p: ThemePref) => void, opts: { origin?: Element | null; animate: boolean; locked?: Eff | null }): void {
  const next = opts.locked ?? resolveTheme(pref)
  const cur = (document.documentElement.dataset.theme as Eff | undefined) ?? 'dark'
  const d = document as VTDoc
  if (!opts.animate || next === cur || typeof d.startViewTransition !== 'function') {
    set(pref)
    applyTheme(next)
    return
  }
  let x = innerWidth / 2
  let y = innerHeight / 2
  if (opts.origin) {
    const r = opts.origin.getBoundingClientRect()
    x = r.left + r.width / 2
    y = r.top + r.height / 2
  }
  const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y))
  const root = document.documentElement
  root.classList.add('theme-vt')
  try {
    const vt = d.startViewTransition(() => {
      applyTheme(next)
      set(pref)
    })
    vt.ready
      .then(() => {
        root.animate(
          { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
          { duration: 680, easing: 'cubic-bezier(.65,0,.35,1)', pseudoElement: '::view-transition-new(root)' },
        )
      })
      .catch(() => {})
    vt.finished.finally(() => root.classList.remove('theme-vt')).catch(() => {})
  } catch {
    root.classList.remove('theme-vt')
    set(pref)
    applyTheme(next)
  }
}
