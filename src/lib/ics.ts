/**
 * .ics(iCalendar) 가져오기 — 패키지 없이 직접 파싱 (m2-brief 6, design-m2 6-3).
 * 읽는 것: VEVENT의 DTSTART · DTEND(또는 DURATION) · SUMMARY · LOCATION · RRULE(FREQ=WEEKLY, BYDAY, INTERVAL=1만).
 * 매주 반복이 아닌 일정(RRULE 없음 · DAILY · MONTHLY · 격주)과 종일 일정은 세지도 돌려주지도 않는다.
 * 시간대: TZID가 붙은 시각은 기기 시간대의 벽시계 시각으로 본다. 끝에 Z(UTC)면 기기 시간대로 바꾼다.
 */

export interface IcsClass {
  /** 미리보기 줄 키 (summary|weekday|start|end) */
  key: string
  summary: string
  location: string
  /** 0 = 일요일 … 6 = 토요일 */
  weekday: number
  start: string
  end: string
}

const DAY: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 }

/** RFC 5545 3.1: 줄 접기 풀기 (CRLF/LF 뒤 공백·탭으로 이어짐) */
function unfold(src: string): string[] {
  return src.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '').split('\n')
}

function unescapeText(v: string): string {
  return v.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim()
}

interface Prop {
  name: string
  params: Record<string, string>
  value: string
}

function parseLine(line: string): Prop | null {
  // 이름;파라미터=값;...:값 — 파라미터 값의 따옴표 안 ':'는 건너뛴다
  let i = 0
  let quoted = false
  for (; i < line.length; i++) {
    const c = line[i]
    if (c === '"') quoted = !quoted
    else if (c === ':' && !quoted) break
  }
  if (i >= line.length) return null
  const head = line.slice(0, i)
  const value = line.slice(i + 1)
  const [name, ...ps] = head.split(';')
  const params: Record<string, string> = {}
  ps.forEach((p) => {
    const eq = p.indexOf('=')
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '')
  })
  return { name: (name ?? '').toUpperCase(), params, value }
}

/** DTSTART/DTEND 값 → 기기 시간대 Date. 종일(DATE)이면 null */
function parseDate(p: Prop): Date | null {
  if (p.params.VALUE === 'DATE') return null
  const m = p.value.trim().match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/)
  if (!m) return null
  const [, y, mo, d, h, mi, s, z] = m
  const args = [Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s ?? 0)] as const
  return z ? new Date(Date.UTC(...args)) : new Date(...args)
}

/** DURATION(PT1H15M 등) → 분 */
function parseDuration(v: string): number | null {
  const m = v.trim().match(/^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/)
  if (!m) return null
  const [, w, d, h, mi] = m
  return (Number(w ?? 0) * 7 + Number(d ?? 0)) * 1440 + Number(h ?? 0) * 60 + Number(mi ?? 0)
}

const hhmm = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`

export function parseIcs(src: string): IcsClass[] {
  const lines = unfold(src)
  const out = new Map<string, IcsClass>()
  let ev: Prop[] | null = null
  let depth = 0 // VEVENT 안의 VALARM 등은 건너뛴다
  for (const raw of lines) {
    const line = raw.trimEnd()
    if (!line) continue
    const up = line.toUpperCase()
    if (up === 'BEGIN:VEVENT') {
      ev = []
      depth = 0
      continue
    }
    if (!ev) continue
    if (up.startsWith('BEGIN:')) {
      depth++
      continue
    }
    if (up.startsWith('END:') && depth > 0) {
      depth--
      continue
    }
    if (up === 'END:VEVENT') {
      take(ev).forEach((c) => out.set(c.key, c))
      ev = null
      continue
    }
    if (depth === 0) {
      const p = parseLine(line)
      if (p) ev.push(p)
    }
  }
  return [...out.values()].sort((a, b) => ((a.weekday + 6) % 7) - ((b.weekday + 6) % 7) || a.start.localeCompare(b.start))
}

function take(props: Prop[]): IcsClass[] {
  const get = (n: string) => props.find((p) => p.name === n)
  const rrule = get('RRULE')
  const ds = get('DTSTART')
  if (!rrule || !ds) return []
  if (get('STATUS')?.value.toUpperCase() === 'CANCELLED') return []
  const rule: Record<string, string> = {}
  rrule.value.split(';').forEach((kv) => {
    const [k, v] = kv.split('=')
    if (k && v) rule[k.toUpperCase()] = v.toUpperCase()
  })
  if (rule.FREQ !== 'WEEKLY' || (rule.INTERVAL && rule.INTERVAL !== '1')) return []
  const start = parseDate(ds)
  if (!start) return []
  const de = get('DTEND')
  const end = de ? parseDate(de) : null
  const dur = get('DURATION')
  const startMin = start.getHours() * 60 + start.getMinutes()
  let lenMin = end ? Math.round((end.getTime() - start.getTime()) / 60000) : dur ? (parseDuration(dur.value) ?? 60) : 60
  if (lenMin <= 0 || lenMin > 12 * 60) lenMin = 60
  const endMin = Math.min(24 * 60 - 1, startMin + lenMin)
  // BYDAY=MO,WE (앞의 숫자 1MO 같은 달 기준 표기는 주간 반복에서 뜻이 없으므로 요일만 본다)
  // UTC(Z) 시각이면 BYDAY는 UTC 기준 요일 → 기기 시간대로 옮기면서 날이 넘어간 만큼 민다
  let shift = /Z$/i.test(ds.value.trim()) ? start.getDay() - start.getUTCDay() : 0
  if (shift > 1) shift -= 7
  if (shift < -1) shift += 7
  const days = rule.BYDAY
    ? rule.BYDAY.split(',').map((d) => DAY[d.replace(/^[+-]?\d+/, '')]).filter((d): d is number => d !== undefined).map((d) => (d + shift + 7) % 7)
    : [start.getDay()]
  const summary = unescapeText(get('SUMMARY')?.value ?? '') || '수업'
  const location = unescapeText(get('LOCATION')?.value ?? '')
  return [...new Set(days)].map((weekday) => {
    const s = hhmm(startMin)
    const e = hhmm(endMin)
    return { key: `${summary}|${weekday}|${s}|${e}`, summary, location, weekday, start: s, end: e }
  })
}
