/** 손글씨 엔진 — 기하 도우미 (상자 · 아핀 행렬 · 거리 · 다각형 · 단순화). 순수 함수만. */

/** [x0, y0, x1, y1] */
export type BBox = [number, number, number, number]
/** 아핀 [a, b, c, d, e, f]: x' = a·x + c·y + e, y' = b·x + d·y + f (Canvas setTransform과 같은 순서) */
export type Mat = [number, number, number, number, number, number]

export const IDENT: Mat = [1, 0, 0, 1, 0, 0]

/** m ∘ n (n 먼저, 그다음 m) */
export function mul(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ]
}

export function inv(m: Mat): Mat {
  const det = m[0] * m[3] - m[1] * m[2] || 1e-12
  const a = m[3] / det, b = -m[1] / det, c = -m[2] / det, d = m[0] / det
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])]
}

export function apply(m: Mat, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
}

export const translate = (tx: number, ty: number): Mat => [1, 0, 0, 1, tx, ty]

export function scaleAt(sx: number, sy: number, cx: number, cy: number): Mat {
  return [sx, 0, 0, sy, cx - sx * cx, cy - sy * cy]
}

export function rotateAt(rad: number, cx: number, cy: number): Mat {
  const c = Math.cos(rad), s = Math.sin(rad)
  return [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy]
}

/** 균등 배율 (√|det|) */
export function matScale(m: Mat): number {
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]))
}

/** 회전각 (rad) */
export function matAngle(m: Mat): number {
  return Math.atan2(m[1], m[0])
}

export function isIdentity(m: Mat, eps = 1e-9): boolean {
  return Math.abs(m[0] - 1) < eps && Math.abs(m[1]) < eps && Math.abs(m[2]) < eps && Math.abs(m[3] - 1) < eps && Math.abs(m[4]) < eps && Math.abs(m[5]) < eps
}

/* ---------- 상자 ---------- */

export function bboxOfPoints(pts: ArrayLike<number>, stride = 4, from = 0, to = pts.length): BBox {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (let i = from; i < to; i += stride) {
    const x = pts[i]!, y = pts[i + 1]!
    if (x < x0) x0 = x
    if (x > x1) x1 = x
    if (y < y0) y0 = y
    if (y > y1) y1 = y
  }
  if (x0 === Infinity) return [0, 0, 0, 0]
  return [x0, y0, x1, y1]
}

export const bboxExpand = (b: BBox, d: number): BBox => [b[0] - d, b[1] - d, b[2] + d, b[3] + d]

export function bboxUnion(a: BBox | null, b: BBox | null): BBox | null {
  if (!a) return b
  if (!b) return a
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]
}

export const bboxOverlap = (a: BBox, b: BBox): boolean => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1]

export const bboxContains = (outer: BBox, inner: BBox): boolean => inner[0] >= outer[0] && inner[1] >= outer[1] && inner[2] <= outer[2] && inner[3] <= outer[3]

export function bboxInter(a: BBox, b: BBox): BBox | null {
  const r: BBox = [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])]
  return r[0] < r[2] && r[1] < r[3] ? r : null
}

export function bboxTransform(b: BBox, m: Mat): BBox {
  const c = [apply(m, b[0], b[1]), apply(m, b[2], b[1]), apply(m, b[2], b[3]), apply(m, b[0], b[3])]
  return [Math.min(...c.map((p) => p[0])), Math.min(...c.map((p) => p[1])), Math.max(...c.map((p) => p[0])), Math.max(...c.map((p) => p[1]))]
}

/* ---------- 거리 ---------- */

export function distSqToSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay
  const l2 = dx * dx + dy * dy
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0
  t = t < 0 ? 0 : t > 1 ? 1 : t
  const qx = ax + t * dx - px, qy = ay + t * dy - py
  return qx * qx + qy * qy
}

/** 두 선분 사이 최소 거리² */
export function segSegDistSq(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): number {
  if (segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy)) return 0
  return Math.min(distSqToSeg(ax, ay, cx, cy, dx, dy), distSqToSeg(bx, by, cx, cy, dx, dy), distSqToSeg(cx, cy, ax, ay, bx, by), distSqToSeg(dx, dy, ax, ay, bx, by))
}

function orient(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
}

export function segmentsIntersect(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
  const o1 = orient(ax, ay, bx, by, cx, cy), o2 = orient(ax, ay, bx, by, dx, dy)
  const o3 = orient(cx, cy, dx, dy, ax, ay), o4 = orient(cx, cy, dx, dy, bx, by)
  return o1 * o2 < 0 && o3 * o4 < 0
}

/* ---------- 다각형 ---------- */

/** 점이 다각형(xy 평평한 배열) 안에 있는지 (짝홀 규칙) */
export function pointInPoly(x: number, y: number, poly: ArrayLike<number>): boolean {
  let inside = false
  const n = poly.length
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const xi = poly[i]!, yi = poly[i + 1]!, xj = poly[j]!, yj = poly[j + 1]!
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-12) + xi) inside = !inside
  }
  return inside
}

export function polyArea(poly: ArrayLike<number>): number {
  let a = 0
  const n = poly.length
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) a += poly[j]! * poly[i + 1]! - poly[i]! * poly[j + 1]!
  return a / 2
}

/** 길이 (xy 평평한 배열, stride 간격) */
export function pathLength(pts: ArrayLike<number>, stride = 2, from = 0, to = pts.length): number {
  let L = 0
  for (let i = from + stride; i < to; i += stride) L += Math.hypot(pts[i]! - pts[i - stride]!, pts[i + 1]! - pts[i + 1 - stride]!)
  return L
}

/** 같은 간격으로 다시 뽑기 (xy 평평한 배열 → xy) */
export function resample(xy: ArrayLike<number>, spacing: number, closed = false): number[] {
  const n = xy.length >> 1
  if (n === 0) return []
  const out = [xy[0]!, xy[1]!]
  let carry = 0
  const total = n + (closed ? 1 : 0)
  for (let i = 1; i < total; i++) {
    const a = (i - 1) % n, b = i % n
    let ax = xy[a * 2]!, ay = xy[a * 2 + 1]!
    const bx = xy[b * 2]!, by = xy[b * 2 + 1]!
    let seg = Math.hypot(bx - ax, by - ay)
    while (carry + seg >= spacing && seg > 0) {
      const t = (spacing - carry) / seg
      ax = ax + (bx - ax) * t
      ay = ay + (by - ay) * t
      out.push(ax, ay)
      seg = Math.hypot(bx - ax, by - ay)
      carry = 0
    }
    carry += seg
  }
  if (!closed) {
    const lx = xy[(n - 1) * 2]!, ly = xy[(n - 1) * 2 + 1]!
    if (Math.hypot(out[out.length - 2]! - lx, out[out.length - 1]! - ly) > spacing * 0.25) out.push(lx, ly)
  }
  return out
}

/** Ramer–Douglas–Peucker: 남길 꼭짓점 번호 (xy 평평한 배열) */
export function rdp(xy: ArrayLike<number>, eps: number): number[] {
  const n = xy.length >> 1
  if (n <= 2) return n === 2 ? [0, 1] : n === 1 ? [0] : []
  const keep = new Uint8Array(n)
  keep[0] = keep[n - 1] = 1
  const stack: Array<[number, number]> = [[0, n - 1]]
  const e2 = eps * eps
  while (stack.length) {
    const [a, b] = stack.pop()!
    let best = -1, bestD = e2
    const ax = xy[a * 2]!, ay = xy[a * 2 + 1]!, bx = xy[b * 2]!, by = xy[b * 2 + 1]!
    for (let i = a + 1; i < b; i++) {
      const d = distSqToSeg(xy[i * 2]!, xy[i * 2 + 1]!, ax, ay, bx, by)
      if (d > bestD) {
        bestD = d
        best = i
      }
    }
    if (best >= 0) {
      keep[best] = 1
      stack.push([a, best], [best, b])
    }
  }
  const out: number[] = []
  for (let i = 0; i < n; i++) if (keep[i]) out.push(i)
  return out
}

export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v)
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t
