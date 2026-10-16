/**
 * 3D 심플렉스 노이즈 (JS). 목업(team/mockup/today-v2.html)의 N3를 타입만 붙여 옮겼다.
 * Canvas 2D 정지 프레임과 SVG(나이테·흐름 띠)의 흔들림에 쓴다. GPU 쪽은 shaders.ts.
 */
const G3 = [1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0, 1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1, 0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1]
const P = new Uint8Array(512)
const M = new Uint8Array(512)
;(() => {
  const p = new Uint8Array(256)
  let s = 20261016
  for (let i = 0; i < 256; i++) p[i] = i
  for (let i = 255; i > 0; i--) {
    s = (s * 16807) % 2147483647
    const j = s % (i + 1)
    const t = p[i]!
    p[i] = p[j]!
    p[j] = t
  }
  for (let i = 0; i < 512; i++) {
    P[i] = p[i & 255]!
    M[i] = P[i]! % 12
  }
})()

function corner(t: number, gi: number, x: number, y: number, z: number): number {
  if (t < 0) return 0
  t *= t
  return t * t * (G3[gi]! * x + G3[gi + 1]! * y + G3[gi + 2]! * z)
}

const F = 1 / 3
const G = 1 / 6

/** 대략 -1..1 */
export function noise3(x: number, y: number, z: number): number {
  const s = (x + y + z) * F
  const i = Math.floor(x + s)
  const j = Math.floor(y + s)
  const k = Math.floor(z + s)
  const t = (i + j + k) * G
  const x0 = x - (i - t)
  const y0 = y - (j - t)
  const z0 = z - (k - t)
  let a: number, b: number, c: number, d: number, e: number, f: number
  if (x0 >= y0) {
    if (y0 >= z0) [a, b, c, d, e, f] = [1, 0, 0, 1, 1, 0]
    else if (x0 >= z0) [a, b, c, d, e, f] = [1, 0, 0, 1, 0, 1]
    else [a, b, c, d, e, f] = [0, 0, 1, 1, 0, 1]
  } else {
    if (y0 < z0) [a, b, c, d, e, f] = [0, 0, 1, 0, 1, 1]
    else if (x0 < z0) [a, b, c, d, e, f] = [0, 1, 0, 0, 1, 1]
    else [a, b, c, d, e, f] = [0, 1, 0, 1, 1, 0]
  }
  const x1 = x0 - a + G
  const y1 = y0 - b + G
  const z1 = z0 - c + G
  const x2 = x0 - d + 2 * G
  const y2 = y0 - e + 2 * G
  const z2 = z0 - f + 2 * G
  const x3 = x0 - 1 + 3 * G
  const y3 = y0 - 1 + 3 * G
  const z3 = z0 - 1 + 3 * G
  const ii = i & 255
  const jj = j & 255
  const kk = k & 255
  return (
    32 *
    (corner(0.6 - x0 * x0 - y0 * y0 - z0 * z0, M[ii + P[jj + P[kk]!]!]! * 3, x0, y0, z0) +
      corner(0.6 - x1 * x1 - y1 * y1 - z1 * z1, M[ii + a + P[jj + b + P[kk + c]!]!]! * 3, x1, y1, z1) +
      corner(0.6 - x2 * x2 - y2 * y2 - z2 * z2, M[ii + d + P[jj + e + P[kk + f]!]!]! * 3, x2, y2, z2) +
      corner(0.6 - x3 * x3 - y3 * y3 - z3 * z3, M[ii + 1 + P[jj + 1 + P[kk + 1]!]!]! * 3, x3, y3, z3))
  )
}
