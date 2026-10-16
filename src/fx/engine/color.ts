import type { ThemeName } from '../types'

/** rgba 0..1 (비-프리멀티플라이) */
export type RGBA = [number, number, number, number]

let probe: HTMLSpanElement | null = null
let ctx2d: CanvasRenderingContext2D | null = null

function probeEl(): HTMLSpanElement {
  if (!probe || !probe.isConnected) {
    probe = document.createElement('span')
    probe.setAttribute('aria-hidden', 'true')
    probe.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none'
    document.body.appendChild(probe)
  }
  return probe
}

function parseRgbString(s: string): RGBA | null {
  const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(s.trim())
  if (!m) return null
  let a = 1
  if (m[4] != null) a = m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4])
  return [Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255, a]
}

/** 어떤 CSS 색(var(), color-mix(), oklch() 포함)이든 rgba로. 실패하면 null */
export function resolveColor(css: string | null | undefined): RGBA | null {
  if (!css || typeof document === 'undefined') return null
  const direct = parseRgbString(css)
  if (direct) return direct
  try {
    const el = probeEl()
    el.style.color = ''
    el.style.color = css
    if (!el.style.color) return null
    const computed = getComputedStyle(el).color
    const parsed = parseRgbString(computed)
    if (parsed) return parsed
    // oklch(), color(srgb …) 등은 1px 캔버스로 구운다
    if (!ctx2d) {
      const c = document.createElement('canvas')
      c.width = c.height = 1
      ctx2d = c.getContext('2d', { willReadFrequently: true })
    }
    if (!ctx2d) return null
    ctx2d.clearRect(0, 0, 1, 1)
    ctx2d.fillStyle = '#000'
    ctx2d.fillStyle = computed
    ctx2d.fillRect(0, 0, 1, 1)
    const d = ctx2d.getImageData(0, 0, 1, 1).data
    const a = d[3]! / 255
    if (a <= 0) return [0, 0, 0, 0]
    return [d[0]! / 255, d[1]! / 255, d[2]! / 255, a]
  } catch {
    return null
  }
}

export interface Palette {
  minor: RGBA
  major: RGBA
  accent: RGBA
}

/** design-v2 §5-3 값 — CSS 변수가 없을 때 쓴다 */
const DEFAULTS: Record<ThemeName, Palette> = {
  dark: {
    minor: [243 / 255, 241 / 255, 236 / 255, 0.1],
    major: [243 / 255, 241 / 255, 236 / 255, 0.24],
    accent: [1, 91 / 255, 46 / 255, 1],
  },
  light: {
    minor: [21 / 255, 22 / 255, 26 / 255, 0.085],
    major: [21 / 255, 22 / 255, 26 / 255, 0.2],
    accent: [194 / 255, 58 / 255, 16 / 255, 1],
  },
}

export function readPalette(theme: ThemeName): Palette {
  const def = DEFAULTS[theme]
  if (typeof document === 'undefined') return def
  const cs = getComputedStyle(document.documentElement)
  const v = (name: string) => cs.getPropertyValue(name).trim()
  return {
    minor: resolveColor(v('--grain-minor')) ?? def.minor,
    major: resolveColor(v('--grain-major')) ?? def.major,
    accent: resolveColor(v('--accent')) ?? def.accent,
  }
}

export function mixRGBA(a: RGBA, b: RGBA, t: number): RGBA {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t]
}

export function cssRGBA(c: RGBA, alphaMul = 1): string {
  return `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${(c[3] * alphaMul).toFixed(3)})`
}
