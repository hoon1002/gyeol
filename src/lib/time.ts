/** 시간 도우미. 하루 경계는 새벽 4시(밤샘 공부가 다음 날로 넘어가지 않게, architecture 7.3). */

export const MIN = 60_000
export const HOUR = 60 * MIN
export const DAY = 24 * HOUR
export const DAY_BOUNDARY_H = 4

const WEEKDAY = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일']
const WEEKDAY_SHORT = ['일', '월', '화', '수', '목', '금', '토']

export function weekdayKo(d: Date): string {
  return WEEKDAY[d.getDay()] ?? ''
}
export function weekdayShort(i: number): string {
  return WEEKDAY_SHORT[((i % 7) + 7) % 7] ?? ''
}

/** 'HH:MM' → 자정부터 분 */
export function hm(s: string): number {
  const [h, m] = s.split(':').map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}

export function minutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes()
}

export function startOfDay(d: Date | number): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

export function addDays(d: Date | number, n: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

export function atTime(day: Date | number, hhmm: string): Date {
  const x = startOfDay(day)
  const m = hm(hhmm)
  x.setHours(Math.floor(m / 60), m % 60, 0, 0)
  return x
}

/** 학습일(새벽 4시 경계)의 0시 */
export function studyDayStart(now: Date | number): Date {
  const t = new Date(now)
  return startOfDay(new Date(t.getTime() - DAY_BOUNDARY_H * HOUR))
}

/** 학습일 범위 [04:00, 다음날 04:00) */
export function studyDayRange(now: Date | number): [number, number] {
  const s = studyDayStart(now)
  const a = s.getTime() + DAY_BOUNDARY_H * HOUR
  return [a, a + DAY]
}

export function dayKey(d: Date | number): string {
  const x = new Date(d)
  const m = String(x.getMonth() + 1).padStart(2, '0')
  const dd = String(x.getDate()).padStart(2, '0')
  return `${x.getFullYear()}-${m}-${dd}`
}

/** 월요일 0시 */
export function startOfWeek(d: Date | number): Date {
  const x = startOfDay(d)
  const wd = (x.getDay() + 6) % 7
  return addDays(x, -wd)
}

/** 달력 날짜 차이 (D-day) */
export function ddayOf(now: Date | number, due: Date | number): number {
  const a = startOfDay(now).getTime()
  const b = startOfDay(due).getTime()
  return Math.round((b - a) / DAY)
}

export function fmtDday(n: number): string {
  if (n === 0) return 'D-day'
  return n > 0 ? `D-${n}` : `D+${-n}`
}

/** "오전 9:32" */
export function fmtClock(d: Date): string {
  const h = d.getHours()
  const m = String(d.getMinutes()).padStart(2, '0')
  const ap = h < 12 ? '오전' : '오후'
  const h12 = h % 12 === 0 ? 12 : h % 12
  if (h >= 21 || h < 4) return `${h < 4 ? '새벽' : '밤'} ${h12}:${m}`
  return `${ap} ${h12}:${m}`
}

/** "13:00" */
export function fmtHM(d: Date | number): string {
  const x = new Date(d)
  return `${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`
}

/** 분 → "2시간 10분", "43분", "1시간" */
export function fmtDur(min: number): string {
  const m = Math.max(0, Math.round(min))
  const h = Math.floor(m / 60)
  const r = m % 60
  if (h && r) return `${h}시간 ${r}분`
  if (h) return `${h}시간`
  return `${r}분`
}

/** "10.22" */
export function fmtMD(d: Date | number): string {
  const x = new Date(d)
  return `${x.getMonth() + 1}.${x.getDate()}`
}

/** 상대 시각: "2분 전", "어제", "월요일", "지난주" */
export function fmtAgo(now: number, t: number): string {
  const diff = now - t
  if (diff < MIN) return '방금'
  if (diff < HOUR) return `${Math.floor(diff / MIN)}분 전`
  const days = ddayOf(t, now)
  if (days === 0) return '오늘'
  if (days === 1) return '어제'
  if (days < 7) return weekdayKo(new Date(t))
  if (days < 14) return '지난주'
  return `${Math.floor(days / 7)}주 전`
}

export function clamp(v: number, a: number, b: number): number {
  return Math.min(b, Math.max(a, v))
}
