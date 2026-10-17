/**
 * 손글씨 엔진 — 도형 다듬기 (그리고 펜을 멈춘 채 400ms → 선 · 화살표 · 사각형 · 타원 · 삼각형 · 꺾은선).
 * 인식은 화면 크기 기준 문턱을 쓴다(scale = CSS px / pt). 결과는 stroke.shape { kind, params }와 다시 뽑은 점.
 */
import type { Stroke } from '@/db/schema'
import { apply, matAngle, matScale, pathLength, polyArea, rdp, resample, distSqToSeg, type Mat } from './geom'

export type ShapeKind = NonNullable<Stroke['shape']>['kind']
export interface ShapeFit {
  kind: ShapeKind
  params: number[]
}

const TAU = Math.PI * 2
const wrap = (a: number) => {
  while (a > Math.PI) a -= TAU
  while (a < -Math.PI) a += TAU
  return a
}

/** 각도를 가로·세로·45°에 붙인다 (4° 안) */
function snapAngle(x0: number, y0: number, x1: number, y1: number): [number, number] {
  const L = Math.hypot(x1 - x0, y1 - y0)
  const a = Math.atan2(y1 - y0, x1 - x0)
  const step = Math.PI / 4
  const s = Math.round(a / step) * step
  if (Math.abs(wrap(a - s)) < (4 * Math.PI) / 180) return [x0 + Math.cos(s) * L, y0 + Math.sin(s) * L]
  return [x1, y1]
}

/** 꺾이는 곳 찾기: 창(window) 앞뒤 방향 차이가 큰 곳의 극대 */
function corners(R: number[], closed: boolean, minTurnDeg: number): number[] {
  const N = R.length >> 1
  if (N < 6) return []
  const k = Math.max(2, Math.round(N / (closed ? 26 : 18)))
  const head: number[] = []
  for (let i = 0; i < N; i++) {
    const j = closed ? (i + 1) % N : Math.min(N - 1, i + 1)
    const ii = closed ? i : Math.min(i, N - 2)
    const jj = closed ? j : ii + 1
    head.push(Math.atan2(R[jj * 2 + 1]! - R[ii * 2 + 1]!, R[jj * 2]! - R[ii * 2]!))
  }
  const turn = new Float64Array(N)
  for (let i = 0; i < N; i++) {
    if (!closed && (i - k < 0 || i + k >= N)) continue
    const a = head[(i - k + N) % N]!, b = head[(i + k - 1 + N) % N]!
    turn[i] = Math.abs(wrap(b - a))
  }
  const min = (minTurnDeg * Math.PI) / 180
  const out: number[] = []
  for (let i = 0; i < N; i++) {
    const t = turn[i]!
    if (t < min) continue
    let isMax = true
    for (let d = -k; d <= k; d++) {
      if (!d) continue
      const j = closed ? (i + d + N) % N : i + d
      if (j < 0 || j >= N) continue
      if (turn[j]! > t || (turn[j]! === t && d < 0)) {
        isMax = false
        break
      }
    }
    if (isMax) out.push(i)
  }
  // 너무 가까운 꼭짓점은 하나로
  const merged: number[] = []
  for (const i of out) {
    const last = merged[merged.length - 1]
    if (last !== undefined && i - last < k * 2) {
      if (turn[i]! > turn[last]!) merged[merged.length - 1] = i
      continue
    }
    merged.push(i)
  }
  if (closed && merged.length > 1) {
    const first = merged[0]!, last = merged[merged.length - 1]!
    if (first + N - last < k * 2) {
      if (turn[first]! >= turn[last]!) merged.pop()
      else merged.shift()
    }
  }
  return merged
}

function polyFitError(R: number[], verts: number[], closed: boolean): number {
  let worst = 0
  const V = verts.length >> 1
  for (let i = 0; i < R.length; i += 2) {
    let best = Infinity
    const m = closed ? V : V - 1
    for (let j = 0; j < m; j++) {
      const a = j, b = (j + 1) % V
      best = Math.min(best, distSqToSeg(R[i]!, R[i + 1]!, verts[a * 2]!, verts[a * 2 + 1]!, verts[b * 2]!, verts[b * 2 + 1]!))
    }
    worst = Math.max(worst, best)
  }
  return Math.sqrt(worst)
}

function fitEllipse(R: number[]): { cx: number; cy: number; rx: number; ry: number; rot: number; err: number } {
  const N = R.length >> 1
  let cx = 0, cy = 0
  for (let i = 0; i < N; i++) {
    cx += R[i * 2]!
    cy += R[i * 2 + 1]!
  }
  cx /= N
  cy /= N
  let sxx = 0, syy = 0, sxy = 0
  for (let i = 0; i < N; i++) {
    const dx = R[i * 2]! - cx, dy = R[i * 2 + 1]! - cy
    sxx += dx * dx
    syy += dy * dy
    sxy += dx * dy
  }
  sxx /= N
  syy /= N
  sxy /= N
  const rot = 0.5 * Math.atan2(2 * sxy, sxx - syy)
  const c = Math.cos(rot), s = Math.sin(rot)
  let vu = 0, vv = 0
  for (let i = 0; i < N; i++) {
    const dx = R[i * 2]! - cx, dy = R[i * 2 + 1]! - cy
    const u = dx * c + dy * s, v = -dx * s + dy * c
    vu += u * u
    vv += v * v
  }
  const rx = Math.sqrt((2 * vu) / N) || 1, ry = Math.sqrt((2 * vv) / N) || 1
  let err = 0
  for (let i = 0; i < N; i++) {
    const dx = R[i * 2]! - cx, dy = R[i * 2 + 1]! - cy
    const u = dx * c + dy * s, v = -dx * s + dy * c
    err += Math.abs(Math.sqrt((u / rx) ** 2 + (v / ry) ** 2) - 1)
  }
  return { cx, cy, rx, ry, rot, err: err / N }
}

/** 각도가 축에 가까우면 0/90°로 */
function snapRot(rot: number): number {
  const q = Math.PI / 2
  const s = Math.round(rot / q) * q
  return Math.abs(rot - s) < (6 * Math.PI) / 180 ? s : rot
}

/**
 * 획(stride 4 점)을 도형으로 본다. scale = 지금 화면 배율(CSS px / pt). 못 알아보면 null.
 */
export function recognize(pts: ArrayLike<number>, n: number, scale: number): ShapeFit | null {
  if (n < 4) return null
  const xy: number[] = []
  for (let i = 0; i < n; i++) xy.push(pts[i * 4]!, pts[i * 4 + 1]!)
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (let i = 0; i < xy.length; i += 2) {
    x0 = Math.min(x0, xy[i]!)
    x1 = Math.max(x1, xy[i]!)
    y0 = Math.min(y0, xy[i + 1]!)
    y1 = Math.max(y1, xy[i + 1]!)
  }
  const diag = Math.hypot(x1 - x0, y1 - y0)
  if (diag * scale < 18) return null
  const L = pathLength(xy)
  const R = resample(xy, Math.max(diag / 80, 0.25))
  if (R.length < 8) return null
  const sx = xy[0]!, sy = xy[1]!, ex = xy[xy.length - 2]!, ey = xy[xy.length - 1]!
  const gap = Math.hypot(ex - sx, ey - sy)
  const area = Math.abs(polyArea(R))
  const closed = gap < Math.max(diag * 0.24, 12 / scale) && area > diag * diag * 0.06 && L > diag * 1.6

  if (closed) {
    // 닫힌 꼴: 꼭짓점 수로 다각형, 아니면 타원
    const Rc = R.slice()
    // 닫는 틈 메우기
    const c = corners(Rc, true, 52)
    if (c.length === 3 || c.length === 4) {
      const verts: number[] = []
      for (const i of c) verts.push(Rc[i * 2]!, Rc[i * 2 + 1]!)
      const err = polyFitError(Rc, verts, true)
      if (err < diag * 0.11) {
        if (c.length === 3) return { kind: 'triangle', params: verts }
        // 네 꼭짓점: 직각에 가까우면 사각형(돌아간 직사각형), 아니면 닫힌 꺾은선
        let rightish = true
        for (let j = 0; j < 4; j++) {
          const a = j, b = (j + 1) % 4, cc = (j + 2) % 4
          const ux = verts[a * 2]! - verts[b * 2]!, uy = verts[a * 2 + 1]! - verts[b * 2 + 1]!
          const vx = verts[cc * 2]! - verts[b * 2]!, vy = verts[cc * 2 + 1]! - verts[b * 2 + 1]!
          const ang = Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy) || 1))))
          if (Math.abs(ang - Math.PI / 2) > (24 * Math.PI) / 180) rightish = false
        }
        if (rightish) {
          // 방향: 변 방향들의 평균(90° 접기)
          let ax = 0, ay = 0
          for (let j = 0; j < 4; j++) {
            const b = (j + 1) % 4
            const a2 = Math.atan2(verts[b * 2 + 1]! - verts[j * 2 + 1]!, verts[b * 2]! - verts[j * 2]!) * 4
            ax += Math.cos(a2)
            ay += Math.sin(a2)
          }
          const rot = snapRot(Math.atan2(ay, ax) / 4)
          const co = Math.cos(rot), si = Math.sin(rot)
          let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity
          let mx = 0, my = 0
          for (let j = 0; j < 4; j++) {
            mx += verts[j * 2]! / 4
            my += verts[j * 2 + 1]! / 4
          }
          for (let j = 0; j < 4; j++) {
            const dx = verts[j * 2]! - mx, dy = verts[j * 2 + 1]! - my
            const u = dx * co + dy * si, v = -dx * si + dy * co
            u0 = Math.min(u0, u)
            u1 = Math.max(u1, u)
            v0 = Math.min(v0, v)
            v1 = Math.max(v1, v)
          }
          const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2
          const cx = mx + cu * co - cv * si, cy = my + cu * si + cv * co
          return { kind: 'rect', params: [cx, cy, u1 - u0, v1 - v0, rot] }
        }
        return { kind: 'polyline', params: [...verts, verts[0]!, verts[1]!] }
      }
    }
    const e = fitEllipse(R)
    if (e.err < 0.11 && c.length <= 2) {
      let { rx, ry } = e
      if (Math.abs(rx / ry - 1) < 0.12) rx = ry = (rx + ry) / 2
      return { kind: 'ellipse', params: [e.cx, e.cy, rx, ry, rx === ry ? 0 : snapRot(e.rot)] }
    }
    return null
  }

  // 열린 꼴: 선 → 화살표 → 꺾은선
  let dev = 0
  for (let i = 0; i < R.length; i += 2) dev = Math.max(dev, distSqToSeg(R[i]!, R[i + 1]!, sx, sy, ex, ey))
  dev = Math.sqrt(dev)
  if (gap > L * 0.9 && dev < Math.max(diag * 0.045, 2.5 / scale)) {
    const [qx, qy] = snapAngle(sx, sy, ex, ey)
    return { kind: 'line', params: [sx, sy, qx, qy] }
  }
  const c = corners(R, false, 70)
  const P = (i: number): [number, number] => [R[i * 2]!, R[i * 2 + 1]!]
  if (c.length === 1 || c.length === 3) {
    const tip = P(c[0]!)
    const shaft = Math.hypot(tip[0] - sx, tip[1] - sy)
    const head = c.length === 1 ? Math.hypot(ex - tip[0], ey - tip[1]) : Math.hypot(P(c[1]!)[0] - tip[0], P(c[1]!)[1] - tip[1])
    const tip2 = c.length === 3 ? P(c[2]!) : tip
    const shaftStraight = (() => {
      let d = 0
      for (let i = 0; i < c[0]!; i++) d = Math.max(d, distSqToSeg(R[i * 2]!, R[i * 2 + 1]!, sx, sy, tip[0], tip[1]))
      return Math.sqrt(d) < Math.max(shaft * 0.06, 3 / scale)
    })()
    if (shaftStraight && head < shaft * 0.6 && head > shaft * 0.08 && Math.hypot(tip2[0] - tip[0], tip2[1] - tip[1]) < head * 0.5) {
      const [qx, qy] = snapAngle(sx, sy, tip[0], tip[1])
      return { kind: 'arrow', params: [sx, sy, qx, qy, Math.min(head, shaft * 0.45)] }
    }
  }
  const keep = rdp(R, diag * 0.035)
  if (keep.length >= 3 && keep.length <= 6) {
    const verts: number[] = []
    for (const i of keep) verts.push(R[i * 2]!, R[i * 2 + 1]!)
    if (polyFitError(R, verts, false) < diag * 0.05) return { kind: 'polyline', params: verts }
  }
  return null
}

/** 도형 → 중심선 꼭짓점 (xy 평평한 배열). 화살표는 머리를 한 번 되짚는다(한 획으로 그리기 위해) */
export function shapeVertices(s: ShapeFit): number[] {
  const p = s.params
  switch (s.kind) {
    case 'line':
      return [p[0]!, p[1]!, p[2]!, p[3]!]
    case 'arrow': {
      const [x0, y0, x1, y1, hl = 10] = p as [number, number, number, number, number]
      const a = Math.atan2(y1 - y0, x1 - x0)
      const sp = (28 * Math.PI) / 180
      const lx = x1 - Math.cos(a - sp) * hl, ly = y1 - Math.sin(a - sp) * hl
      const rx = x1 - Math.cos(a + sp) * hl, ry = y1 - Math.sin(a + sp) * hl
      return [x0, y0, x1, y1, lx, ly, x1, y1, rx, ry]
    }
    case 'rect': {
      const [cx, cy, w, h, rot = 0] = p as [number, number, number, number, number]
      const c = Math.cos(rot), s2 = Math.sin(rot)
      const out: number[] = []
      for (const [u, v] of [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2], [-w / 2, -h / 2]] as const) out.push(cx + u * c - v * s2, cy + u * s2 + v * c)
      return out
    }
    case 'ellipse': {
      const [cx, cy, rx, ry, rot = 0] = p as [number, number, number, number, number]
      const c = Math.cos(rot), s2 = Math.sin(rot)
      const N = Math.max(36, Math.min(144, Math.round((rx + ry) * 0.6)))
      const out: number[] = []
      for (let i = 0; i <= N; i++) {
        const t = (i / N) * TAU
        const u = Math.cos(t) * rx, v = Math.sin(t) * ry
        out.push(cx + u * c - v * s2, cy + u * s2 + v * c)
      }
      return out
    }
    case 'triangle':
      return [p[0]!, p[1]!, p[2]!, p[3]!, p[4]!, p[5]!, p[0]!, p[1]!]
    default:
      return p.slice()
  }
}

/** 꼭짓점 → 획 점(stride 4). 압력 0.5, 시각은 원래 획의 시작~끝을 길이에 비례해 나눈다 */
export function shapePoints(verts: number[], t0: number, t1: number): Float32Array {
  const n = verts.length >> 1
  const out = new Float32Array(n * 4)
  const L = pathLength(verts) || 1
  let acc = 0
  for (let i = 0; i < n; i++) {
    if (i) acc += Math.hypot(verts[i * 2]! - verts[i * 2 - 2]!, verts[i * 2 + 1]! - verts[i * 2 - 1]!)
    out[i * 4] = verts[i * 2]!
    out[i * 4 + 1] = verts[i * 2 + 1]!
    out[i * 4 + 2] = 0.5
    out[i * 4 + 3] = t0 + (t1 - t0) * (acc / L)
  }
  return out
}

/** 닮음 변환(이동·균등 배율·회전)을 도형 매개변수에 */
export function transformShape(s: Stroke['shape'], m: Mat): Stroke['shape'] {
  if (!s) return s
  const p = s.params
  const k = matScale(m)
  const ang = matAngle(m)
  const pts = (arr: number[], count: number) => {
    const out = arr.slice()
    for (let i = 0; i < count; i++) {
      const [x, y] = apply(m, arr[i * 2]!, arr[i * 2 + 1]!)
      out[i * 2] = x
      out[i * 2 + 1] = y
    }
    return out
  }
  switch (s.kind) {
    case 'line':
      return { kind: 'line', params: pts(p, 2) }
    case 'arrow': {
      const q = pts(p, 2)
      q[4] = (p[4] ?? 10) * k
      return { kind: 'arrow', params: q }
    }
    case 'triangle':
      return { kind: 'triangle', params: pts(p, 3) }
    case 'rect':
    case 'ellipse': {
      const [cx, cy] = apply(m, p[0]!, p[1]!)
      return { kind: s.kind, params: [cx, cy, p[2]! * k, p[3]! * k, (p[4] ?? 0) + ang] }
    }
    default:
      return { kind: 'polyline', params: pts(p, p.length >> 1) }
  }
}
