/**
 * 떠올리기 빠짐 판정 (design-m4 3-2 · 결정 4): 원문 문장마다 한글 2-gram이 내 글에 들어 있는 비율이 RECALL_MISS 미만이면 빠짐.
 * 굵은 글씨 · [[링크]] 낱말(mustWords)이 내 글에 없으면 비율과 상관없이 빠짐.
 */
export const RECALL_MISS = 0.35

const norm = (s: string) => s.normalize('NFC').toLowerCase().replace(/\s+/g, '')

function grams(s: string): Set<string> {
  const a = Array.from(norm(s).replace(/[^\p{L}\p{N}]/gu, ''))
  const g = new Set<string>()
  if (a.length === 1) g.add(a[0]!)
  for (let i = 0; i + 1 < a.length; i++) g.add(a[i]! + a[i + 1]!)
  return g
}

/** 원문을 문장으로: 줄바꿈 · 문장 끝(. ? ! 。 · '다.')에서 자른다 */
export function sentences(text: string): string[] {
  return text
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.?!。])\s+/))
    .map((s) => s.trim())
    .filter((s) => s.length > 1)
}

export interface RecallLine {
  text: string
  /** 0–1: 원문 문장의 2-gram 중 내 글에 있는 비율 */
  cover: number
  missing: boolean
}

export function compareRecall(original: string, mine: string, mustWords: string[] = []): RecallLine[] {
  const my = grams(mine)
  const myFlat = norm(mine)
  return sentences(original).map((text) => {
    const g = grams(text)
    let hit = 0
    g.forEach((x) => my.has(x) && hit++)
    const cover = g.size ? hit / g.size : 1
    const lostWord = mustWords.some((w) => w.trim() && norm(text).includes(norm(w)) && !myFlat.includes(norm(w)))
    return { text, cover, missing: cover < RECALL_MISS || lostWord }
  })
}
