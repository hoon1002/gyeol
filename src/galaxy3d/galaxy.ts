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

export const ARM_PITCH_DEG = 22 // 15·18°는 3/4 뷰에서 막대를 감싼 고리로 읽혀 22°로 연다 (큰 팔 하나가 약 170° — NGC 1300 쪽)
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
  { a: 0.5, w: 0.32, ph: 4.0 },
  { a: 1.5, w: 0.28, ph: 5.2 },
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
  // 막대 끝에서 바로 가장 밝으면 막대를 감싼 고리처럼 읽힌다 → 6–9u에서 가장 밝게
  return A.w * (0.7 + 0.3 * sstep(BAR_LEN, 6.0, rad)) * Math.exp(-(rad - 5) / 7.5) * (0.5 + 0.5 * segOf(rad, A.ph)) * spanOf(k, rad)
}

/** 늙은 별의 팔 밝기 (정점 셰이더용 GLSL) — 위 armAngle·armStr과 같은 식, 단 끊김을 약하게(넓고 부드러운 밀도파) */
export const ARM_GLSL = /* glsl */ `
const float BAR_L = ${BAR_LEN.toFixed(4)};
const float ARM_S = ${ARM_START.toFixed(6)};
const float ARM_PK = ${PK.toFixed(6)};
const float ARM_SINP = ${Math.sin(ARM_PITCH).toFixed(6)};
const float OMEGA_P = ${OMEGA_P.toFixed(8)};
const vec4 ARM_A = vec4(0.0, 1.0, 0.5, 1.5);
const vec4 ARM_W = vec4(1.0, 1.0, 0.32, 0.28);
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
    s += ARM_W[k] * (0.7 + 0.3 * smoothstep(BAR_L, 6.0, r)) * exp(-(r - 5.0) / 7.5) * seg * span * exp(-d * d / 1.0);
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
  /** 구름 앞쪽 dustCount개가 먼지(kind 0) — 먼지·빛 패스를 범위로 나눠 그린다 */
  dustCount: number
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
    let rr = rad + 0.22 + gauss(r) * 0.32
    let th = armTh(k, rad, branch) + (gauss(r) * 0.18) / rad
    if (r() < 0.1) {
      const t = r() * 1.6
      rr += t * 0.5
      th -= (t * 0.25) / rad
    }
    clumps.push({ x: rr * Math.cos(th), z: rr * Math.sin(th), s: 0.06 + Math.pow(r(), 1.8) * 0.3, b: 0.4 + r() * 1.0, rad: rr })
  }

  /* ---- 늙은 원반 별: 방위는 고르게(팔은 셰이더가 밝기로) — 차등 회전해도 감길 무늬가 없다 ---- */
  for (let n = 0; n < nOld; n++) {
    let rad = -3.6 * Math.log(1 - r() * 0.985)
    if (rad > 15.5) rad = 15.5 * Math.sqrt(r())
    if (rad < 0.6 || r() > 0.12 + 0.88 * sstep(1.5, 5.8, rad)) {
      n-- // 중심은 팽대부·막대 몫 (원반 빛이 가운데 둥근 덩어리가 되지 않게)
      continue
    }
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
    const bar = r() < 0.75
    const a = bar ? BAR_LEN : 1.7
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
    put(x, y, z, lum(0.55) * (bar ? 0.62 : 0.32), c, 1)
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
  /* HII 매듭 150–250개: 작고 또렷한 분홍 점(별처럼 반짝이는 크기) + 아주 작은 빛무리. 성협 곁(먼지띠 쪽), 몇 개만 조금 크게 */
  const knots: Array<[number, number, number, number]> = [] // x, z, 크기, 밝기
  for (let g = 0; g < 70; g++) {
    const c = clumps[Math.floor(r() * clumps.length)]!
    const nk = 2 + Math.floor(r() * 3)
    for (let q = 0; q < nk; q++) knots.push([c.x - (c.x / c.rad) * 0.08 + gauss(r) * 0.06, c.z - (c.z / c.rad) * 0.08 + gauss(r) * 0.06, Math.pow(r(), 3), 0.6 + r() * 0.8])
  }
  for (let q = 0; q < 26; q++) knots.push([LANDMARKS.graph[0] + gauss(r) * 0.35, LANDMARKS.graph[2] + gauss(r) * 0.35, Math.pow(r(), 2.5), 0.8 + r()])
  const PINK_STAR: C3 = [1.0, 0.56, 0.74]
  for (let n = 0; n < nYoung; n++) {
    const col = mix3(r() < 0.6 ? YOUNG : YOUNG2, blackbody(16000 + r() * 14000), 0.3)
    if (n >= 900 && n < 900 + knots.length) {
      const kn = knots[n - 900]!
      put(kn[0], gauss(r) * 0.02, kn[1], (3 + 9 * kn[2]) * kn[3], PINK_STAR, 4)
      continue
    }
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
    if (r() < 0.42) {
      const c = clumps[Math.floor(r() * clumps.length)]!
      put(c.x + gauss(r) * c.s, gauss(r) * 0.045, c.z + gauss(r) * c.s, lum(0.62) * 2.0 * c.b, col, 4)
    } else {
      // 팔 하류로 넓게 흩어진 젊은 별 (팔이 가는 띠가 아니라 넓은 빛의 길이 되게)
      const { rad, k, branch } = armSpot(BAR_LEN + 0.2, 14.5)
      const rr = rad + 0.3 + gauss(r) * 0.65
      const th = armTh(k, rad, branch) + (gauss(r) * 0.3) / rad
      put(rr * Math.cos(th), gauss(r) * 0.08, rr * Math.sin(th), lum(0.62) * 1.8, col, 4)
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
  const nGlowDisk = Math.round(3600 * cloudScale)
    const nBarGlow = 160
  const C = new Float32Array((nDust + nGlowDisk + nClump + 300 + 160 + nBarGlow + 120 + 9) * 8)
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
  /* 먼지(B): 팔 안쪽 가장자리를 따라 '이어진' 가는 줄기. 짧은 조각을 팔을 따라 0.03u마다 겹쳐 놓아 끊김·둥근 끝이 없고,
     농도·폭·위치는 fbm 노이즈로 천천히 바뀐다(주 줄기 + 가는 곁줄기 2). 팔을 비스듬히 가로지르는 가는 가시(spur) 몇 가닥(kind 0.3) */
  const hsh = (n: number) => {
    const v = Math.sin(n * 127.1 + 311.7) * 43758.5453
    return v - Math.floor(v)
  }
  const vnoise = (x: number, sd: number) => {
    const i0 = Math.floor(x)
    const f = x - i0
    const u = f * f * (3 - 2 * f)
    return hsh(i0 + sd * 101) * (1 - u) + hsh(i0 + 1 + sd * 101) * u
  }
  const fbm = (x: number, sd: number) => 0.5 * vnoise(x, sd) + 0.3 * vnoise(x * 2.13 + 5.2, sd + 1) + 0.2 * vnoise(x * 4.37 + 1.7, sd + 2)
  const dput = (rr: number, th: number, size: number, op: number, kind: number) =>
    cput(rr * Math.cos(th), gauss(r) * 0.012, rr * Math.sin(th), size, [DUST[0] * op, DUST[1] * op, DUST[2] * op], kind)
  const ds = 0.03 / Math.max(0.5, cloudScale)
  const drs = ds * Math.sin(ARM_PITCH)
  for (let k = 0; k < 4; k++) {
    const big = ARMS[k]!.w > 0.9
    const rMin = big ? BAR_LEN - 0.1 : 5.7
    const rMax = big ? 13.6 : 11.2
    for (let sub = 0; sub < 3; sub++) {
      const off = sub === 0 ? 0 : sub === 1 ? -0.15 : 0.17
      const sd = k * 10 + sub * 3
      for (let rad = rMin; rad < rMax; rad += drs) {
        const sArc = (rad - rMin) / Math.sin(ARM_PITCH)
        const n1 = fbm(sArc * 0.32, sd)
        const n2 = fbm(sArc * 0.55 + 7, sd)
        const fadeEnds = sstep(rMin, rMin + 0.6, rad) * (1 - sstep(rMax - 1.5, rMax, rad))
        const op = (sub === 0 ? 0.11 : 0.04) * sstep(0.22, 0.62, n1) * fadeEnds * Math.min(1, armStr(k, rad) * 1.8 + 0.35)
        if (op < 0.003) continue
        const w = (0.045 + 0.085 * n2) * (sub === 0 ? 1 : 0.55)
        dput(rad + 0.02 + off + (n2 - 0.5) * 0.14, armAngle(rad, ARMS[k]!.a), w, op, 0) // 팔 빛의 안쪽 절반을 가르는 자리(빛이 있어야 먼지가 보인다)
      }
    }
  }
  for (let q = 0; q < Math.round(70 * cloudScale); q++) {
    const { rad, k } = armSpot(BAR_LEN + 0.8, 12.5)
    const len = 0.35 + r() * 0.85
    const th0 = armAngle(rad, ARMS[k]!.a)
    const sk = 0.35 + r() * 0.35
    for (let t = 0; t < len; t += ds) {
      const op = 0.028 * (1 - t / len) * (0.5 + fbm(t * 3 + q, 50 + q))
      dput(rad + 0.02 + t * 0.9, th0 - (t * sk) / rad, 0.025 + 0.02 * r(), op, 0.3)
    }
  }
  const dustCount = j
  /* 분해되지 않은 별빛 ① 원반 전체의 흐린 금빛(팔 사이도 검지 않게) ② 팔을 따라 넓고 부드러운 흰빛 — 둘 다 패턴에 붙어 감기지 않는다 */
  for (let n = 0; n < nGlowDisk; n++) {
    if (r() < 0.45) {
      const rad = 0.8 + -3.4 * Math.log(1 - r() * 0.95)
      const th = r() * Math.PI * 2
      const c = mix3(OLD_IN, OLD_OUT, Math.min(1, rad / 15))
      const k = 0.011 * (0.6 + r() * 0.8) * Math.exp(-rad / 7) * (0.25 + 0.75 * sstep(1.5, 5.5, rad)) // 막대 둘레는 어둡게(NGC 1300)
      cput(rad * Math.cos(th), gauss(r) * 0.08, rad * Math.sin(th), 0.8 + r() * 1.4, [c[0] * k, c[1] * k, c[2] * k], 1)
    } else {
      const { rad, k: arm, branch } = armSpot(BAR_LEN, 14)
      const rr = rad + 0.15 + gauss(r) * 0.5
      const th = armTh(arm, rad, branch) + (gauss(r) * 0.22) / rad
      const c = mix3(OLD_OUT, YOUNG2, 0.35 + r() * 0.4)
      const frag = 0.75 + 0.25 * Math.sin(rad * 11 + arm * 2.1) * Math.sin(rad * 2.9 + arm)
      const k = 0.026 * (0.5 + r()) * frag * Math.min(1, armStr(arm, rad) * 1.5 + 0.2)
      cput(rr * Math.cos(th), gauss(r) * 0.06, rr * Math.sin(th), 0.25 + r() * 0.55, [c[0] * k, c[1] * k, c[2] * k], 1)
    }
  }
  /* 성협 둘레의 푸른 빛 — 작고 흐리게(밝은 덩어리 + 먼지 = 초승달이 되지 않게) */
  for (const c of clumps) {
    const k = 0.012 * c.b
    cput(c.x, gauss(r) * 0.03, c.z, c.s * 1.4 + 0.05, [YOUNG2[0] * k, YOUNG2[1] * k, YOUNG2[2] * k], 1)
  }
  /* HII 빛무리: 매듭 별마다 아주 작은 분홍 빛(대부분 0.015–0.04u, 몇 개만 0.1u) — 둥근 얼룩이 아니라 별 둘레의 엷은 빛 */
  const HII: C3 = [1.0, 0.42, 0.62]
  for (const kn of knots) {
    const k = (0.35 + 0.4 * kn[3]) * (0.6 + 0.8 * kn[2])
    cput(kn[0], gauss(r) * 0.02, kn[1], 0.015 + 0.09 * kn[2], [HII[0] * k, HII[1] * k, HII[2] * k], 2)
  }
  /* 막대 빛: 막대를 따라 금빛 (가운데가 하얗게 날지 않게 약하게) */
  for (let n = 0; n < nBarGlow; n++) {
    const t = gauss(r) * BAR_LEN * 0.42
    const k = 0.018 + r() * 0.018
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
  return { stars: S, starCount: i, clouds: C, cloudCount: j, dustCount }
}

/** 늙은 별 팔 밝기 조회 텍스처 (정점당 4팔 루프 → 텍스처 1회): 가로 φ(패턴 좌표) 1024 · 세로 r 0–16u 256, RG8.
 *  R = 팔 밝기 / 1.6 (ARM_GLSL의 oldArm과 같은 식) · G = 패턴에 붙은 얼룩 − 0.5 */
export const ARM_TEX_W = 1024
export const ARM_TEX_H = 256
export function bakeArmTex(): Uint8Array {
  const out = new Uint8Array(ARM_TEX_W * ARM_TEX_H * 2)
  const sm = (e0: number, e1: number, x: number) => sstep(e0, e1, x)
  for (let y = 0; y < ARM_TEX_H; y++) {
    const r = ((y + 0.5) / ARM_TEX_H) * 16
    for (let x = 0; x < ARM_TEX_W; x++) {
      const phi = ((x + 0.5) / ARM_TEX_W) * Math.PI * 2
      let a = 0
      if (r >= BAR_LEN)
        for (let k = 0; k < 4; k++) {
          const A = ARMS[k]!
          const th = ARM_START + A.a * Math.PI - Math.log(Math.max(r, 0.5) / BAR_LEN) * PK
          let w = phi - th
          w -= 2 * Math.PI * Math.floor((w + Math.PI) / (2 * Math.PI))
          const d = r * w * Math.sin(ARM_PITCH) - 0.12
          const seg = 0.45 + 0.55 * sm(-0.15, 0.6, Math.sin(r * 1.9 + A.ph) * 0.6 + Math.sin(r * 0.71 + A.ph * 1.7) * 0.4)
          const span = A.w > 0.9 ? 1 - sm(10.5, 14.5, r) : sm(5.5, 6.5, r) * (1 - sm(9.5, 11.5, r))
          a += A.w * (0.7 + 0.3 * sm(BAR_LEN, 6.0, r)) * Math.exp(-(r - 5) / 7.5) * seg * span * Math.exp(-d * d)
        }
      const qx = r * Math.cos(phi)
      const qz = r * Math.sin(phi)
      const m = 1 + 0.22 * Math.sin(qx * 1.31 + qz * 0.73) * Math.sin(qz * 1.07 - qx * 0.41) + 0.14 * Math.sin(qx * 3.7 - qz * 2.9) * Math.sin(qz * 3.3 + qx * 1.9)
      const o = (y * ARM_TEX_W + x) * 2
      out[o] = Math.round(Math.min(1, a / 1.6) * 255)
      out[o + 1] = Math.round(Math.min(1, Math.max(0, m - 0.5)) * 255)
    }
  }
  return out
}
