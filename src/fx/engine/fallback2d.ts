import { noise3 } from './noise'
import { cssRGBA, type Palette, type RGBA } from './color'

/**
 * Canvas 2D 정지 프레임 — WebGL2가 없거나 컨텍스트를 잃었을 때 한 장만 그린다.
 * v1·v2 목업의 마칭 스퀘어 방식 그대로(Path2D 두 개: 가는 선 / 4번째마다 굵은 선).
 */
export interface StillState {
  time: number
  step: number
  ax: number
  ay: number
  scale: number
  knots: Array<{ x: number; y: number; s: number }>
  knotR: number
  tint: RGBA
  tintAmt: number
  rings: number
  ringScale: number
  palette: Palette
  dim: number
  octaves: number
}

export function drawStill2D(canvas: HTMLCanvasElement, w: number, h: number, st: StillState): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
  const W = Math.max(1, Math.round(w * dpr))
  const H = Math.max(1, Math.round(h * dpr))
  if (canvas.width !== W) canvas.width = W
  if (canvas.height !== H) canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)

  const cell = w < 600 ? 19 : 14
  const cols = Math.ceil(w / cell) + 2
  const rows = Math.ceil(h / cell) + 2
  const V = new Float32Array(cols * rows)
  const s = st.scale
  const R2 = st.knotR * st.knotR
  for (let j = 0; j < rows; j++) {
    const y = j * cell
    for (let i = 0; i < cols; i++) {
      const x = i * cell
      const qx = x * s * st.ax
      const qy = y * s * st.ay
      let f = noise3(qx, qy, st.time)
      if (st.octaves > 1) f += 0.42 * noise3(qx * 2.7 + 31, qy * 2 + 7, st.time * 1.35 + 4)
      for (const k of st.knots) {
        if (k.s <= 0.001) continue
        const dx = x - k.x
        const dy = y - k.y
        f += k.s * 1.35 * Math.exp(-(dx * dx + dy * dy) / R2)
      }
      V[j * cols + i] = f
    }
  }

  const step = st.step
  const L0 = -3
  const pm = new Path2D()
  const pM = new Path2D()
  for (let j = 0; j < rows - 1; j++) {
    const y0 = j * cell
    const y1 = y0 + cell
    for (let i = 0; i < cols - 1; i++) {
      const x0 = i * cell
      const x1 = x0 + cell
      const a = V[j * cols + i]!
      const b = V[j * cols + i + 1]!
      const c = V[(j + 1) * cols + i + 1]!
      const d = V[(j + 1) * cols + i]!
      const mn = Math.min(a, b, c, d)
      const mx = Math.max(a, b, c, d)
      for (let k = Math.ceil((mn - L0) / step); k <= Math.floor((mx - L0) / step); k++) {
        const lv = L0 + k * step
        const id = (a > lv ? 8 : 0) | (b > lv ? 4 : 0) | (c > lv ? 2 : 0) | (d > lv ? 1 : 0)
        if (!id || id === 15) continue
        const P = k % 4 === 0 ? pM : pm
        const tx = x0 + (cell * (lv - a)) / (b - a)
        const ry = y0 + (cell * (lv - b)) / (c - b)
        const bx = x0 + (cell * (lv - d)) / (c - d)
        const ly = y0 + (cell * (lv - a)) / (d - a)
        switch (id) {
          case 1: case 14: P.moveTo(x0, ly); P.lineTo(bx, y1); break
          case 2: case 13: P.moveTo(bx, y1); P.lineTo(x1, ry); break
          case 3: case 12: P.moveTo(x0, ly); P.lineTo(x1, ry); break
          case 4: case 11: P.moveTo(tx, y0); P.lineTo(x1, ry); break
          case 6: case 9: P.moveTo(tx, y0); P.lineTo(bx, y1); break
          case 7: case 8: P.moveTo(x0, ly); P.lineTo(tx, y0); break
          case 5: P.moveTo(tx, y0); P.lineTo(x1, ry); P.moveTo(x0, ly); P.lineTo(bx, y1); break
          case 10: P.moveTo(x0, ly); P.lineTo(tx, y0); P.moveTo(bx, y1); P.lineTo(x1, ry); break
        }
      }
    }
  }

  const pal = st.palette
  const k0 = st.knots[0]
  ctx.globalAlpha = st.dim
  let minorStyle: string | CanvasGradient = cssRGBA(pal.minor)
  if (k0 && k0.s > 0.001 && st.tintAmt > 0) {
    const R = st.knotR * 1.8
    const g = ctx.createRadialGradient(k0.x, k0.y, 0, k0.x, k0.y, R)
    const ia = Math.min(1, k0.s) * st.tintAmt
    g.addColorStop(0, cssRGBA([st.tint[0], st.tint[1], st.tint[2], 0.6 * ia + pal.minor[3] * (1 - ia)]))
    g.addColorStop(0.5, cssRGBA([st.tint[0], st.tint[1], st.tint[2], 0.18 * ia + pal.minor[3] * (1 - ia)]))
    g.addColorStop(1, cssRGBA(pal.minor))
    minorStyle = g
  }
  ctx.lineWidth = 0.9
  ctx.strokeStyle = minorStyle
  ctx.stroke(pm)
  ctx.lineWidth = 1.3
  ctx.strokeStyle = cssRGBA(pal.major)
  ctx.stroke(pM)

  // 데이터 고리
  if (k0 && st.rings > 0.001) {
    ctx.strokeStyle = cssRGBA(pal.accent)
    ctx.lineWidth = 1.4
    const sc = st.ringScale
    for (let r = 0; r < Math.ceil(st.rings) && r < 14; r++) {
      const part = Math.min(1, st.rings - r)
      ctx.globalAlpha = st.dim * Math.max(0.22, 0.8 - r * 0.07)
      ctx.beginPath()
      const segs = Math.max(2, Math.round(72 * part))
      for (let a2 = 0; a2 <= segs; a2++) {
        const an = -Math.PI / 2 + (a2 / 72) * Math.PI * 2
        const wob =
          Math.sin(an * 2 + r * 1.3 + st.time * 6) * 0.5 +
          Math.sin(an * 3 - r * 0.7 - st.time * 4) * 0.33 +
          Math.sin(an * 5 + r * 2.1 + st.time * 9) * 0.17
        const rr = (16 + r * 13) * sc * (1 + 0.07 * wob)
        const px = k0.x + r * 1.6 * sc + Math.cos(an) * rr
        const py = k0.y - r * 0.8 * sc + Math.sin(an) * rr
        if (a2) ctx.lineTo(px, py)
        else ctx.moveTo(px, py)
      }
      ctx.stroke()
    }
  }
  ctx.globalAlpha = 1
}
