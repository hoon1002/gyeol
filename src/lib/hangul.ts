/** 한글 초성 검색 도우미 (v1 목업 W6에서 이식) */
const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'

/** "엔트로피" → "ㅇㅌㄹㅍ". 한글 음절이 아니면 그대로 둔다. */
export function choseong(s: string): string {
  return Array.from(s)
    .map((ch) => {
      const c = ch.charCodeAt(0) - 0xac00
      return c >= 0 && c < 11172 ? CHO[Math.floor(c / 588)] : ch
    })
    .join('')
}

/** 입력이 초성(자음)만으로 되어 있는가 */
export function isChoseongQuery(q: string): boolean {
  return /^[ㄱ-ㅎ\s]+$/.test(q.trim()) && q.trim().length > 0
}

export interface MatchResult {
  /** 강조할 범위 [시작, 끝) — 코드포인트 단위 */
  range: [number, number] | null
  score: number
}

/** 문자열 일치: 부분 문자열(대소문자 무시) 또는 초성. 0이면 불일치. */
export function matchText(text: string, q: string, keywords: string[] = []): MatchResult {
  const query = q.trim().toLowerCase()
  if (!query) return { range: null, score: 1 }
  const chars = Array.from(text)
  const lower = text.toLowerCase()
  const idx = lower.indexOf(query)
  if (idx >= 0) {
    const start = Array.from(text.slice(0, idx)).length
    return { range: [start, start + Array.from(query).length], score: idx === 0 ? 3 : 2 }
  }
  if (isChoseongQuery(query)) {
    const qq = query.replace(/\s/g, '')
    const c = choseong(text.replace(/\s/g, '\u0000'))
    // 공백을 지운 초성 문자열에서 찾고, 원문 위치로 되돌린다
    const map: number[] = []
    let flat = ''
    Array.from(c).forEach((ch, i) => {
      if (ch !== '\u0000') {
        flat += ch
        map.push(i)
      }
    })
    const ci = flat.indexOf(qq)
    if (ci >= 0) {
      const a = map[ci] ?? 0
      const b = (map[ci + qq.length - 1] ?? a) + 1
      return { range: [a, Math.min(b, chars.length)], score: 2 }
    }
  }
  for (const k of keywords) {
    const kl = k.toLowerCase()
    if (kl.includes(query) || (isChoseongQuery(query) && choseong(kl).includes(query.replace(/\s/g, '')))) {
      return { range: null, score: 1 }
    }
  }
  return { range: null, score: 0 }
}
