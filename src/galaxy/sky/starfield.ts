/**
 * 별 만들기 (시드 고정, design-v3 §2-3).
 * 밝기는 멱함수: 한 등급 어두워질 때마다 개수가 약 10배. 등급 경계(L): 0등급 ≥143, 1등급 ≥24, 2등급 ≥5, 3등급 ≥1, 4등급 <1(분해 안 됨).
 * iPad 1180×820 기준 약 0등급 14 · 1등급 220 · 2등급 2,400 · 3등급 27,000 + 분해 안 되는 4등급 수만 개.
 * 띠 안 비율: 0등급 60% · 1등급 70% · 2등급 80% · 3·4등급 88%.
 * 별은 '띠 좌표'(s, t)나 화면 비율(u, v)로 저장한다 → 구도가 같으니 화면이 바뀌어도 같은 별이 같은 자리에 있다.
 *
 * 한 별 = 8 float: kind(0 띠, 1 하늘 전체), a, b, L, r, g, b, phase
 */
import { blackbody, fbm2, gauss, mulberry32 } from './rng'

export const STRIDE = 8
export const DYN_L = 5 // 0~2등급은 매 프레임 그리는 별(반짝임·포인터 반응), 3·4등급은 정적 텍스처
const L_MIN = 0.409

export interface StarSets {
  dim: Float32Array
  dimCount: number
  bright: Float32Array
  brightCount: number
}

/* 색온도 비율 (띠 밖 / 코어 근처): 청백 14/6 · 흰빛 58/44 · 노랑 22/36 · 주황 6/14. 채도는 20% 낮춘다 */
function starColor(r: () => number, inBand: boolean): [number, number, number] {
  const x = r()
  const [pb, pw, py] = inBand ? [0.06, 0.5, 0.86] : [0.14, 0.72, 0.94]
  let T: number
  if (x < pb) T = 10000 + r() * 15000
  else if (x < pw) T = 6000 + r() * 3000
  else if (x < py) T = 4000 + r() * 1500
  else T = 3000 + r() * 800
  const c = blackbody(T)
  const w = 0.32
  return [c[0] * (1 - w) + w, c[1] * (1 - w) + w, c[2] * (1 - w) + w]
}

function bandShare(L: number): number {
  return L >= 143 ? 0.6 : L >= 24 ? 0.7 : L >= 5 ? 0.8 : 0.88
}

export function makeStars(seed: number, cssW: number, cssH: number, density: number): StarSets {
  const r = mulberry32(seed)
  const total = Math.round(cssW * cssH * density)
  const dim: number[] = []
  const bright: number[] = []
  for (let i = 0; i < total; i++) {
    const L = Math.min(900, L_MIN * Math.pow(1 - r() * 0.999995, -1 / 1.55))
    const inBand = r() < bandShare(L)
    let kind = 1
    let a = r()
    let b = r()
    if (inBand) {
      // 띠 안 — 별 구름(fbm)으로 뭉치게 (거부 샘플링)
      kind = 0
      for (let k = 0; k < 8; k++) {
        const s = -0.04 + r() * 1.08
        const t = r() < 0.82 ? gauss(r) * 0.6 : gauss(r) * 1.5
        const cloud = fbm2(s * 22 + 3.3, t * 1.7 + 11.1, 4)
        const p = Math.min(1, Math.max(0.05, (cloud - 0.3) * 2.4))
        a = s
        b = t
        if (r() < p) break
      }
    }
    const [cr, cg, cb] = starColor(r, inBand)
    const arr = L >= DYN_L ? bright : dim
    arr.push(kind, a, b, L, cr, cg, cb, r() * 6.2831853)
  }
  return {
    dim: new Float32Array(dim),
    dimCount: dim.length / STRIDE,
    bright: new Float32Array(bright),
    brightCount: bright.length / STRIDE,
  }
}

/**
 * 별가루 (v3 §2-4): 띠의 아래쪽 가장자리, s 0.22–0.70에서 생겨 수직 아래 ±6°로 4–10px/s.
 * 화면 100만 px당 150개 이하(폰 60 · iPad 140 · 데스크톱 180). 수명 18–36초(처음 2초 나타남, 마지막 4초 사라짐).
 * 8 float: s, t, speed(px/s), life(s), phase(0..1), size(px), bright, angle(rad)
 */
export function makeDust(seed: number, count: number): Float32Array {
  const r = mulberry32(seed ^ 0x9e3779b9)
  const out = new Float32Array(count * STRIDE)
  for (let i = 0; i < count; i++) {
    const o = i * STRIDE
    out[o] = 0.22 + r() * 0.48
    out[o + 1] = -(0.8 + r() * 1.1)
    out[o + 2] = 4 + r() * 6
    out[o + 3] = 18 + r() * 18
    out[o + 4] = r()
    out[o + 5] = 0.6 + r() * 0.7
    out[o + 6] = 0.25 + r() * 0.3
    out[o + 7] = (r() - 0.5) * 2 * 0.105
  }
  return out
}

export function dustCount(cssW: number, cssH: number): number {
  return Math.round(Math.min(190, Math.max(60, cssW * cssH * 1.45e-4)))
}
