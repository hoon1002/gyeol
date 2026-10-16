/** 그래프 별자리 (M0 표시용, 결정적). 화면·별 누르기가 같이 쓴다 */
export const CONCEPTS: Record<string, string[]> = {
  phys: ['엔트로피', '카르노 기관', '열역학 제2법칙', '내부 에너지', '이상기체', '단열 과정', '등온 과정', '열기관 효율', '비열', '클라우지우스', '가역 과정', '자유 에너지', '볼츠만', '열평형', '일과 열', '상태 함수'],
  math: ['라플라스 변환', '합성곱', '미분방정식', '이동 정리', '부분분수', '전달 함수', '초기값 정리', '푸리에 급수', '고유값', '선형 독립', '특성방정식', '감쇠 진동'],
  chem: ['르샤틀리에', '화학 평형', '평형 상수', '반응 속도', '깁스 에너지', '엔탈피', '촉매', '산과 염기', '완충 용액'],
  econ: ['탄력성', '수요 곡선', '공급 곡선', '한계 효용', '기회비용', '균형 가격', '소비자 잉여'],
  writing: ['논증', '반론', '근거', '두괄식'],
  eng: ['발표 표현', '전환 표현', '요약 표현', '질문 받기', '그래프 설명', '마무리 인사'],
}

/** 결정적 별자리: 무리 안 고리 + 이웃 + 무리 사이 다리, 선 87개 */
function buildGraphRaw() {
  const nodes: Array<{ id: string; subject: string }> = []
  Object.entries(CONCEPTS).forEach(([sid, labels]) => labels.forEach((_, i) => nodes.push({ id: `${sid}-${i}`, subject: sid })))
  const links: Array<[string, string]> = []
  const has = (a: string, b: string) => links.some(([x, y]) => (x === a && y === b) || (x === b && y === a))
  const add = (a: string, b: string) => a !== b && !has(a, b) && links.push([a, b])
  Object.entries(CONCEPTS).forEach(([sid, labels]) => {
    for (let i = 1; i < labels.length; i++) add(`${sid}-${Math.floor((i - 1) / 2)}`, `${sid}-${i}`)
    for (let i = 2; i < labels.length; i += 3) add(`${sid}-${i}`, `${sid}-${(i + 2) % labels.length}`)
  })
  ;[['phys-0', 'chem-0'], ['phys-0', 'phys-1'], ['math-0', 'phys-3'], ['chem-4', 'phys-11'], ['econ-0', 'math-2'], ['eng-0', 'writing-0'], ['math-1', 'chem-3'], ['econ-3', 'writing-2'], ['eng-4', 'econ-1'], ['phys-6', 'math-6']].forEach(([a, b]) => add(a!, b!))
  for (let i = 0; links.length < 87 && i < nodes.length; i++) {
    const a = nodes[i]!
    const b = nodes.find((n, j) => j > i + 2 && n.subject === a.subject && !has(a.id, n.id))
    if (b) add(a.id, b.id)
  }
  const out = links.slice(0, 87)
  const deg = (id: string) => out.filter(([x, y]) => x === id || y === id).length
  return { nodes: nodes.map((n) => ({ ...n, links: deg(n.id) })), links: out }
}

let cached: ReturnType<typeof buildGraphRaw> | null = null
export function buildGraph() {
  return (cached ??= buildGraphRaw())
}

/** 별 id → 개념 이름·과목·연결 수 */
export function graphNodeInfo(id: string): { label: string; subject: string; links: number } | null {
  const [sid, idx] = id.split('-')
  const label = sid && idx !== undefined ? CONCEPTS[sid]?.[Number(idx)] : undefined
  if (!label || !sid) return null
  const n = buildGraph().nodes.find((x) => x.id === id)
  return { label, subject: sid, links: n?.links ?? 0 }
}
