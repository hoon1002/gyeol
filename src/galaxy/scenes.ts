/**
 * 화면 시제품의 글과 데이터 별 — design-v3 §4-2(문구), §6(데이터가 하늘이 되는 규칙), §7(화면 설계).
 * 글 다이어트: 명사구 1 + 메타 1 + 동작 1 (+ 지평선 줄 0~1). 종결어미·마침표 없음.
 */
import { deviceOf, type SceneName } from './sky/compositions'
import { mulberry32 } from './sky/rng'
import type { SpecialStar } from './sky/sky'

export const C = {
  gold: [0.953, 0.824, 0.604] as [number, number, number], // #F3D29A 별빛 금
  seal: [1.0, 0.561, 0.471] as [number, number, number], // #FF8F78 인주(H-α)
  phys: '#5CB8FF',
  math: '#8F9BFF',
  chem: '#3ED6C0',
  econ: '#F5C451',
  writing: '#FF8DB5',
  eng: '#C29BFF',
}

export interface HorizonItem {
  dot?: string
  text: string
}
export interface SceneCopy {
  space: string
  noun: string
  meta: string
  action: string
  /** 보조 동작 (아이콘) */
  aux?: 'mic' | 'plus'
  horizon?: HorizonItem[]
  /** 진행선 (지난 비율) */
  progress?: number
  aria?: string
}

export const SCENE_COPY: Record<SceneName, SceneCopy> = {
  hero: { space: '결', noun: '', meta: '', action: '' },
  cover: { space: '결', noun: '', meta: '', action: '' },
  'today-class': {
    space: '오늘',
    noun: '일반물리',
    meta: '09:00 – 10:15 · 공학관 302',
    action: '노트 열기',
    aux: 'mic',
    progress: 0.43,
    aria: '일반물리 수업, 43분 남음',
    horizon: [{ dot: C.math, text: '13:00 공업수학' }, { text: '복습 13' }, { text: '중간고사 D-6' }],
  },
  'today-class-day': {
    space: '오늘',
    noun: '일반물리',
    meta: '09:00 – 10:15 · 공학관 302',
    action: '노트 열기',
    aux: 'mic',
    progress: 0.43,
    aria: '일반물리 수업, 43분 남음',
    horizon: [{ dot: C.math, text: '13:00 공업수학' }, { text: '복습 13' }, { text: '중간고사 D-6' }],
  },
  'today-night': {
    space: '오늘',
    noun: '오늘의 별',
    meta: '내일 09:00 경제학원론',
    action: '25분 집중',
    horizon: [{ text: '과제 3 D-1' }, { text: '복습 13' }, { text: '중간고사 D-6' }],
  },
  focus: { space: '집중', noun: '일반물리', meta: '', action: '' },
  review: {
    space: '복습',
    noun: '복습',
    meta: '13장 · 8분',
    action: '시작',
    horizon: [
      { dot: C.phys, text: '6' },
      { dot: C.math, text: '4' },
      { dot: C.eng, text: '3' },
    ],
    aria: '일반물리 6, 공업수학 4, 영어 3',
  },
  graph: { space: '그래프', noun: '엔트로피', meta: '노트 2 · 어제', action: '따라가기' },
  notes: { space: '노트', noun: '엔트로피와 열역학 제2법칙', meta: '일반물리 · 2분 전', action: '이어 쓰기', aux: 'plus' },
}

export type DockId = 'today' | 'notes' | 'graph' | 'review' | 'planner' | 'focus'
export const DOCK: Array<{ id: DockId; label: string; phone: boolean }> = [
  { id: 'today', label: '오늘', phone: true },
  { id: 'notes', label: '노트', phone: true },
  { id: 'graph', label: '그래프', phone: false },
  { id: 'review', label: '복습', phone: true },
  { id: 'planner', label: '플래너', phone: true },
  { id: 'focus', label: '집중', phone: true },
]

/* ---------- 데이터 별 (v3 §6) ---------- */

/** 오늘의 별자리: '오늘의 자리' 안, 새 별은 직전 별에서 28–64px, 아래쪽 우선, 다른 별과 20px 넘게 */
export function todayStarPositions(n: number, w: number, h: number): Array<[number, number]> {
  const dev = deviceOf(w, h)
  const box = dev === 'phone' ? [0.08, 0.18, 0.42, 0.4] : [0.4, 0.1, 0.56, 0.4]
  const r = mulberry32(1016 * 7 + 3)
  const pts: Array<[number, number]> = []
  let x = (box[0]! + (box[2]! - box[0]!) * 0.62) * w
  let y = (box[1]! + (box[3]! - box[1]!) * 0.06) * h
  pts.push([x / w, y / h])
  for (let i = 1; i < n; i++) {
    let ok = false
    for (let k = 0; k < 40 && !ok; k++) {
      // 쏟아지는 방향(왼쪽 아래 57°) 주변으로
      const ang = ((57 + (r() - 0.5) * 110) * Math.PI) / 180
      const d = 28 + r() * 36
      const nx = x - Math.cos(ang) * d * (r() < 0.25 ? -1 : 1)
      const ny = y + Math.sin(ang) * d
      const inBox = nx > box[0]! * w && nx < box[2]! * w && ny > box[1]! * h && ny < box[3]! * h
      const far = pts.every(([px, py]) => Math.hypot(px * w - nx, py * h - ny) > 20)
      if (inBox && far) {
        x = nx
        y = ny
        ok = true
      }
    }
    pts.push([x / w, y / h])
  }
  return pts
}

export function examStar(w: number, h: number, dday = 6): SpecialStar {
  const phone = deviceOf(w, h) === 'phone'
  const k = Math.max(0.2, Math.min(1, 1 - (dday / 14) * 0.8)) // D-14 20% → D-0 100% (D-6 66%)
  return { x: phone ? 0.86 : 0.8, y: phone ? 0.36 : 0.47, L: 220 * k, color: C.seal, mode: 'still' }
}

/** 복습 별: 띠 오른쪽 가장자리와 나란한 57° 사선 위, 별 사이 18–30px, 밝기 30%, 과목색 10% */
export function reviewStars(w: number, h: number, relit: number, now: number, lastRelitAt: number): SpecialStar[] {
  const phone = deviceOf(w, h) === 'phone'
  const a: [number, number] = phone ? [0.93, 0.13] : [0.85, 0.2]
  const b: [number, number] = phone ? [0.64, 0.46] : [0.57, 0.8]
  const r = mulberry32(1016 + 13)
  const subj = [C.phys, C.phys, C.phys, C.phys, C.phys, C.phys, C.math, C.math, C.math, C.math, C.eng, C.eng, C.eng]
  const out: SpecialStar[] = []
  for (let i = 0; i < 13; i++) {
    const f = (i + 0.5) / 13 + (r() - 0.5) * 0.02
    const jx = (r() - 0.5) * 10
    const x = a[0] + (b[0] - a[0]) * f + jx / w
    const y = a[1] + (b[1] - a[1]) * f
    const hex = subj[i]!
    const sc = [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255]
    const col: [number, number, number] = [0.9 + 0.1 * sc[0]!, 0.9 + 0.1 * sc[1]!, 0.9 + 0.1 * sc[2]!]
    const t0 = i < relit ? (i === relit - 1 ? lastRelitAt : now - 10) : 1e9
    out.push({ x, y, L: 90 + r() * 40, color: col, mode: 'relight', t0 })
  }
  return out
}

/** 노트 별자리 (그래프): 노트 별 54 · 선 87 · 과목 무리 6 */
export interface Graph {
  nodes: Array<{ x: number; y: number; links: number; subj: string; selected?: boolean }>
  edges: Array<[number, number]>
  clusters: Array<{ x: number; y: number; r: number; color: string }>
}
export function makeGraph(w: number, h: number): Graph {
  const phone = deviceOf(w, h) === 'phone'
  const r = mulberry32(1016 + 54)
  // 무리 중심 (일반물리는 코어 오른쪽 위, 공업수학은 왼쪽 위, 일반화학은 아래 오른쪽 …)
  const groups = phone
    ? [
        { c: [0.72, 0.12], n: 14, s: C.phys },
        { c: [0.22, 0.14], n: 11, s: C.math },
        { c: [0.78, 0.5], n: 9, s: C.chem },
        { c: [0.46, 0.32], n: 7, s: C.econ },
        { c: [0.18, 0.4], n: 6, s: C.writing },
        { c: [0.5, 0.62], n: 7, s: C.eng },
      ]
    : [
        { c: [0.76, 0.2], n: 14, s: C.phys },
        { c: [0.28, 0.2], n: 11, s: C.math },
        { c: [0.84, 0.66], n: 9, s: C.chem },
        { c: [0.52, 0.44], n: 7, s: C.econ },
        { c: [0.16, 0.4], n: 6, s: C.writing },
        { c: [0.62, 0.78], n: 7, s: C.eng },
      ]
  const nodes: Graph['nodes'] = []
  const clusters: Graph['clusters'] = []
  const spread = Math.min(w, h) * (phone ? 0.11 : 0.1)
  groups.forEach((g) => {
    clusters.push({ x: g.c[0]!, y: g.c[1]!, r: 60 + Math.sqrt(g.n) * 32, color: g.s })
    for (let i = 0; i < g.n; i++) {
      for (let k = 0; k < 20; k++) {
        const ang = r() * Math.PI * 2
        const d = Math.sqrt(r()) * spread
        const x = g.c[0]! + (Math.cos(ang) * d) / w
        const y = g.c[1]! + (Math.sin(ang) * d) / h
        const far = nodes.every((n) => Math.hypot((n.x - x) * w, (n.y - y) * h) > 22)
        // 글자 안전 구역(왼쪽 아래)과 상단 요소 피하기
        const safe = phone ? y > 0.55 : x < 0.4 && y > 0.6
        if (far && !safe && y > 0.07 && y < 0.9 && x > 0.04 && x < 0.97) {
          nodes.push({ x, y, links: 0, subj: g.s })
          break
        }
      }
    }
  })
  // 선 87: 무리 안 가까운 이웃 + 무리 사이 몇 개
  const edges: Graph['edges'] = []
  const has = (a: number, b: number) => edges.some(([p, q]) => (p === a && q === b) || (p === b && q === a))
  const dist = (a: number, b: number) => Math.hypot((nodes[a]!.x - nodes[b]!.x) * w, (nodes[a]!.y - nodes[b]!.y) * h)
  for (let i = 0; i < nodes.length && edges.length < 87; i++) {
    const near = nodes
      .map((n, j) => ({ j, d: j === i ? 1e9 : dist(i, j) * (n.subj === nodes[i]!.subj ? 1 : 2.4) }))
      .sort((a, b) => a.d - b.d)
    for (const nb of near.slice(0, 2)) if (!has(i, nb.j) && edges.length < 87) edges.push([i, nb.j])
  }
  while (edges.length < 87) {
    const a = Math.floor(r() * nodes.length)
    const b = Math.floor(r() * nodes.length)
    if (a !== b && !has(a, b) && dist(a, b) < Math.min(w, h) * 0.32) edges.push([a, b])
  }
  edges.forEach(([a, b]) => {
    nodes[a]!.links++
    nodes[b]!.links++
  })
  // '엔트로피' = 일반물리 무리에서 선이 2개인 별 하나를 고른다
  let sel = nodes.findIndex((n) => n.subj === C.phys && n.links === 2)
  if (sel < 0) sel = 0
  nodes[sel]!.selected = true
  return { nodes, edges, clusters }
}

export function graphStars(g: Graph): SpecialStar[] {
  return g.nodes.map((n) => {
    // 지름 1.2–3.2px ∝ log(링크 + 1) → 셰이더 등급 곡선의 L로
    const d = n.selected ? 3.2 : 1.2 + Math.min(1, Math.log(n.links + 1) / Math.log(8)) * 1.6
    const gg = Math.min(1, (d - 0.8) / 1.4)
    const L = d > 2.2 ? 143 + (d - 2.2) * 600 : 5 * Math.pow(143 / 5, gg)
    const hex = n.subj
    const sc = [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255]
    const col: [number, number, number] = n.selected ? C.gold : [0.8 + 0.2 * sc[0]!, 0.8 + 0.2 * sc[1]!, 0.8 + 0.2 * sc[2]!]
    return { x: n.x, y: n.y, L: n.selected ? 400 : L, color: col, mode: 'still' as const }
  })
}
