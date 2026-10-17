/**
 * 결 v4 — 3D 은하 시제품 (앱 코드와 분리). http://127.0.0.1:5173/galaxy3d.html
 * 캔버스 1개 · rAF 1개. 입자는 시작 때 한 번 GPU에 올리고, 매 프레임 CPU는 카메라 행렬과 유니폼만 바꾼다.
 * 쿼리: ?tier=A|B|C · ?rot=on|slow|off · ?place=today|… · ?clean=1(UI 숨김) · ?hud=0
 */
import { makeGalaxy, omega, LANDMARKS } from './galaxy'
import * as SH from './shaders'

type Tier = 'A' | 'B' | 'C'
type Rot = 'on' | 'slow' | 'off'
const TIERS: Record<Tier, { stars: number; clouds: number; scale: number; bloom: number }> = {
  // design-v4 §1: A 40만 · B 16만 · C 10만(정지 이미지용)
  A: { stars: 400_000, clouds: 1, scale: 1, bloom: 6 },
  B: { stars: 160_000, clouds: 0.7, scale: 0.75, bloom: 5 },
  C: { stars: 100_000, clouds: 0.4, scale: 0.6, bloom: 4 },
}
const ROT: Record<Rot, number> = { on: 1, slow: 1 / 3, off: 0 } // 코어 1.2 · 0.4 · 0°/s

/* ---------- 장소 (design-v4 §4: 3D 공간 지도) ---------- */
interface Place {
  id: string
  name: string
  sub: string
  /** 바라보는 점 (은하 좌표, t=0). 은하와 함께 돈다 */
  t: [number, number, number]
  /** 방위(°, +X에서 반시계) · 고도(°) · 거리(u) */
  az: number
  el: number
  dist: number
  expo: number
}
const PLACES: Place[] = [
  { id: 'today', name: '오늘', sub: '은하 전체를 3/4 높이에서', t: [0, 0, 0], az: 210, el: 28, dist: 38, expo: 1 },
  { id: 'planner', name: '플래너', sub: '물러나 더 높이 — 앞날을 멀리 본다', t: [0, 0, 0], az: 210, el: 40, dist: 54, expo: 0.95 },
  { id: 'notes', name: '노트', sub: '바깥 팔의 조용한 끝', t: LANDMARKS.notes, az: 228, el: 16, dist: 9, expo: 0.9 },
  { id: 'review', name: '복습', sub: '팔 위의 젊은 산개성단', t: LANDMARKS.review, az: 202, el: 22, dist: 6, expo: 1 },
  { id: 'graph', name: '그래프', sub: '막대 끝의 HII 성운 — 생각의 성운', t: LANDMARKS.graph, az: 198, el: 25, dist: 7, expo: 1 },
  { id: 'focus', name: '집중', sub: '나의 자리 — 팔 사이 가지', t: LANDMARKS.focus, az: 220, el: 12, dist: 3.5, expo: 0.9 },
  { id: 'settings', name: '설정', sub: '집 안, 어둡게', t: [0, 0, 0], az: 210, el: 28, dist: 38, expo: 0.65 },
]
/** 화면에서 은하 중심(바라보는 점)의 자리 (design-v4: 0.66, 0.44) · 원반 장축 57° 대각선이 되도록 고정 기울기(롤 변화 0) */
const SEAT = [0.66, 0.44]
let EMIT = 0.22
let STAR = 2.2
const TILT = -57

/* ---------- 수학 ---------- */
const DEG = Math.PI / 180
type V3 = [number, number, number]
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}
function viewProj(eye: V3, target: V3, fovY: number, aspect: number, near: number, far: number) {
  const f = norm(sub(target, eye))
  const s0 = norm(cross(f, [0, 1, 0]))
  const u0 = cross(s0, f)
  // 고정 기울기(롤 변화 없음): 원반이 화면에서 57° 대각선으로 흐른다
  const ca = Math.cos(TILT * DEG)
  const sa = Math.sin(TILT * DEG)
  const s: V3 = [s0[0] * ca + u0[0] * sa, s0[1] * ca + u0[1] * sa, s0[2] * ca + u0[2] * sa]
  const u: V3 = [-s0[0] * sa + u0[0] * ca, -s0[1] * sa + u0[1] * ca, -s0[2] * sa + u0[2] * ca]
  const view = [s[0], u[0], -f[0], 0, s[1], u[1], -f[1], 0, s[2], u[2], -f[2], 0, -(s[0] * eye[0] + s[1] * eye[1] + s[2] * eye[2]), -(u[0] * eye[0] + u[1] * eye[1] + u[2] * eye[2]), f[0] * eye[0] + f[1] * eye[1] + f[2] * eye[2], 1]
  const t = 1 / Math.tan(fovY / 2)
  const p = [t / aspect, 0, 0, 0, 0, t, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0]
  // 렌즈 이동: 바라보는 점이 화면 SEAT에 온다 (FOV 고정)
  p[8] = -(SEAT[0]! - 0.5) * 2
  p[9] = (SEAT[1]! - 0.5) * 2
  const m = new Float32Array(16)
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let v = 0
    for (let k = 0; k < 4; k++) v += p[k * 4 + r]! * view[c * 4 + k]!
    m[c * 4 + r] = v
  }
  return { m, right: s, up: u }
}
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

/* ---------- GL ---------- */
const qs = new URLSearchParams(location.search)
const canvas = document.getElementById('cv') as HTMLCanvasElement
const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, premultipliedAlpha: false })!
const hdr = !!gl.getExtension('EXT_color_buffer_float')
function guessTier(): Tier {
  const ext = gl.getExtension('WEBGL_debug_renderer_info')
  const ren = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '').toLowerCase()
  if (/swiftshader|llvmpipe/.test(ren)) return 'C'
  if (/apple m\d|nvidia|geforce|rtx|radeon/.test(ren)) return 'A'
  return 'B'
}
let tier: Tier = (['A', 'B', 'C'].includes(qs.get('tier') ?? '') ? qs.get('tier') : guessTier()) as Tier
const reducedOS = matchMedia('(prefers-reduced-motion: reduce)').matches
let rot: Rot = reducedOS ? 'off' : ((qs.get('rot') as Rot) ?? 'on')
if (!(rot in ROT)) rot = 'on'

function prog(vs: string, fs: string) {
  const mk = (t: number, s: string) => {
    const sh = gl.createShader(t)!
    gl.shaderSource(sh, s)
    gl.compileShader(sh)
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? 'compile')
    return sh
  }
  const p = gl.createProgram()!
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vs))
  gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs))
  gl.linkProgram(p)
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link')
  const u = new Proxy({} as Record<string, WebGLUniformLocation | null>, { get: (c, k: string) => (k in c ? c[k] : (c[k] = gl.getUniformLocation(p, k))) })
  return { p, u }
}
const P = {
  star: prog(SH.STAR_VS, SH.STAR_FS),
  cloud: prog(SH.CLOUD_VS, SH.CLOUD_FS),
  down: prog(SH.FULL_VS, SH.DOWN_FS),
  up: prog(SH.FULL_VS, SH.UP_FS),
  comp: prog(SH.FULL_VS, SH.COMPOSITE_FS),
  blit: prog(SH.FULL_VS, SH.BLIT_FS),
  fg: prog(SH.FG_VS, SH.STAR_FS),
}
/* 전경 별 층: 카메라 둘레 반지름 FG_R 상자에 FG_N개 (위치는 시드 고정, 감싸기는 셰이더) */
const FG_N = 600 // design-v4 §7: 카메라 둘레 0.3–4u 600개
const FG_R = 4
const fgVao = (() => {
  let a = 77 >>> 0
  const rnd = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), a | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const d = new Float32Array(FG_N * 8)
  for (let i = 0; i < FG_N; i++) {
    const o = i * 8
    d[o] = (rnd() * 2 - 1) * FG_R
    d[o + 1] = (rnd() * 2 - 1) * FG_R * 0.6
    d[o + 2] = (rnd() * 2 - 1) * FG_R
    d[o + 3] = 0.002 + Math.pow(rnd(), 5) * 0.05
    const T = rnd()
    const c = T < 0.2 ? [0.75, 0.83, 1] : T < 0.75 ? [1, 0.97, 0.92] : [1, 0.85, 0.66]
    d[o + 4] = c[0]!
    d[o + 5] = c[1]!
    d[o + 6] = c[2]!
  }
  const vao = gl.createVertexArray()!
  gl.bindVertexArray(vao)
  const b = gl.createBuffer()!
  gl.bindBuffer(gl.ARRAY_BUFFER, b)
  gl.bufferData(gl.ARRAY_BUFFER, d, gl.STATIC_DRAW)
  gl.enableVertexAttribArray(0)
  gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 32, 0)
  gl.enableVertexAttribArray(1)
  gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 16)
  gl.bindVertexArray(null)
  return vao
})()
const vaoEmpty = gl.createVertexArray()!

interface RT {
  fb: WebGLFramebuffer
  tex: WebGLTexture
  w: number
  h: number
}
function rt(w: number, h: number): RT {
  const tex = gl.createTexture()!
  gl.bindTexture(gl.TEXTURE_2D, tex)
  if (hdr) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null)
  else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  const fb = gl.createFramebuffer()!
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  return { fb, tex, w, h }
}
const freeRT = (t: RT | null) => {
  if (!t) return
  gl.deleteFramebuffer(t.fb)
  gl.deleteTexture(t.tex)
}

/* ---------- 입자 올리기 ---------- */
let starVao: WebGLVertexArrayObject | null = null
let cloudVao: WebGLVertexArrayObject | null = null
let starN = 0
let cloudN = 0
let genMs = 0
const bufs: WebGLBuffer[] = []
function upload() {
  const t0 = performance.now()
  const T = TIERS[tier]
  const g = makeGalaxy(T.stars, T.clouds)
  genMs = performance.now() - t0
  bufs.forEach((b) => gl.deleteBuffer(b))
  bufs.length = 0
  const mkVao = (data: Float32Array, inst: boolean) => {
    const vao = gl.createVertexArray()!
    gl.bindVertexArray(vao)
    const b = gl.createBuffer()!
    bufs.push(b)
    gl.bindBuffer(gl.ARRAY_BUFFER, b)
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 32, 0)
    gl.enableVertexAttribArray(1)
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 16)
    if (inst) {
      gl.vertexAttribDivisor(0, 1)
      gl.vertexAttribDivisor(1, 1)
    }
    gl.bindVertexArray(null)
    return vao
  }
  starVao = mkVao(g.stars, false)
  cloudVao = mkVao(g.clouds, true)
  starN = g.starCount
  cloudN = g.cloudCount
}

/* ---------- 크기 ---------- */
let W = 1
let H = 1
let dpr = 1
let scene: RT | null = null
let mips: RT[] = []
/* 구름은 반 해상도(픽셀 ¼)에 그린다 — 큰 사각형 수만 개의 채우기 비용을 줄인다 */
let dustRT: RT | null = null
let emitRT: RT | null = null
function resize() {
  dpr = Math.min(devicePixelRatio || 1, 2) * TIERS[tier].scale
  W = Math.max(2, Math.round(innerWidth * dpr))
  H = Math.max(2, Math.round(innerHeight * dpr))
  canvas.width = W
  canvas.height = H
  freeRT(scene)
  mips.forEach(freeRT)
  scene = rt(W, H)
  freeRT(dustRT)
  freeRT(emitRT)
  dustRT = rt(Math.max(1, W >> 1), Math.max(1, H >> 1))
  emitRT = rt(Math.max(1, W >> 1), Math.max(1, H >> 1))
  mips = []
  let w = W
  let h = H
  for (let i = 0; i < TIERS[tier].bloom; i++) {
    w = Math.max(1, w >> 1)
    h = Math.max(1, h >> 1)
    mips.push(rt(w, h))
  }
}

/* ---------- 카메라 ---------- */
interface Cam {
  tx: number
  ty: number
  tz: number
  dist: number
  yaw: number
  pitch: number
  expo: number
}
let simT = 0 // 은하 시계
function placeCam(pl: Place, t: number): Cam {
  // 은하와 같이 도는 장소: 바라보는 점과 방위가 Ω(r)·t만큼 돈다(가까운 별은 그대로, 먼 팔은 차등 회전으로 흐른다)
  const r = Math.hypot(pl.t[0], pl.t[2])
  const th0 = Math.atan2(pl.t[2], pl.t[0])
  const rotA = r < 0.01 ? 0 : omega(r) * t
  const th = th0 + rotA
  return { tx: r * Math.cos(th), ty: pl.t[1], tz: r * Math.sin(th), dist: pl.dist, yaw: pl.az * DEG + rotA, pitch: pl.el * DEG, expo: pl.expo }
}
let place = PLACES.find((p) => p.id === qs.get('place')) ?? PLACES[0]!
let cam: Cam = placeCam(place, 0)
let flight: { from: Cam; to: Place; t0: number; dur: number; v0: number } | null = null
let user = { yaw: 0, pitch: 0, zoom: 1, vy: 0, vp: 0 }
let flightMax = 0
let flightFrames: number[] = []
const flightLog: Array<{ to: string; ms: number; maxFrame: number; p95: number }> = []

function lerpCam(a: Cam, b: Cam, e: number, p: number): Cam {
  const dy = wrapPi(b.yaw - a.yaw)
  const far = Math.abs(Math.log(b.dist / a.dist)) + Math.hypot(b.tx - a.tx, b.tz - a.tz) / 6
  const arc = Math.sin(Math.PI * p)
  return {
    tx: a.tx + (b.tx - a.tx) * e,
    ty: a.ty + (b.ty - a.ty) * e,
    tz: a.tz + (b.tz - a.tz) * e,
    // 호를 따라: 중간에 살짝 물러나고(거리 ×(1+0.35·far·sin)) 조금 올라간다 — 롤 없음
    dist: Math.exp(Math.log(a.dist) + (Math.log(b.dist) - Math.log(a.dist)) * e) * (1 + Math.min(0.12, 0.04 * far) * arc),
    yaw: a.yaw + dy * e,
    pitch: a.pitch + (b.pitch - a.pitch) * e + Math.min(3, 1.5 * far) * DEG * arc,
    expo: a.expo + (b.expo - a.expo) * e,
  }
}
function curCam(now: number): { c: Cam; flying: boolean; v: number } {
  if (!flight) return { c: placeCam(place, simT), flying: false, v: 0 }
  const p = Math.min(1, (now - flight.t0) / flight.dur)
  let e: number
  let v: number
  if (flight.v0 > 0) {
    e = -2 * p ** 3 + 3 * p * p + flight.v0 * (p ** 3 - 2 * p * p + p)
    v = -6 * p * p + 6 * p + flight.v0 * (3 * p * p - 4 * p + 1)
  } else {
    e = easeInOut(p)
    v = (easeInOut(Math.min(1, p + 0.01)) - e) / 0.01
  }
  const c = lerpCam(flight.from, placeCam(flight.to, simT), Math.min(1, Math.max(0, e)), p)
  if (p >= 1) {
    const st = flightFrames.slice().sort((a, b) => a - b)
    flightLog.push({ to: flight.to.id, ms: flight.dur, maxFrame: flightMax, p95: st[Math.floor(0.95 * (st.length - 1))] ?? 0 })
    flight = null
    return { c: placeCam(place, simT), flying: false, v: 0 }
  }
  return { c, flying: true, v }
}
function flyTo(id: string) {
  const pl = PLACES.find((p) => p.id === id)
  if (!pl || pl === place) return
  const now = performance.now()
  const cur = curCam(now)
  const from: Cam = { ...cur.c, yaw: cur.c.yaw + user.yaw, pitch: cur.c.pitch + user.pitch, dist: cur.c.dist * user.zoom }
  user = { yaw: 0, pitch: 0, zoom: 1, vy: 0, vp: 0 }
  const to = placeCam(pl, simT)
  const dz = Math.abs(Math.log(to.dist / from.dist))
  const dp = Math.hypot(to.tx - from.tx, to.tz - from.tz)
  // design-v4 §3: 비행 1.2–1.8초, 방위 변화 ≤ 30°, FOV 고정
  const dur = reduced() ? 0 : Math.min(1800, Math.max(1200, 1200 + 200 * dz / Math.LN2 * 0.7 + 25 * dp))
  place = pl
  flightMax = 0
  flightFrames = []
  flight = dur ? { from, to: pl, t0: now, dur, v0: cur.flying ? Math.min(1.5, cur.v) : 0 } : null
  if (!dur) cam = to
  setTitle()
  updateButtons()
}
const reduced = () => reducedOS || rot === 'off'

/* ---------- 입력: 드래그 궤도(관성) · 휠 거리 ---------- */
let drag: { x: number; y: number; t: number } | null = null
canvas.addEventListener('pointerdown', (e) => {
  lastInput = performance.now()
  drag = { x: e.clientX, y: e.clientY, t: performance.now() }
  canvas.setPointerCapture(e.pointerId)
})
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return
  const now = performance.now()
  const dx = e.clientX - drag.x
  const dy = e.clientY - drag.y
  const dt = Math.max(1, now - drag.t)
  // 직접 돌려 보기: 방위 ±35° · 고도 ±12°, 최대 90°/s
  const cap = (v: number) => Math.max(-0.09 * DEG, Math.min(0.09 * DEG, v))
  user.vy = cap((-dx * 0.15 * DEG) / dt)
  user.vp = cap((dy * 0.15 * DEG) / dt)
  user.yaw += user.vy * dt // 360° 자유
  user.pitch = clampEl(user.pitch + user.vp * dt)
  releasedAt = 0
  lastInput = now
  drag = { x: e.clientX, y: e.clientY, t: now }
})
let releasedAt = 0
let lastInput = -1e9
let orbitK = 0
/** 고도는 8–55° 안 (드래그·공전 모두) */
const clampEl = (up: number) => Math.max(8 * DEG - cam.pitch, Math.min(55 * DEG - cam.pitch, up))
const endDrag = () => {
  drag = null
  releasedAt = performance.now()
}
canvas.addEventListener('pointerup', endDrag)
canvas.addEventListener('pointercancel', endDrag)
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault()
    user.zoom = Math.max(0.35, Math.min(2.6, user.zoom * Math.exp(e.deltaY * 0.0012)))
    lastInput = performance.now()
  },
  { passive: false },
)

/* ---------- UI ---------- */
const ui = document.getElementById('ui')!
const btns = new Map<string, HTMLButtonElement>()
function btn(label: string, key: string, on: () => void) {
  const b = document.createElement('button')
  b.type = 'button'
  b.textContent = label
  b.onclick = on
  ui.appendChild(b)
  btns.set(key, b)
}
PLACES.forEach((p) => btn(p.name, 'p:' + p.id, () => flyTo(p.id)))
ui.appendChild(Object.assign(document.createElement('span'), { className: 'sep' }))
;(['on', 'slow', 'off'] as Rot[]).forEach((r) =>
  btn({ on: '회전 켬', slow: '느리게', off: '끔' }[r], 'r:' + r, () => {
    if (reducedOS) return
    rot = r
    updateButtons()
  }),
)
ui.appendChild(Object.assign(document.createElement('span'), { className: 'sep' }))
;(['A', 'B', 'C'] as Tier[]).forEach((t) =>
  btn('등급 ' + t, 't:' + t, () => {
    if (t === tier) return
    tier = t
    upload()
    resize()
    updateButtons()
  }),
)
function updateButtons() {
  btns.forEach((b, k) => b.setAttribute('aria-pressed', String(k === 'p:' + place.id || k === 'r:' + rot || k === 't:' + tier)))
}
function setTitle() {
  document.getElementById('place')!.textContent = place.name
  document.getElementById('placeSub')!.textContent = place.sub
}
if (qs.get('clean') === '1') document.body.classList.add('clean')
const hud = document.getElementById('hud')!
if (qs.get('hud') === '0') hud.style.display = 'none'

/* ---------- 그리기 ---------- */
let last = 0
let frames: number[] = []
let fps = 0
let fpsN = 0
let fpsT = 0
let hudT = 0
let jsMs = 0
const t0 = performance.now()

/* ---------- 전력 상태 (design-v4 §7 · power-budget) ----------
   활동(입력·비행 2s 안) 60fps · 평소(입력 뒤 0–60s) 30fps · 깊은 대기(60s+) 15fps·공전 0.3°/s ·
   쉼(5분+ · 저전력 · saveData) 그리기 멈춤(0fps) · 숨김 0 (rAF가 서고, 돌아오면 600ms 램프) */
type Power = 'active' | 'normal' | 'deep' | 'rest'
let power: Power = 'active'
let lowPower = !!(navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData
;(navigator as Navigator & { getBattery?: () => Promise<{ charging: boolean; level: number }> }).getBattery?.().then((b) => {
  lowPower = lowPower || (!b.charging && b.level < 0.2)
})
let lastDraw = 0
let visibleAt = 0
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    visibleAt = performance.now()
    lastInput = visibleAt
  }
})
function powerState(now: number): Power {
  const idle = now - lastInput
  if (flight || drag || idle < 2000 || now - visibleAt < 600) return 'active'
  if (idle > 300_000 || (lowPower && idle > 60_000)) return 'rest'
  if (idle > 60_000) return 'deep'
  return lowPower ? 'deep' : 'normal'
}
const FRAME_MS: Record<Power, number> = { active: 1000 / 60, normal: 1000 / 30, deep: 1000 / 15, rest: Infinity }

function frame(now: number) {
  requestAnimationFrame(frame)
  power = powerState(now)
  if (now - lastDraw < FRAME_MS[power] - 2) return
  lastDraw = now
  const dt = last ? Math.min(100, now - last) : 16.7
  const interval = last ? now - last : 0
  last = now
  const j0 = performance.now()
  // 은하 시계: 회전 켬 1 · 느리게 0.35 · 끔 0 (프레임당 최대 50ms만 — 멈췄다 돌아와도 튀지 않는다)
  simT += (dt / 1000) * ROT[rot]
  // 관성
  if (!drag) {
    // 관성은 0.6초 안에 그 자리에서 멈춘다(되돌아가지 않음). 동작 줄이기면 관성 0
    if (reducedOS || now - releasedAt > 1200) {
      user.vy = 0
      user.vp = 0
    }
    const k = Math.exp(-dt / 500) // 관성 τ 0.5s, 최대 1.2s, 멈춘 자리 유지
    user.yaw += user.vy * dt
    user.pitch = clampEl(user.pitch + user.vp * dt)
    // 자동 공전 (design-v4 §7): 1.0°/s(느리게 0.4°/s), 마지막 입력 3s 뒤 4s에 걸쳐 시작, 입력이 오면 300ms 안에 멈춤, 깊은 대기 0.3°/s
    const want = !reduced() && !flight && !drag && now - lastInput > 3000 ? 1 : 0
    orbitK += want > orbitK ? Math.min(want - orbitK, dt / 4000) : Math.max(want - orbitK, -dt / 300)
    const rate = (power === 'deep' ? 0.3 : rot === 'slow' ? 0.4 : 1.0) * DEG
    user.yaw += (rate * orbitK * dt) / 1000
    user.vy *= k
    user.vp *= k
  }
  const st = curCam(now)
  cam = st.c
  // 카메라 호흡 (design-v4 §3): 방위 ±3° · 고도 ±1.5° · 거리 ±2% — 동작 줄이기·회전 끔이면 없음
  const bk = reduced() ? 0 : 1
  const tt = (now - t0) / 1000
  const settle = 1 + (1 / 0.84 - 1) * Math.pow(1 - Math.min(1, (now - t0) / 1300), 3) // 첫 진입 내려앉기 0.84 → 1.0
  const dist = cam.dist * user.zoom * (1 + 0.02 * bk * Math.sin((tt / 24) * Math.PI * 2)) * (reducedOS ? 1 : settle)
  const yaw = cam.yaw + user.yaw + 3 * DEG * bk * Math.sin((tt / 40) * Math.PI * 2)
  const pitch = Math.max(-80 * DEG, Math.min(85 * DEG, cam.pitch + user.pitch + 1.5 * DEG * bk * Math.sin((tt / 31) * Math.PI * 2 + 1)))
  const target: V3 = [cam.tx, cam.ty, cam.tz]
  const eye: V3 = [target[0] + dist * Math.cos(pitch) * Math.cos(yaw), target[1] + dist * Math.sin(pitch), target[2] + dist * Math.cos(pitch) * Math.sin(yaw)]
  const fov = 50 * DEG
  const vp = viewProj(eye, target, fov, W / H, 0.02, 3000)
  const px = H / 2 / Math.tan(fov / 2)
  const entrance = Math.min(1, (now - t0) / 1400)
  const expo = cam.expo * (0.55 + 0.45 * (1 - Math.pow(1 - entrance, 3)))

  if (!scene || !starVao || !cloudVao) return
  gl.bindFramebuffer(gl.FRAMEBUFFER, scene.fb)
  gl.viewport(0, 0, W, H)
  gl.clearColor(0, 0, 0, 1)
  gl.clear(gl.COLOR_BUFFER_BIT)
  gl.enable(gl.BLEND)
  // 1) 별 (가산)
  gl.blendFunc(gl.ONE, gl.ONE)
  const S = P.star
  gl.useProgram(S.p)
  gl.uniformMatrix4fv(S.u.uVP!, false, vp.m)
  gl.uniform3f(S.u.uCam!, eye[0], eye[1], eye[2])
  gl.uniform1f(S.u.uTime!, simT)
  gl.uniform1f(S.u.uPx!, px)
  gl.uniform1f(S.u.uExpo!, STAR)
  gl.uniform1f(S.u.uFocus!, dist)
  gl.uniform1f(S.u.uDof!, dist < 12 ? 1 : 0.35)
  gl.uniform1f(S.u.uDpr!, dpr)
  gl.bindVertexArray(starVao)
  gl.drawArrays(gl.POINTS, 0, starN)
  // 1b) 전경 별 — 원반 안에서는 많이, 은하 밖(오늘·플래너)에서는 드물게
  {
    const F = P.fg
    gl.useProgram(F.p)
    gl.uniformMatrix4fv(F.u.uVP!, false, vp.m)
    gl.uniform3f(F.u.uCam!, eye[0], eye[1], eye[2])
    gl.uniform1f(F.u.uR!, FG_R)
    gl.uniform1f(F.u.uPx!, px)
    gl.uniform1f(F.u.uDpr!, dpr)
    const inDisk = Math.exp(-Math.abs(eye[1]) / 3) * Math.exp(-Math.max(0, Math.hypot(eye[0], eye[2]) - 15) / 6)
    gl.uniform1f(F.u.uK!, 0.25 + 0.75 * inDisk)
    gl.bindVertexArray(fgVao)
    gl.drawArrays(gl.POINTS, 0, FG_N)
  }
  // 2) 구름 (반 해상도): 먼지 투과율 T (1에서 시작해 곱해 내려감) · 성운·팔 빛 E (더하기)
  if (!dustRT || !emitRT) return
  const C = P.cloud
  gl.useProgram(C.p)
  gl.uniformMatrix4fv(C.u.uVP!, false, vp.m)
  gl.uniform3f(C.u.uCam!, eye[0], eye[1], eye[2])
  gl.uniform1f(C.u.uTime!, simT)
  gl.uniform3f(C.u.uRight!, vp.right[0], vp.right[1], vp.right[2])
  gl.uniform3f(C.u.uUp!, vp.up[0], vp.up[1], vp.up[2])
  gl.uniform1f(C.u.uGain!, 1)
  gl.bindVertexArray(cloudVao)
  gl.bindFramebuffer(gl.FRAMEBUFFER, dustRT.fb)
  gl.viewport(0, 0, dustRT.w, dustRT.h)
  gl.clearColor(1, 1, 1, 1)
  gl.clear(gl.COLOR_BUFFER_BIT)
  gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_COLOR)
  gl.uniform1f(C.u.uKindMin!, 0)
  gl.uniform1f(C.u.uKindMax!, 0)
  gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, cloudN)
  gl.bindFramebuffer(gl.FRAMEBUFFER, emitRT.fb)
  gl.clearColor(0, 0, 0, 1)
  gl.clear(gl.COLOR_BUFFER_BIT)
  gl.blendFunc(gl.ONE, gl.ONE)
  gl.uniform1f(C.u.uKindMin!, 1)
  gl.uniform1f(C.u.uKindMax!, 4)
  gl.uniform1f(C.u.uGain!, EMIT)
  gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, cloudN)
  // 3) 장면 = 별 × T + E
  gl.bindFramebuffer(gl.FRAMEBUFFER, scene.fb)
  gl.viewport(0, 0, W, H)
  gl.bindVertexArray(vaoEmpty)
  gl.useProgram(P.blit.p)
  gl.uniform1i(P.blit.u.uTex!, 0)
  // 성운 빛을 먼저 더하고, 먼지 투과율을 곱한다 → 먼지띠가 팔 빛 위에 어둡게 드러난다
  gl.bindTexture(gl.TEXTURE_2D, emitRT.tex)
  gl.blendFunc(gl.ONE, gl.ONE)
  gl.drawArrays(gl.TRIANGLES, 0, 3)
  gl.bindTexture(gl.TEXTURE_2D, dustRT.tex)
  gl.blendFunc(gl.DST_COLOR, gl.ZERO)
  gl.drawArrays(gl.TRIANGLES, 0, 3)
  gl.disable(gl.BLEND)
  // 4) 블룸
  gl.bindVertexArray(vaoEmpty)
  gl.useProgram(P.down.p)
  let src = scene
  for (const m of mips) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, m.fb)
    gl.viewport(0, 0, m.w, m.h)
    gl.bindTexture(gl.TEXTURE_2D, src.tex)
    gl.uniform1i(P.down.u.uTex!, 0)
    gl.uniform2f(P.down.u.uTexel!, 1 / src.w, 1 / src.h)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    src = m
  }
  gl.useProgram(P.up.p)
  gl.enable(gl.BLEND)
  gl.blendFunc(gl.ONE, gl.ONE)
  for (let i = mips.length - 1; i > 0; i--) {
    const a = mips[i]!
    const b = mips[i - 1]!
    gl.bindFramebuffer(gl.FRAMEBUFFER, b.fb)
    gl.viewport(0, 0, b.w, b.h)
    gl.bindTexture(gl.TEXTURE_2D, a.tex)
    gl.uniform1i(P.up.u.uTex!, 0)
    gl.uniform2f(P.up.u.uTexel!, 1 / a.w, 1 / a.h)
    gl.uniform1f(P.up.u.uW!, 1)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }
  gl.disable(gl.BLEND)
  // 5) 합성
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  gl.viewport(0, 0, W, H)
  gl.useProgram(P.comp.p)
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, scene.tex)
  gl.uniform1i(P.comp.u.uScene!, 0)
  gl.activeTexture(gl.TEXTURE1)
  gl.bindTexture(gl.TEXTURE_2D, mips[0]!.tex)
  gl.uniform1i(P.comp.u.uBloom!, 1)
  gl.uniform1f(P.comp.u.uBloomK!, 0.085)
  gl.uniform1f(P.comp.u.uExposure!, expo * 0.55)
  gl.uniform1f(P.comp.u.uAspect!, W / H)
  gl.drawArrays(gl.TRIANGLES, 0, 3)
  gl.activeTexture(gl.TEXTURE0)
  gl.bindVertexArray(null)

  // 계측
  jsMs = jsMs * 0.95 + (performance.now() - j0) * 0.05
  if (interval > 0 && interval < 250) {
    frames.push(interval)
    if (frames.length > 240) frames.shift()
    if (st.flying) {
      flightFrames.push(interval)
      flightMax = Math.max(flightMax, interval)
    }
  }
  fpsN++
  if (now - fpsT > 1000) {
    fps = Math.round((fpsN * 1000) / (now - fpsT))
    fpsN = 0
    fpsT = now
  }
  if (now - hudT > 500) {
    hudT = now
    const s = frames.slice().sort((a, b) => a - b)
    const p95 = s[Math.floor(0.95 * (s.length - 1))] ?? 0
    const lf = flightLog[flightLog.length - 1]
    hud.textContent = `${power} · ${fps} fps · p95 ${p95.toFixed(1)}ms · js ${jsMs.toFixed(2)}ms\n별 ${(starN / 1000).toFixed(0)}k · 구름 ${(cloudN / 1000).toFixed(1)}k · 등급 ${tier} · ${W}×${H} · 블룸 ${mips.length}단 · ${hdr ? 'HDR' : 'LDR'}\n생성 ${genMs.toFixed(0)}ms${lf ? ` · 마지막 비행 ${lf.to} ${Math.round(lf.ms)}ms 최장 ${lf.maxFrame.toFixed(1)}ms` : ''}`
  }
}

/* ---------- 시작 ---------- */
upload()
resize()
let rz = 0
addEventListener('resize', () => {
  cancelAnimationFrame(rz)
  rz = requestAnimationFrame(resize)
})
setTitle()
updateButtons()
requestAnimationFrame(frame)

// 검증·스크린샷용
;(window as unknown as { __g3d: unknown }).__g3d = {
  fly: flyTo,
  rot: (r: Rot) => {
    rot = r
    updateButtons()
  },
  stats: () => {
    const s = frames.slice().sort((a, b) => a - b)
    return { fps, p95: s[Math.floor(0.95 * (s.length - 1))] ?? 0, jsMs, stars: starN, clouds: cloudN, tier, W, H, genMs, flights: flightLog.slice() }
  },
  clean: (on: boolean) => document.body.classList.toggle('clean', on),
  tune: (emit: number, star: number) => {
    EMIT = emit
    STAR = star
  },
  orbit: (dyawDeg: number, dpitchDeg: number, zoom = 1) => {
    user.yaw += dyawDeg * DEG
    user.pitch += dpitchDeg * DEG
    user.zoom = zoom
  },
}
