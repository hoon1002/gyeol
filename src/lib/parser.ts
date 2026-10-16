/**
 * ⌘K 자연어 파서 (v1 목업 W6 이식).
 * "물리 25분" → { subject: 일반물리, minutes: 25, intent: 'focus' }
 * "과제 추가 공업수학 금요일 23:59" → { intent: 'task', subject, due: { day: '금', time: '23:59' } }
 * 초성만 입력하면 cho = true.
 */
import { isChoseongQuery } from './hangul'
import { addDays, atTime, clamp, startOfDay } from './time'

export interface ParseSubject {
  id: string
  name: string
  aliases: string[]
}

export type Intent = 'focus' | 'review' | 'task' | 'new' | 'theme' | 'motion'

export interface ParseResult<S extends ParseSubject = ParseSubject> {
  text: string
  subject: S | null
  minutes: number | null
  intent: Intent | null
  due: { day: string | null; time: string | null } | null
  cho: boolean
  theme: 'dark' | 'light' | 'system' | null
  motion: 'rich' | 'calm' | 'off' | null
}

export function parseCommand<S extends ParseSubject>(q: string, subjects: S[]): ParseResult<S> {
  const s = q.trim()
  const low = s.toLowerCase()
  const r: ParseResult<S> = { text: s, subject: null, minutes: null, intent: null, due: null, cho: false, theme: null, motion: null }
  if (!s) return r

  // 과목: 긴 별칭부터
  const alias: Array<[string, S]> = []
  subjects.forEach((sub) => [sub.name, ...sub.aliases].forEach((a) => alias.push([a.toLowerCase(), sub])))
  alias.sort((a, b) => b[0].length - a[0].length)
  for (const [a, sub] of alias) {
    if (a && low.includes(a)) {
      r.subject = sub
      break
    }
  }

  // 시간
  let m = s.match(/(\d+)\s*시간\s*(\d+)\s*분/)
  if (m) r.minutes = Number(m[1]) * 60 + Number(m[2])
  else if ((m = s.match(/(\d+)\s*시간/))) r.minutes = Number(m[1]) * 60
  else if ((m = s.match(/(\d+)\s*(분|min\b|m\b)/i))) r.minutes = Number(m[1])
  if (r.minutes !== null) r.minutes = clamp(r.minutes, 1, 180)

  if (isChoseongQuery(s)) r.cho = true

  if (/테마|다크|라이트|밝게|어둡게|시스템\s*테마|^밤$|^낮$/.test(s)) {
    r.intent = 'theme'
    r.theme = /라이트|밝게|낮/.test(s) ? 'light' : /다크|어둡게|밤/.test(s) ? 'dark' : /시스템/.test(s) ? 'system' : null
  } else if (/모션|움직임|애니메이션/.test(s)) {
    r.intent = 'motion'
    r.motion = /끔|끄기|없/.test(s) ? 'off' : /절제|줄/.test(s) ? 'calm' : /풍부|켜/.test(s) ? 'rich' : null
  } else if (/과제|마감|숙제|제출|시험|퀴즈/.test(s) && /추가|등록|넣|\d|요일|내일|모레|오늘/.test(s)) {
    r.intent = 'task'
    const d = s.match(/(월|화|수|목|금|토|일)요일/)
    const t = s.match(/(\d{1,2}):(\d{2})/)
    const rel = s.match(/(내일|모레|오늘)/)
    r.due = { day: d ? d[1]! : rel ? rel[1]! : null, time: t ? t[0] : null }
  } else if (/새\s*(노트|필기|문서)|노트\s*만들|필기\s*시작/.test(s)) {
    r.intent = 'new'
  } else if (/복습|카드|외우/.test(s) && r.minutes === null) {
    r.intent = 'review'
  } else if (r.minutes !== null || /집중|뽀모|타이머|공부/.test(s)) {
    r.intent = 'focus'
  }
  return r
}

const DAY_INDEX: Record<string, number> = { 일: 0, 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6 }

/** 파싱한 마감을 실제 시각으로. 요일은 '오늘 이후 가장 가까운 그 요일'. */
export function resolveDue(due: ParseResult['due'], now: Date): Date | null {
  if (!due || (!due.day && !due.time)) return null
  let base = startOfDay(now)
  if (due.day === '내일') base = addDays(base, 1)
  else if (due.day === '모레') base = addDays(base, 2)
  else if (due.day && due.day in DAY_INDEX) {
    let diff = DAY_INDEX[due.day]! - now.getDay()
    if (diff < 0) diff += 7
    base = addDays(base, diff)
  }
  return atTime(base, due.time ?? '23:59')
}
