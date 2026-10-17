/**
 * 개발용 검색 측정: 합성 노트 n개(기본 1,000)를 따로 만든 색인에 넣고 질의 시간을 잰다. DB는 건드리지 않는다.
 * 콘솔: await __gyeolSearch.bench()
 */
import { SearchIndex } from './engine'

const KO = [
  '엔트로피', '열역학', '제2법칙', '카르노', '기관', '효율', '내부', '에너지', '이상기체', '단열', '등온', '과정', '비열', '평형', '상태', '함수',
  '라플라스', '변환', '합성곱', '미분방정식', '이동', '정리', '부분분수', '전달', '고유값', '선형', '독립', '특성방정식', '감쇠', '진동', '푸리에', '급수',
  '르샤틀리에', '화학', '상수', '반응', '속도', '깁스', '엔탈피', '촉매', '산과', '염기', '완충', '용액', '탄력성', '수요', '공급', '곡선', '한계', '효용',
  '기회비용', '균형', '가격', '소비자', '잉여', '논증', '반론', '근거', '두괄식', '발표', '표현', '요약', '질문', '그래프', '설명', '마무리',
  '그러므로', '따라서', '예를', '들면', '중요한', '것은', '다음과', '같다', '시험에', '나온다', '헷갈리는', '점', '교수님', '강조', '복습', '필요',
]
const EN = ['entropy', 'carnot', 'laplace', 'fourier', 'transform', 'equilibrium', 'demand', 'supply', 'thesis', 'graph', 'ΔS', 'Q/T', 'nRT', 'ln', 'PV', 'γ']

function rng(seed: number) {
  let s = seed
  return () => ((s = (s * 16807) % 2147483647) / 2147483647)
}

export function makeDocs(n = 1000) {
  const r = rng(42)
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)]!
  const sentence = () => {
    const len = 6 + Math.floor(r() * 10)
    const w: string[] = []
    for (let i = 0; i < len; i++) w.push(r() < 0.12 ? pick(EN) : pick(KO))
    return w.join(' ') + '.'
  }
  const docs = []
  for (let i = 0; i < n; i++) {
    const lines: string[] = []
    const nl = 8 + Math.floor(r() * 30)
    for (let j = 0; j < nl; j++) lines.push(sentence())
    docs.push({
      kind: 'note' as const,
      id: 'bench-' + i,
      title: `${pick(KO)} ${pick(KO)} ${i % 7 === 0 ? pick(EN) : ''}`.trim(),
      body: lines.join('\n'),
      subjectId: 's' + (i % 6),
      updatedAt: Date.now() - i * 3_600_000,
    })
  }
  return docs
}

export function bench(n = 1000) {
  const docs = makeDocs(n)
  const chars = docs.reduce((a, d) => a + d.body.length, 0)
  const idx = new SearchIndex()
  const t0 = performance.now()
  docs.forEach((d) => idx.upsert(d))
  const buildMs = performance.now() - t0
  const queries = ['엔트로피', '열역', '라플라스 변환', '평형 상수', 'fourier', 'lap', '가', '헷갈리는 점', 'ㅇㅌㄹㅍ', '없는낱말', 'ΔS', '시험에 나온다 효율', '엔트ㄹ']
  const rows: Array<{ q: string; hits: number; medianMs: number; maxMs: number }> = []
  for (const q of queries) {
    const times: number[] = []
    let hits = 0
    for (let k = 0; k < 15; k++) {
      const a = performance.now()
      hits = idx.query(q, { limit: 50 }).length
      times.push(performance.now() - a)
    }
    times.sort((x, y) => x - y)
    rows.push({ q, hits, medianMs: +times[7]!.toFixed(2), maxMs: +times[times.length - 1]!.toFixed(2) })
  }
  // 부분 갱신 1건
  const u0 = performance.now()
  idx.upsert({ ...docs[3]!, body: docs[3]!.body + '\n새 문장 엔트로피 증가' })
  const upsertMs = performance.now() - u0
  return { notes: n, chars, buildMs: +buildMs.toFixed(1), upsertMs: +upsertMs.toFixed(2), worstQueryMs: Math.max(...rows.map((r) => r.maxMs)), rows }
}
