/**
 * 손글씨 엔진 — 색 · 굵기 · 종이 (design-ink 1-6 · 2-7 · 7-2).
 * 색은 '흰 종이 기준'으로 저장한다. 밤 종이에서만 짝 색(큐레이션 12색) 또는 OKLCH 식으로 바꿔 그린다.
 */
import type { PenKind } from './types'

export interface Swatch {
  id: string
  /** 저장 색(흰 종이) */
  hex: string
  /** 밤 종이 표시 색 */
  night: string
}

/** 펜 12색 (기본 3칸: 먹 · 남 · 인주) */
export const PEN_COLORS: Swatch[] = [
  { id: 'ink', hex: '#1B1D22', night: '#ECE8DF' },
  { id: 'gray', hex: '#6B7080', night: '#B9BDCB' },
  { id: 'navy', hex: '#2251C9', night: '#8FB2FF' },
  { id: 'sky', hex: '#1E88C8', night: '#7CC6F2' },
  { id: 'teal', hex: '#0A7C6E', night: '#5ED8C4' },
  { id: 'green', hex: '#3A7A1E', night: '#9BDB76' },
  { id: 'gold', hex: '#8A6200', night: '#F3D29A' },
  { id: 'orange', hex: '#C2611A', night: '#FFB37A' },
  { id: 'seal', hex: '#C2412C', night: '#FF9C86' },
  { id: 'pink', hex: '#B8326A', night: '#FF8DB5' },
  { id: 'violet', hex: '#7A43D1', night: '#C29BFF' },
  { id: 'brown', hex: '#7A5434', night: '#D9B38C' },
]
export const PEN_SLOTS = ['#1B1D22', '#2251C9', '#C2412C']

/** 형광 6색 (두 종이에 같은 색, 섞기·불투명도만 다르다). 기본 3칸: 노랑 · 하늘 · 분홍 */
export const HL_COLORS = ['#F7D64A', '#B8E986', '#8CCBFF', '#FFA8C9', '#FFC48A', '#CDB4FF']
export const HL_SLOTS = ['#F7D64A', '#8CCBFF', '#FFA8C9']
/** 형광 밤 짝 색 (스크린으로 섞어 밝게 빛난다. 저장 색은 흰 종이 기준 그대로) */
const HL_NIGHT: Record<string, string> = {
  '#F7D64A': '#FFE45C',
  '#B8E986': '#B9F27A',
  '#8CCBFF': '#7CC8FF',
  '#FFA8C9': '#FF9CCB',
  '#FFC48A': '#FFB870',
  '#CDB4FF': '#C7A6FF',
}

/** 테이프 6색 (직접 고르기 없음). 기본 3칸: 회청 · 금 · 인주 */
export const TAPE_COLORS: Swatch[] = [
  { id: 'slate', hex: '#C9D0DC', night: '#2B3449' },
  { id: 'gold', hex: '#EAD8B0', night: '#4D4130' },
  { id: 'seal', hex: '#EBC2B6', night: '#4A3230' },
  { id: 'gray', hex: '#D3D5DA', night: '#33363E' },
  { id: 'green', hex: '#CFE3C2', night: '#2F3D2B' },
  { id: 'violet', hex: '#DCCFF0', night: '#3A3150' },
]
export const TAPE_SLOTS = ['#C9D0DC', '#EAD8B0', '#EBC2B6']

/** 굵기 3단계 · 막대 범위 (pt, 쪽 좌표 — 확대하면 함께 커진다) */
export const WIDTHS = {
  pen: { steps: [1.2, 2.0, 3.2], min: 0.5, max: 8 },
  pencil: { steps: [1.0, 1.6, 2.6], min: 0.5, max: 6 },
  highlighter: { steps: [8, 12, 18], min: 6, max: 24 },
  tape: { steps: [14, 22, 32], min: 12, max: 48 },
  eraser: { steps: [8, 16, 32], min: 6, max: 40 },
} as const

export function widthSteps(tool: 'pen' | 'highlighter' | 'tape' | 'eraser', kind?: PenKind): readonly number[] {
  if (tool === 'pen') return kind === 'pencil' ? WIDTHS.pencil.steps : WIDTHS.pen.steps
  return WIDTHS[tool].steps
}

/* ---------- 종이 (1-6) ---------- */

export type PaperKind = 'night' | 'day' | 'white'

export interface PaperSpec {
  kind: PaperKind
  bg: string
  border: string
  line: string
  dot: string
  shadow: string
  /** 형광 층 섞기: 낮·흰 = 곱하기, 밤 = 스크린(밝은 짝 색) — 형광은 늘 잉크 층 아래 */
  hlBlend: 'multiply' | 'screen'
  hlOpacity: number
  dark: boolean
}

export const PAPERS: Record<PaperKind, PaperSpec> = {
  night: { kind: 'night', bg: '#0E1322', border: 'rgba(220,228,255,.14)', line: 'rgba(220,228,255,.115)', dot: 'rgba(220,228,255,.24)', shadow: 'var(--shadow-3)', hlBlend: 'screen', hlOpacity: 0.45, dark: true },
  day: { kind: 'day', bg: '#FBFAF7', border: 'var(--border)', line: 'rgba(20,23,32,.085)', dot: 'rgba(20,23,32,.18)', shadow: 'var(--shadow-2)', hlBlend: 'multiply', hlOpacity: 0.38, dark: false },
  white: { kind: 'white', bg: '#FFFFFF', border: 'var(--border)', line: 'rgba(20,23,32,.085)', dot: 'rgba(20,23,32,.18)', shadow: 'var(--shadow-2)', hlBlend: 'multiply', hlOpacity: 0.38, dark: false },
}

/** 쪽의 종이: PDF · 'white'는 흰 종이, 아니면 테마(밤·낮) */
export function paperOf(page: { pdf?: unknown; paper?: string | null }, night: boolean): PaperSpec {
  if (page.pdf || page.paper === 'white') return PAPERS.white
  if (page.paper === 'day') return PAPERS.day
  if (page.paper === 'night') return PAPERS.night
  return night ? PAPERS.night : PAPERS.day
}

/* ---------- 색 바꾸기 ---------- */

export function rgbOf(hex: string): [number, number, number] {
  const h = /^#?([0-9a-f]{6})$/i.exec(hex)?.[1] ?? '000000'
  const n = parseInt(h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function toHex(css: string): string | null {
  const s = css.trim()
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toUpperCase()
  if (/^#[0-9a-f]{3}$/i.test(s)) return ('#' + s[1]! + s[1]! + s[2]! + s[2]! + s[3]! + s[3]!).toUpperCase()
  const m = /rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/i.exec(s)
  if (m) return '#' + [m[1], m[2], m[3]].map((x) => Math.round(Number(x)).toString(16).padStart(2, '0')).join('').toUpperCase()
  return null
}

/** 과목 색 토큰(--s-phys …)을 '#RRGGBB'로 (낮 테마 값이 흰 종이 기준 색이다) */
export function subjectHex(token: string, el: Element = document.documentElement): string | null {
  return toHex(getComputedStyle(el).getPropertyValue(`--s-${token}`))
}

const lin = (c: number) => {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}
const gam = (v: number) => {
  const c = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055
  return Math.round(Math.max(0, Math.min(1, c)) * 255)
}

function toOklch(hex: string): [number, number, number] {
  const [R, G, B] = rgbOf(hex).map(lin) as [number, number, number]
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B)
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B)
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const b = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return [L, Math.hypot(a, b), Math.atan2(b, a)]
}

function fromOklch(L: number, C: number, h: number): string {
  const a = C * Math.cos(h), b = C * Math.sin(h)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  const R = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
  const G = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
  const B = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  return '#' + [gam(R), gam(G), gam(B)].map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase()
}

const nightMap = new Map<string, string>([...PEN_COLORS, ...TAPE_COLORS].map((s) => [s.hex.toUpperCase(), s.night]))
const nightCache = new Map<string, string>()

/** 밤 종이 표시 색: 큐레이션 색은 짝, 그 밖은 L' = clamp(1.06 − 0.75L, .60, .94), C' = .85C, h' = h */
export function nightColor(hex: string): string {
  const key = hex.toUpperCase()
  const hit = nightMap.get(key) ?? nightCache.get(key)
  if (hit) return hit
  const [L, C, h] = toOklch(key)
  const out = fromOklch(Math.max(0.6, Math.min(0.94, 1.06 - 0.75 * L)), 0.85 * C, h)
  nightCache.set(key, out)
  return out
}

/** 쪽에 그릴 형광 색 (밤: 밝은 짝, 그 밖 색은 OKLCH로 밝게) */
export function hlColor(hex: string, dark: boolean): string {
  if (!dark) return hex
  const key = hex.toUpperCase()
  const hit = HL_NIGHT[key]
  if (hit) return hit
  const [L, C, h] = toOklch(key)
  return fromOklch(Math.max(0.8, Math.min(0.93, L + 0.08)), Math.min(0.2, C * 1.1), h)
}

/** 쪽에 그릴 잉크 색 */
export function inkColor(hex: string, dark: boolean): string {
  return dark ? nightColor(hex) : hex
}

/** 테이프 표시 색 */
export function tapeColor(hex: string | null | undefined, dark: boolean): string {
  const h = (hex ?? TAPE_SLOTS[0]!).toUpperCase()
  if (!dark) return h
  return nightMap.get(h) ?? nightColor(h)
}

export function luminance(hex: string): number {
  const [r, g, b] = rgbOf(hex).map(lin) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
