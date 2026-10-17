/** 초점 문장의 동작(SitAction)을 실제 이동·명령으로 */
import { useCallback, useEffect, useState } from 'react'
import { seedSample } from '@/db/seed'
import type { SitAction } from '@/lib/situation'
import { useGo, useEffectiveMotion } from '@/shell/hooks'
import { useSettings } from '@/stores/settings'
import { useUi } from '@/stores/ui'

export function useSitAction() {
  const go = useGo()
  const level = useEffectiveMotion()
  return useCallback(
    (a: SitAction, el?: Element | null) => {
      const ui = useUi.getState()
      switch (a.kind) {
        case 'go':
          void go(a.to, el)
          break
        case 'focus':
          ui.setFocusIntent({ minutes: a.minutes, subjectId: a.subjectId, autostart: true })
          void go('/focus', el)
          break
        case 'review':
          ui.setReviewIntent(true)
          void go('/review', el)
          break
        case 'note':
          ui.setNoteFocusId(a.noteId)
          void go('/notes', el)
          if (a.record) ui.showToast('M2에서 열림')
          break
        case 'scroll':
          document.getElementById(a.id)?.scrollIntoView({ behavior: level === 'off' ? 'auto' : 'smooth', block: 'start' })
          break
        case 'seed':
          void seedSample().then(() => {
            useSettings.getState().setClock('live')
            ui.showToast('샘플 넣음')
          })
          break
      }
    },
    [go, level],
  )
}

/** 과목 색 토큰의 실제 값 (SVG·WebGL에 넘길 때). 테마가 바뀌면 다시 읽는다. */
const KEYS = ['phys', 'math', 'chem', 'bio', 'econ', 'writing', 'eng', 'hist', 'accent', 'text-3', 'border-strong'] as const
export type ColorKey = (typeof KEYS)[number]

export function useResolvedColors(): Record<ColorKey, string> {
  const theme = useSettings((s) => s.theme)
  const [colors, setColors] = useState<Record<ColorKey, string>>(() => read())
  useEffect(() => {
    // data-theme이 바뀌는 것을 직접 지켜본다(시스템 테마·집중 화면 강제 다크 포함)
    const update = () => setColors(read())
    update()
    const mo = new MutationObserver(update)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => mo.disconnect()
  }, [theme])
  return colors
}

function read(): Record<ColorKey, string> {
  const cs = typeof document !== 'undefined' ? getComputedStyle(document.documentElement) : null
  const out = {} as Record<ColorKey, string>
  KEYS.forEach((k) => {
    const name = k === 'accent' || k === 'text-3' || k === 'border-strong' ? `--${k}` : `--s-${k}`
    out[k] = cs?.getPropertyValue(name).trim() || '#888'
  })
  return out
}
