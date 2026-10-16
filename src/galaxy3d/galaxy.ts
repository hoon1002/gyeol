/**
 * 3D 나선 은하 입자 만들기 (시드 고정). 단위: 1 = 약 1 kpc. 원반 반지름 ~16.
 * 별 1개 = 8 float: (r, θ0, y, L) · (R, G, B, kind)  kind: 0 원반 · 1 팽대부 · 2 헤일로 · 3 먼 하늘(방향)
 * 구름 1개 = 8 float: (r, θ0, y, size) · (R, G, B, kind)  kind: 0 먼지(흡수, 원반면) · 1 팔 빛(원반면) · 2 HII(분홍) · 3 팽대부 빛
 * 위치는 t=0 기준. 자전(차등 회전)은 셰이더가 시간으로 계산한다 — CPU 갱신 없음.
 */

/* design-v4 §1-1: 막대 나선은하 SBbc — 팔 4개(큰 팔 2 + 작은 팔 2), 피치 13°, 팔 폭 σ 0.6u, 막대 반길이 4.5u */
export const ARM_PITCH = (15 * Math.PI) / 180 // design-v4는 13° — 동심원처럼 읽히지 않게 15°로 (architecture-v4 §1)
export const BAR_ANGLE = (32 * Math.PI) / 180 // 막대 장축 (그래프 장소 = 막대 끝 (4.2, 2.6))
export const BAR_LEN = 4.5
/** 로그 나선: 막대 끝(팔 시작점과 25°)에서 나오는 팔의 각도. arm 0·1 = 큰 팔, 0.5·1.5 = 작은 팔 */
export function armAngle(r: number, arm: number): number {
  return BAR_ANGLE + (25 * Math.PI) / 180 + arm * Math.PI + Math.log(Math.max(r, 0.5) / BAR_LEN) / Math.tan(ARM_PITCH)
}

/** 자전 (design-v4 §3): 코어(r ≤ 3u) 1.2°/s, 바깥은 평탄 회전 곡선 Ω ∝ 1/r (r = 15u에서 0.24°/s). 셰이더와 같은 식 */
export function omega(r: number): number {
  return ((1.2 * Math.PI) / 180) * (3 / Math.max(3, r))
}

function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function gauss(r: () => number) {
  return Math.sqrt(-2 * Math.log(r() + 1e-9)) * Math.cos(2 * Math.PI * r())
}

/** 흑체 색 (근사, 채도 조금 낮춤) */
export function blackbody(T: number): [number, number, number] {
  const t = T / 100
  let r: number, g: number, b: number
  if (t <= 66) {
    r = 255
    g = 99.47 * Math.log(t) - 161.12
    b = t <= 19 ? 0 : 138.52 * Math.log(t - 10) - 305.04
  } else {
    r = 329.7 * Math.pow(t - 60, -0.1332)
    g = 288.12 * Math.pow(t - 60, -0.0755)
    b = 255
  }
  const c = [r, g, b].map((v) => Math.min(255, Math.max(0, v)) / 255) as [number, number, number]
  const l = 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]
  return [l + (c[0] - l) * 0.85, l + (c[1] - l) * 0.85, l + (c[2] - l) * 0.85]
}

export interface GalaxyData {
  stars: Float32Array
  starCount: number
  clouds: Float32Array
  cloudCount: number
}

const hex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255]
const mix3 = (a: [number, number, number], b: [number, number, number], k: number): [number, number, number] => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]

/** 장소에 맞춘 구조물 (design-v4 §4): 복습 = 젊은 산개성단, 그래프 = 막대 끝 HII 복합체, 집중 = 나의 자리(스퍼) */
export const LANDMARKS = {
  review: [3.8, 0.1, -5.9] as [number, number, number],
  graph: [4.2, 0.2, 2.6] as [number, number, number],
  focus: [-6.2, 0.15, -5.0] as [number, number, number],
  notes: [-10.5, 0, 6.0] as [number, number, number],
}

export function makeGalaxy(starCount: number, cloudScale: number, seed = 1016): GalaxyData {
  const r = rng(seed)
  const S = new Float32Array(starCount * 8)
  let i = 0
  const put = (x: number, y: number, z: number, L: number, c: [number, number, number], kind: number) => {
    if (i >= starCount) return
    const o = i * 8
    S[o] = Math.hypot(x, z)
    S[o + 1] = Math.atan2(z, x)
    S[o + 2] = y
    S[o + 3] = L
    S[o + 4] = c[0]
    S[o + 5] = c[1]
    S[o + 6] = c[2]
    S[o + 7] = kind
    i++
  }
  const polar = (rad: number, th: number, y: number, L: number, c: [number, number, number], kind: number) => put(rad * Math.cos(th), y, rad * Math.sin(th), L, c, kind)
  void polar
  const lum = (k: number) => Math.min(60, 0.05 * Math.pow(r() + 1e-4, -k))
  const OLD_IN = hex('#FFE2B8')
  const OLD_OUT = hex('#DCE4FF')
  const YOUNG = hex('#A9C4FF')
  // 비율 (A 40만 기준: 원반 32만 · 팽대부 6만 · 헤일로 2만) + 먼 하늘 5%
  const nBg = Math.round(starCount * 0.05)
  const nHalo = Math.round(starCount * 0.05)
  const nBulge = Math.round(starCount * 0.15)
  const nCluster = 900
  const nDisk = starCount - nBg - nHalo - nBulge - nCluster
  // 팔의 성격: 큰 팔 2(밝음) + 작은 팔 2(어둡고 짧음). 길이 방향으로 밝기가 변하고 끊기며, 큰 팔은 바깥에서 갈라진다
  const ARMS = [
    { a: 0, w: 1, ph: 0.3 },
    { a: 1, w: 1, ph: 2.1 },
    { a: 0.5, w: 0.5, ph: 4.0 },
    { a: 1.5, w: 0.45, ph: 5.2 },
  ]
  const sstep = (e0: number, e1: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)
  }
  const armStr = (k: number, rad: number) => {
    const A = ARMS[k]!
    const seg = 0.08 + 0.92 * sstep(-0.15, 0.6, Math.sin(rad * 1.9 + A.ph) * 0.6 + Math.sin(rad * 0.71 + A.ph * 1.7) * 0.4)
    // 큰 팔: 코어 쪽 밝음 → 바깥으로 흩어짐(13u 넘어 사라짐). 작은 팔: 6–11u에만
    const span = A.w > 0.9 ? 1 - sstep(10, 14, rad) : sstep(5.5, 6.5, rad) * (1 - sstep(9.5, 11.5, rad))
    return A.w * Math.exp(-(rad - BAR_LEN) / 5.5) * seg * span * (rad < BAR_LEN ? 0 : 1)
  }
  const pickArm = (rad: number) => {
    const w = ARMS.map((_, k) => armStr(k, rad))
    const tot = w.reduce((a, b) => a + b, 0)
    let x = r() * tot
    for (let k = 0; k < 4; k++) if ((x -= w[k]!) <= 0) return k
    return 0
  }
  const armTh = (k: number, rad: number) => {
    const A = ARMS[k]!
    let th = armAngle(rad, A.a)
    // 가지: 큰 팔은 8.5u 바깥에서 35% 확률로 갈라진 가지를 따른다
    if (A.w > 0.9 && rad > 8.5 && r() < 0.35) th += 0.13 * (rad - 8.5)
    return th
  }
  // 별 덩어리(산개성단·별구름) 중심: 팔 위, 바깥 가장자리 쪽
  const clumps: Array<[number, number, number, number]> = []
  for (let c = 0; c < 900; c++) {
    let rad = 0
    let k = 0
    for (let tries = 0; tries < 20; tries++) {
      rad = BAR_LEN + r() * 10.5
      k = pickArm(rad)
      if (r() < armStr(k, rad) * 1.3) break
    }
    const th = armTh(k, rad) + (gauss(r) * 0.25) / rad
    const rr = rad + 0.22
    clumps.push([rr * Math.cos(th), rr * Math.sin(th), 0.05 + Math.pow(r(), 2) * 0.32, 0.4 + r()])
  }
  // 여러 스케일 얼룩(오래된 별의 밀도 변조)
  const mottle = (x: number, z: number) => 0.55 + 0.25 * Math.sin(x * 1.31 + z * 0.73) * Math.sin(z * 1.07 - x * 0.41) + 0.2 * Math.sin(x * 3.7 - z * 2.9) * Math.sin(z * 3.3 + x * 1.9)
  for (let n = 0; n < nDisk; n++) {
    const young = r() < 0.24
    if (young && r() < 0.65) {
      // 젊은 별 65%는 덩어리 안에 (푸른 산개성단)
      const c = clumps[Math.floor(r() * clumps.length)]!
      put(c[0] + gauss(r) * c[2], gauss(r) * 0.05, c[1] + gauss(r) * c[2], lum(0.62) * 2.2 * c[3], mix3(YOUNG, blackbody(15000 + r() * 12000), 0.4), 0)
      continue
    }
    let rad = -3.5 * Math.log(1 - r() * 0.985)
    if (rad > 15.5) rad = 15.5 * r()
    rad = Math.max(rad, 0.4)
    const k = pickArm(rad)
    const pArm = (young ? 0.85 : 0.22) * Math.min(1, armStr(k, rad) * 1.8)
    let th: number
    if (r() < pArm) {
      if (r() < 0.1) {
        // 깃털(스퍼): 팔에서 비스듬히 바깥으로 뻗는 희미한 줄기
        const t = r() * 2.4
        const r0 = rad
        rad = r0 + t * 0.55
        th = armTh(k, r0) + (t * 0.42) / r0 + (gauss(r) * 0.12) / r0
      } else {
        th = armTh(k, rad) + (gauss(r) * (young ? 0.32 : 0.9)) / rad + (young ? 0.2 / rad : 0)
      }
    } else th = r() * Math.PI * 2
    const x = rad * Math.cos(th)
    const z = rad * Math.sin(th)
    if (!young && r() > mottle(x, z)) {
      n--
      continue
    }
    const h = (young ? 0.08 : 0.3) * (0.6 + rad / 15)
    const kOut = Math.min(1, rad / 15)
    const c = young ? mix3(YOUNG, blackbody(14000 + r() * 12000), 0.4) : r() < 0.06 ? blackbody(3300 + r() * 600) : mix3(OLD_IN, OLD_OUT, kOut * kOut)
    put(x, gauss(r) * h * 0.5, z, young ? lum(0.62) * 2 : lum(0.55), c, 0)
  }
  const CORE = [hex('#FFE7BF'), hex('#F6CF8E'), hex('#E9A970')] as const
  for (let n = 0; n < nBulge; n++) {
    // 팽대부 + 막대: 3축 1 : 0.6 : 0.45, 막대 반길이 4.5u — 단단히 함께 돈다(kind 1)
    const bar = r() < 0.6
    const a = bar ? BAR_LEN : 2.5
    const rr = Math.pow(r(), bar ? 0.9 : 1.6)
    const u = r() * 2 - 1
    const ph = r() * Math.PI * 2
    const sxy = Math.sqrt(1 - u * u)
    let x = rr * a * sxy * Math.cos(ph)
    let z = rr * a * sxy * Math.sin(ph) * (bar ? 0.3 : 0.6)
    const y = rr * a * u * (bar ? 0.18 : 0.45)
    const cx = x * Math.cos(BAR_ANGLE) - z * Math.sin(BAR_ANGLE)
    const cz = x * Math.sin(BAR_ANGLE) + z * Math.cos(BAR_ANGLE)
    x = cx
    z = cz
    const k = Math.min(1, rr * 1.3)
    const c = k < 0.5 ? mix3(CORE[0], CORE[1], k * 2) : mix3(CORE[1], CORE[2], (k - 0.5) * 2)
    put(x, y, z, lum(0.55) * 0.85, c, 1)
  }
  for (let n = 0; n < nHalo; n++) {
    // 헤일로: 반지름 40u 구, 그중 60개 구상성단
    const inGC = n < 60 * 40
    let x: number, y: number, z: number
    if (inGC) {
      const g = Math.floor(n / 40)
      const gr = rng(seed + 991 + g)
      const R = 6 + gr() * 30
      const gu = gr() * 2 - 1
      const gp = gr() * Math.PI * 2
      const gs = Math.sqrt(1 - gu * gu)
      x = R * gs * Math.cos(gp) + gauss(r) * 0.12
      y = R * gu * 0.7 + gauss(r) * 0.12
      z = R * gs * Math.sin(gp) + gauss(r) * 0.12
    } else {
      const R = 5 + Math.pow(r(), 0.7) * 35
      const u = r() * 2 - 1
      const ph = r() * Math.PI * 2
      const sxy = Math.sqrt(1 - u * u)
      x = R * sxy * Math.cos(ph)
      y = R * u * 0.8
      z = R * sxy * Math.sin(ph)
    }
    put(x, y, z, lum(0.5) * (inGC ? 1.4 : 0.6), blackbody(4200 + r() * 1800), 2)
  }
  for (let n = 0; n < nCluster; n++) {
    // 복습 장소의 젊은 산개성단 (반지름 0.6u) + 나의 자리 둘레 성긴 별
    const m = n < 600 ? LANDMARKS.review : LANDMARKS.focus
    const sp = n < 600 ? 0.35 : 0.9
    put(m[0] + gauss(r) * sp, m[1] + gauss(r) * sp * 0.4, m[2] + gauss(r) * sp, n < 600 ? lum(0.6) * 2.5 : lum(0.55), n < 600 ? mix3(YOUNG, [1, 1, 1], r() * 0.4) : mix3(OLD_IN, YOUNG, r()), 0)
  }
  while (i < starCount) {
    // 먼 하늘: 방향만 (카메라 중심 구 위, 시차 없음)
    const u = r() * 2 - 1
    const ph = r() * Math.PI * 2
    const sxy = Math.sqrt(1 - u * u)
    const o = i * 8
    S[o] = sxy * Math.cos(ph)
    S[o + 1] = u
    S[o + 2] = sxy * Math.sin(ph)
    S[o + 3] = 0.02 + Math.pow(r(), 6) * 0.6
    const c = blackbody(4000 + r() * 9000)
    S[o + 4] = c[0]
    S[o + 5] = c[1]
    S[o + 6] = c[2]
    S[o + 7] = 3
    i++
  }
  void nBg

  // 구름(인스턴스 사각형)
  const nDust = Math.round(16000 * cloudScale)
  const nGlow = Math.round(4000 * cloudScale)
  const nHII = Math.round(2600 * cloudScale)
  const nBulgeGlow = 160
  const C = new Float32Array((nDust + nGlow + nHII + nBulgeGlow + 220 + 9) * 8)
  let j = 0
  const cput = (x: number, y: number, z: number, size: number, c: [number, number, number], kind: number) => {
    const o = j * 8
    C[o] = Math.hypot(x, z)
    C[o + 1] = Math.atan2(z, x)
    C[o + 2] = y
    C[o + 3] = size
    C[o + 4] = c[0]
    C[o + 5] = c[1]
    C[o + 6] = c[2]
    C[o + 7] = kind
    j++
  }
  const cpolar = (rad: number, th: number, y: number, size: number, c: [number, number, number], kind: number) => cput(rad * Math.cos(th), y, rad * Math.sin(th), size, c, kind)
  for (let n = 0; n < nDust; n++) {
    // 먼지 실: 팔 안쪽(오목한) 가장자리를 따라 끊기고 갈라지는 가는 실 (작고 길쭉한 조각 여러 개)
    const rad = BAR_LEN + 0.6 + Math.pow(r(), 0.8) * 10
    const k = pickArm(rad)
    const gap = Math.sin(rad * 3.1 + k * 2.3) * Math.sin(rad * 1.3 + k)
    if (gap < -0.35) continue
    const branchOff = r() < 0.15 ? (r() - 0.5) * 0.9 : 0
    const rr = rad - 0.32 + gauss(r) * 0.07 + branchOff * 0.3
    const th = armTh(k, rad) + branchOff / rad
    const op = (0.12 + r() * 0.35) * Math.min(1, armStr(k, rad) * 1.8 + 0.25)
    cpolar(rr, th, gauss(r) * 0.02, 0.06 + r() * 0.2, [0.55 * op, 0.75 * op, 1.0 * op], 0)
  }
  for (let n = 0; n < nGlow; n++) {
    // 분해되지 않은 별빛: 덩어리 둘레의 푸른 빛 + 팔 사이의 희미한 금빛
    if (r() < 0.6) {
      const c = clumps[Math.floor(r() * clumps.length)]!
      const k = 0.035 * c[3] * (0.5 + r())
      cput(c[0] + gauss(r) * c[2], gauss(r) * 0.06, c[1] + gauss(r) * c[2], c[2] * (1.5 + r() * 2), [YOUNG[0] * k, YOUNG[1] * k, YOUNG[2] * k], 1)
    } else {
      const rad = 0.6 + Math.pow(r(), 0.85) * 14
      const th = r() * Math.PI * 2
      const c = mix3(OLD_IN, OLD_OUT, Math.min(1, rad / 15))
      const k = 0.012 * (0.5 + r())
      cpolar(rad, th, gauss(r) * 0.1, 0.5 + r() * 1.2, [c[0] * k, c[1] * k, c[2] * k], 1)
    }
  }
  for (let n = 0; n < nHII; n++) {
    // HII: 작고 많은 분홍 매듭 — 젊은 덩어리 곁 (그래프 장소엔 조금 더 촘촘하게)
    const atGraph = r() < 0.12
    let x: number, y: number, z: number
    if (atGraph) {
      x = LANDMARKS.graph[0] + gauss(r) * 0.6
      y = LANDMARKS.graph[1] + gauss(r) * 0.12
      z = LANDMARKS.graph[2] + gauss(r) * 0.6
    } else {
      const c = clumps[Math.floor(r() * clumps.length)]!
      x = c[0] + gauss(r) * c[2] * 1.2
      y = gauss(r) * 0.04
      z = c[1] + gauss(r) * c[2] * 1.2
    }
    const k = 0.35 + r() * 0.65
    const blue = r() < 0.12
    cput(x, y, z, 0.03 + Math.pow(r(), 2.5) * (atGraph ? 0.3 : 0.12), blue ? [0.25 * k, 0.45 * k, 1.0 * k] : [1.0 * k, 0.3 * k, 0.5 * k], 2)
  }
  for (let n = 0; n < nBulgeGlow; n++) {
    // 막대 빛: 막대를 따라 금빛 (가운데가 너무 하얗게 날지 않게 약하게)
    const t = gauss(r) * BAR_LEN * 0.45
    const k = 0.03 + r() * 0.03
    const c = mix3(CORE[1], CORE[2], r() * 0.6)
    cput(t * Math.cos(BAR_ANGLE), gauss(r) * 0.12, t * Math.sin(BAR_ANGLE), 0.6 + r() * 1.4, [c[0] * k, c[1] * k, c[2] * k], 3)
  }
  for (let n = 0; n < 220; n++) {
    // 복습 성단을 감싼 푸른 반사 성운
    const m = LANDMARKS.review
    const k = 0.04 + r() * 0.04
    cput(m[0] + gauss(r) * 0.4, m[1] + gauss(r) * 0.15, m[2] + gauss(r) * 0.4, 0.15 + r() * 0.4, [0.3 * k, 0.5 * k, 1.0 * k], 2)
  }
  for (let n = 0; n < 9; n++) {
    // 먼 은하 몇 개 (하늘 구 위의 작은 타원 얼룩) — 깊이감
    const u = r() * 1.6 - 0.8
    const ph = r() * Math.PI * 2
    const sxy = Math.sqrt(1 - u * u)
    const k = 0.25 + r() * 0.35
    const c = mix3(hex('#FFE2B8'), hex('#C9D6FF'), r())
    const o = j * 8
    C[o] = sxy * Math.cos(ph)
    C[o + 1] = u
    C[o + 2] = sxy * Math.sin(ph)
    C[o + 3] = 1.2 + r() * 2.2
    C[o + 4] = c[0] * k
    C[o + 5] = c[1] * k
    C[o + 6] = c[2] * k
    C[o + 7] = 4
    j++
  }
  return { stars: S, starCount: i, clouds: C, cloudCount: j }
}
