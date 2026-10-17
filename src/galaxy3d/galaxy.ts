/**
 * 3D 막대 나선은하 입자 만들기 (시드 고정, Web Worker에서 실행). 단위: 1 = 약 1 kpc. 원반 반지름 ~16.
 * 별 1개 = 8 float: (r, θ0, y, L) · (R, G, B, kind)
 *   kind 0 늙은 원반 별(차등 회전, 팔 밝기는 셰이더가 패턴 좌표로) · 1 팽대부·막대(패턴과 함께 단단히)
 *        2 헤일로(멈춤) · 3 먼 하늘(방향) · 4 젊은 별·성단(패턴과 함께 단단히)
 * 구름 1개 = 8 float: (r, θ0, y, size) · (R, G, B, kind)
 *   kind 0 먼지(흡수, 원반면) · 1 분해되지 않은 별빛(원반면) · 2 HII(분홍 매듭) · 3 막대 빛 · 4 먼 은하
 *
 * 밀도파 모델 (research-v4 §2-3, plan-v4-final Q2): 팔 무늬·먼지·HII·젊은 별·막대는 하나의 패턴 각속도 Ωp로
 * 단단히 돌고, 늙은 별만 Ω(r)로 차등 회전하며 팔을 지나간다(셰이더가 지나가는 순간 밝힌다). 그래서 오래 켜 둬도 팔이 감기지 않는다.
 * 팔은 '끌리는(trailing)' 방향: 바깥으로 갈수록 회전 반대쪽으로 휜다. 팔 안쪽(오목) 가장자리 먼지 → 분홍 HII → 청백 젊은 별 순.
 */

export const ARM_PITCH_DEG = 18 // 15°는 3/4 뷰에서 고리처럼 읽혀 18°로 연다 (팔 하나가 약 190° 감김, NGC 1300·M83 쪽)
export const ARM_PITCH = (ARM_PITCH_DEG * Math.PI) / 180
export const BAR_ANGLE = (32 * Math.PI) / 180 // 막대 장축 (그래프 장소 = 막대 끝 HII 복합체)
export const BAR_LEN = 4.5
const ARM_START = BAR_ANGLE + (15 * Math.PI) / 180
const PK = 1 / Math.tan(ARM_PITCH)
/** 패턴 좌표의 팔 각도. arm 0·1 = 큰 팔(막대 양 끝), 0.5·1.5 = 작은 팔. 바깥으로 갈수록 각이 줄어든다(끌리는 팔) */
export function armAngle(r: number, arm: number): number {
  return ARM_START + arm * Math.PI - Math.log(Math.max(r, 0.5) / BAR_LEN) * PK
}

/** 별 자전 (design-v4 §3·§7): 코어(r ≤ 3u) 1.2°/s, 바깥 Ω ∝ 1/r (15u에서 0.24°/s) */
export function omega(r: number): number {
  return ((1.2 * Math.PI) / 180) * (3 / Math.max(3, r))
}
/** 패턴(팔·막대·먼지·HII·젊은 별) 각속도 Ωp = Ω(9u) = 0.4°/s — 공동회전 반지름 9u */
export const OMEGA_P = omega(9)

/* 팔의 성격: 큰 팔 2(밝음) + 작은 팔 2(어둡고 6–11u에만). 길이 방향으로 밝기가 변하고 끊긴다 */
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
const segOf = (rad: number, ph: number) => sstep(-0.15, 0.6, Math.sin(rad * 1.9 + ph) * 0.6 + Math.sin(rad * 0.71 + ph * 1.7) * 0.4)
const spanOf = (k: number, rad: number) => (ARMS[k]!.w > 0.9 ? 1 - sstep(10.5, 14.5, rad) : sstep(5.5, 6.5, rad) * (1 - sstep(9.5, 11.5, rad)))
/** 팔 k의 세기(반지름 rad): 코어 쪽 밝음 → 바깥 흩어짐, 매듭과 끊김 */
function armStr(k: number, rad: number) {
  if (rad < BAR_LEN) return 0
  const A = ARMS[k]!
  return A.w * Math.exp(-(rad - BAR_LEN) / 6.5) * (0.06 + 0.94 * segOf(rad, A.ph)) * spanOf(k, rad)
}

/** 늙은 별의 팔 밝기 (정점 셰이더용 GLSL) — 위 armAngle·armStr과 같은 식, 단 끊김을 약하게(넓고 부드러운 밀도파) */
export const ARM_GLSL = /* glsl */ `
const float BAR_L = ${BAR_LEN.toFixed(4)};
const float ARM_S = ${ARM_START.toFixed(6)};
const float ARM_PK = ${PK.toFixed(6)};
const float ARM_SINP = ${Math.sin(ARM_PITCH).toFixed(6)};
const float OMEGA_P = ${OMEGA_P.toFixed(8)};
const vec4 ARM_A = vec4(0.0, 1.0, 0.5, 1.5);
const vec4 ARM_W = vec4(1.0, 1.0, 0.5, 0.45);
const vec4 ARM_PH = vec4(0.3, 2.1, 4.0, 5.2);
float wrapA(float x) { return x - 6.2831853 * floor((x + 3.14159265) / 6.2831853); }
float oldArm(float r, float phi) {
  if (r < BAR_L) return 0.0;
  float s = 0.0;
  for (int k = 0; k < 4; k++) {
    float ph = ARM_PH[k];
    float th = ARM_S + ARM_A[k] * 3.14159265 - log(max(r, 0.5) / BAR_L) * ARM_PK;
    float d = r * wrapA(phi - th) * ARM_SINP - 0.12;   // 팔 가운데보다 살짝 바깥(하류)
    float seg = 0.45 + 0.55 * smoothstep(-0.15, 0.6, sin(r * 1.9 + ph) * 0.6 + sin(r * 0.71 + ph * 1.7) * 0.4);
    float span = ARM_W[k] > 0.9 ? 1.0 - smoothstep(10.5, 14.5, r) : smoothstep(5.5, 6.5, r) * (1.0 - smoothstep(9.5, 11.5, r));
    s += ARM_W[k] * exp(-(r - BAR_L) / 7.5) * seg * span * exp(-d * d / 1.0);
  }
  return s;
}
`

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

type C3 = [number, number, number]
const hex = (h: string): C3 => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255]
const mix3 = (a: C3, b: C3, k: number): C3 => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]
const polarXZ = (rad: number, th: number, y: number): [number, number, number] => [rad * Math.cos(th), y, rad * Math.sin(th)]

/** 장소에 맞춘 구조물 (design-v4 §4, 패턴 좌표 t=0): 복습 = 큰 팔 위 젊은 산개성단, 그래프 = 막대 끝 HII 복합체,
 *  집중 = 나의 자리(작은 팔 가지), 노트 = 바깥 팔 사이의 조용한 끝. 모두 패턴과 함께 돈다 */
export const LANDMARKS = {
  review: polarXZ(7.3, armAngle(7.0, 0), 0.1),
  graph: polarXZ(4.95, armAngle(4.95, 0) - 0.05, 0.2),
  focus: [-6.2, 0.15, -5.0] as [number, number, number],
  notes: [-10.5, 0, 6.0] as [number, number, number],
}

export function makeGalaxy(starCount: number, cloudScale: number, seed = 1016): GalaxyData {
  const r = rng(seed)
  const S = new Float32Array(starCount * 8)
  let i = 0
  const put = (x: number, y: number, z: number, L: number, c: C3, kind: number) => {
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
  const lum = (k: number) => Math.min(60, 0.05 * Math.pow(r() + 1e-4, -k))
  const OLD_IN = hex('#FFE2B8')
  const OLD_OUT = hex('#F1E6D6')
  const YOUNG = hex('#A9C4FF')
  const YOUNG2 = hex('#DCE7FF')
  // 비율 (A 40만 기준): 먼 하늘 5% · 헤일로 3% · 팽대부+막대 14% · 젊은 별 14% · 늙은 원반 나머지
  const nHalo = Math.round(starCount * 0.03)
  const nBulge = Math.round(starCount * 0.14)
  const nYoung = Math.round(starCount * 0.14)
  const nBg = Math.round(starCount * 0.05)
  const nOld = starCount - nHalo - nBulge - nYoung - nBg

  const pickArm = (rad: number) => {
    const w = ARMS.map((_, k) => armStr(k, rad))
    const tot = w.reduce((a, b) => a + b, 0)
    if (tot <= 0) return -1
    let x = r() * tot
    for (let k = 0; k < 4; k++) if ((x -= w[k]!) <= 0) return k
    return 0
  }
  /** 팔 위의 한 점 (r, 팔 k): 큰 팔은 9u 바깥에서 30%가 갈라진 가지로 */
  const armTh = (k: number, rad: number, branch: boolean) => {
    let th = armAngle(rad, ARMS[k]!.a)
    if (branch && ARMS[k]!.w > 0.9 && rad > 9) th -= 0.11 * (rad - 9)
    return th
  }
  /** 팔 위 자리 고르기: 세기에 비례해 받아들임 (끊긴 곳엔 덜 생긴다) */
  const armSpot = (rMin: number, rMax: number, pow = 1) => {
    for (let tries = 0; tries < 40; tries++) {
      const rad = rMin + Math.pow(r(), pow) * (rMax - rMin)
      const k = pickArm(rad)
      if (k < 0) continue
      if (r() < armStr(k, rad) * 1.25) return { rad, k, branch: r() < 0.3 }
    }
    return { rad: BAR_LEN + 1, k: 0, branch: false }
  }

  /* ---- 젊은 별 무리(OB 성협) 중심: 팔 바로 바깥(하류), 구슬 꿰듯 끊겨서 ---- */
  const nClump = 1500
  const clumps: Array<{ x: number; z: number; s: number; b: number; rad: number }> = []
  for (let c = 0; c < nClump; c++) {
    const { rad, k, branch } = armSpot(BAR_LEN + 0.3, 14, 1.15)
    // 10%는 팔에서 비스듬히 바깥으로 뻗는 깃털(스퍼) 위에
    let rr = rad + 0.18 + gauss(r) * 0.16
    let th = armTh(k, rad, branch) + (gauss(r) * 0.1) / rad
    if (r() < 0.1) {
      const t = r() * 1.6
      rr += t * 0.5
      th -= (t * 0.25) / rad
    }
    clumps.push({ x: rr * Math.cos(th), z: rr * Math.sin(th), s: 0.04 + Math.pow(r(), 2.2) * 0.26, b: 0.4 + r() * 1.1, rad: rr })
  }

  /* ---- 늙은 원반 별: 방위는 고르게(팔은 셰이더가 밝기로) — 차등 회전해도 감길 무늬가 없다 ---- */
  for (let n = 0; n < nOld; n++) {
    let rad = -3.6 * Math.log(1 - r() * 0.985)
    if (rad > 15.5) rad = 15.5 * Math.sqrt(r())
    rad = Math.max(rad, 0.5)
    const th = r() * Math.PI * 2
    const kOut = Math.min(1, rad / 15)
    const h = 0.3 * (0.55 + rad / 14)
    // 가장자리 휨(warp): 12u 바깥에서 한쪽은 올라가고 반대쪽은 내려간다
    const warp = rad > 11 ? 0.06 * (rad - 11) * (rad - 11) * Math.sin(th - 0.6) : 0
    const c = r() < 0.06 ? blackbody(3300 + r() * 600) : mix3(OLD_IN, OLD_OUT, kOut)
    put(rad * Math.cos(th), gauss(r) * h * 0.5 + warp, rad * Math.sin(th), lum(0.55), c, 0)
  }

  /* ---- 팽대부 + 막대: 크림·금, 3축 1 : 0.6 : 0.45, 막대 반길이 4.5u — 패턴과 함께 단단히(kind 1) ---- */
  const CORE = [hex('#FFF1D6'), hex('#F6C98A'), hex('#E9A970')] as const
  for (let n = 0; n < nBulge; n++) {
    const bar = r() < 0.55
    const a = bar ? BAR_LEN : 2.2
    const rr = Math.pow(r(), bar ? 0.85 : 1.7)
    const u = r() * 2 - 1
    const ph = r() * Math.PI * 2
    const sxy = Math.sqrt(1 - u * u)
    const x0 = rr * a * sxy * Math.cos(ph)
    const z0 = rr * a * sxy * Math.sin(ph) * (bar ? 0.28 : 0.62)
    const y = rr * a * u * (bar ? 0.16 : 0.42)
    const x = x0 * Math.cos(BAR_ANGLE) - z0 * Math.sin(BAR_ANGLE)
    const z = x0 * Math.sin(BAR_ANGLE) + z0 * Math.cos(BAR_ANGLE)
    const k = Math.min(1, rr * 1.3)
    const c = k < 0.5 ? mix3(CORE[0], CORE[1], k * 2) : mix3(CORE[1], CORE[2], (k - 0.5) * 2)
    put(x, y, z, lum(0.55) * 0.8, c, 1)
  }

  /* ---- 헤일로: 반지름 40u 구, 그중 60개 구상성단 — 거의 돌지 않는다(kind 2, 2층 시차) ---- */
  for (let n = 0; n < nHalo; n++) {
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

  /* ---- 젊은 별 (kind 4, 패턴과 함께): 70%는 성협 안, 30%는 팔 하류에 흩어짐. 복습 성단 600 · 나의 자리 300 ---- */
  for (let n = 0; n < nYoung; n++) {
    const col = mix3(r() < 0.5 ? YOUNG : YOUNG2, blackbody(14000 + r() * 12000), 0.35)
    if (n < 600) {
      const m = LANDMARKS.review
      put(m[0] + gauss(r) * 0.32, m[1] + gauss(r) * 0.12, m[2] + gauss(r) * 0.32, lum(0.6) * 2.4, mix3(YOUNG, [1, 1, 1], r() * 0.4), 4)
      continue
    }
    if (n < 900) {
      const m = LANDMARKS.focus
      put(m[0] + gauss(r) * 0.9, m[1] + gauss(r) * 0.3, m[2] + gauss(r) * 0.9, lum(0.55), mix3(OLD_IN, YOUNG, r()), 4)
      continue
    }
    if (r() < 0.7) {
      const c = clumps[Math.floor(r() * clumps.length)]!
      put(c.x + gauss(r) * c.s, gauss(r) * 0.045, c.z + gauss(r) * c.s, lum(0.62) * 2.0 * c.b, col, 4)
    } else {
      const { rad, k, branch } = armSpot(BAR_LEN + 0.2, 14.5)
      const rr = rad + 0.25 + gauss(r) * 0.3
      const th = armTh(k, rad, branch) + (gauss(r) * 0.08) / rad
      put(rr * Math.cos(th), gauss(r) * 0.07, rr * Math.sin(th), lum(0.62) * 1.6, col, 4)
    }
  }

  /* ---- 먼 하늘: 방향만 (카메라 중심 구 위, 시차 없음 — 1층) ---- */
  while (i < starCount) {
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

  /* ================= 구름 (인스턴스 사각형, 모두 패턴과 함께) ================= */
  const nDust = Math.round(17000 * cloudScale)
  const nGlowDisk = Math.round(1400 * cloudScale)
  const nHIIgroups = Math.round(620 * cloudScale)
  const nBarGlow = 160
  const C = new Float32Array((nDust + nGlowDisk + nClump + nHIIgroups * 14 + 160 + nBarGlow + 120 + 9) * 8)
  let j = 0
  const cap = C.length / 8
  const cput = (x: number, y: number, z: number, size: number, c: C3, kind: number) => {
    if (j >= cap) return
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
  const DUST: C3 = [0.5, 0.72, 1.0] // 흡수: 파랑을 더 → 가장자리가 갈색으로
  /* 먼지: 팔 안쪽(오목) 가장자리를 따라 끊기는 가는 실 + 팔을 비스듬히 가로지르는 깃털(스퍼) + 팔 사이 성긴 먼지 조각 */
  for (let n = 0; n < nDust; n++) {
    const kindR = r()
    if (kindR < 0.12) {
      // 팔 사이·원반 전체의 성긴 먼지 조각 (원반이 너무 매끈하지 않게)
      const rad = 2.5 + Math.pow(r(), 0.9) * 11
      const th = r() * Math.PI * 2
      const op = 0.05 + r() * 0.12
      cput(rad * Math.cos(th), gauss(r) * 0.03, rad * Math.sin(th), 0.08 + r() * 0.16, [DUST[0] * op, DUST[1] * op, DUST[2] * op], 0)
      continue
    }
    const { rad, k, branch } = armSpot(BAR_LEN - 0.3, 13.5, 0.9)
    const ph = ARMS[k]!.ph
    // 실을 끊는 틈: 팔마다 다른 두 주파수
    const gap = Math.sin(rad * 4.3 + ph * 2.3) * Math.sin(rad * 1.7 + ph)
    if (gap < -0.3) {
      n--
      continue
    }
    let rr = rad - 0.3 + gauss(r) * 0.05
    let th = armTh(k, rad, branch)
    if (kindR < 0.34) {
      // 깃털: 먼지띠에서 팔을 비스듬히 가로질러 바깥으로 0.3–1.1u
      const t = r() * (0.3 + r() * 0.8)
      rr += t * 0.85
      th -= (t * 0.55) / rad
    }
    const op = (0.16 + r() * 0.42) * Math.min(1, armStr(k, rad) * 1.6 + 0.3)
    cput(rr * Math.cos(th), gauss(r) * 0.02, rr * Math.sin(th), 0.035 + Math.pow(r(), 1.5) * 0.12, [DUST[0] * op, DUST[1] * op, DUST[2] * op], 0)
  }
  /* 분해되지 않은 별빛: 원반 전체의 아주 흐린 금빛(매끈 — 감김과 무관) */
  for (let n = 0; n < nGlowDisk; n++) {
    const rad = 0.8 + -3.6 * Math.log(1 - r() * 0.95)
    const th = r() * Math.PI * 2
    const c = mix3(OLD_IN, OLD_OUT, Math.min(1, rad / 15))
    const k = 0.006 * (0.5 + r()) * Math.exp(-rad / 9)
    cput(rad * Math.cos(th), gauss(r) * 0.08, rad * Math.sin(th), 0.7 + r() * 1.3, [c[0] * k, c[1] * k, c[2] * k], 1)
  }
  /* 성협 둘레의 푸른 빛 — 작고 흐리게(밝은 덩어리 + 먼지 = 초승달이 되지 않게) */
  for (const c of clumps) {
    const k = 0.012 * c.b
    cput(c.x, gauss(r) * 0.03, c.z, c.s * 1.4 + 0.05, [YOUNG2[0] * k, YOUNG2[1] * k, YOUNG2[2] * k], 1)
  }
  /* HII: 작은 분홍 매듭 무리 — 성협 곁(먼지띠와 젊은 별 사이), 매듭 3–14개, 몇 개는 푸른 반사 성운 */
  const HII = hex('#F27BA8')
  const HII_CORE = hex('#FFC2D8')
  const grp = (x: number, z: number, spread: number, nK: number, big: number) => {
    for (let q = 0; q < nK; q++) {
      const k = 0.4 + r() * 0.6
      const core = r() < 0.2
      const c = core ? HII_CORE : HII
      const blue = r() < 0.06
      const cc: C3 = blue ? [0.3, 0.5, 1.0] : c
      cput(x + gauss(r) * spread, gauss(r) * 0.03, z + gauss(r) * spread, 0.012 + Math.pow(r(), 2.2) * big, [cc[0] * k, cc[1] * 0.55 * k, cc[2] * 0.8 * k], 2)
    }
  }
  for (let n = 0; n < nHIIgroups; n++) {
    const c = clumps[Math.floor(r() * clumps.length)]!
    // 성협에서 팔 안쪽(먼지 쪽)으로 조금
    const ux = c.x / c.rad
    const uz = c.z / c.rad
    grp(c.x - ux * 0.1, c.z - uz * 0.1, 0.05 + c.s * 0.6, 3 + Math.floor(r() * 11), 0.07)
  }
  // 그래프 장소: 막대 끝의 큰 HII 복합체 = 작은 매듭 무리 여러 개
  for (let g = 0; g < 12; g++) {
    const m = LANDMARKS.graph
    grp(m[0] + gauss(r) * 0.45, m[2] + gauss(r) * 0.45, 0.12, 13, 0.1)
  }
  /* 막대 빛: 막대를 따라 금빛 (가운데가 하얗게 날지 않게 약하게) */
  for (let n = 0; n < nBarGlow; n++) {
    const t = gauss(r) * BAR_LEN * 0.42
    const k = 0.026 + r() * 0.026
    const c = mix3(CORE[1], CORE[2], r() * 0.6)
    cput(t * Math.cos(BAR_ANGLE), gauss(r) * 0.12, t * Math.sin(BAR_ANGLE), 0.5 + r() * 1.2, [c[0] * k, c[1] * k, c[2] * k], 3)
  }
  /* 복습 성단을 감싼 푸른 반사 성운 — 작은 조각 여럿(둥근 얼룩 하나가 아니게) */
  for (let n = 0; n < 120; n++) {
    const m = LANDMARKS.review
    const k = 0.05 + r() * 0.05
    cput(m[0] + gauss(r) * 0.35, m[1] + gauss(r) * 0.1, m[2] + gauss(r) * 0.35, 0.04 + Math.pow(r(), 2) * 0.16, [0.3 * k, 0.5 * k, 1.0 * k], 2)
  }
  /* 먼 은하 몇 개 (하늘 구 위의 작은 타원 얼룩) — 1층 깊이 단서 */
  for (let n = 0; n < 9; n++) {
    const u = r() * 1.6 - 0.8
    const ph = r() * Math.PI * 2
    const sxy = Math.sqrt(1 - u * u)
    const k = 0.25 + r() * 0.35
    const c = mix3(hex('#FFE2B8'), hex('#C9D6FF'), r())
    if (j >= cap) break
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
