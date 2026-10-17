/**
 * 전력 상태 · 프레임 스케줄러 (프로덕션 모듈, 의존성 없음 — 2.5D 하늘과 galaxy3d가 같이 쓴다). team/power-budget.md §2·§4.
 *
 * 상태: busy(사건·전환·비행 = 기기 주사율) · active(입력 2초 안, 60) · normal(30) · deep(15) · rest(0, 바뀔 때만) · hidden(0)
 * - 깨우기는 '다음 프레임 직전'에만: 상한이 주사율보다 낮으면 setTimeout → rAF (rAF에서 건너뛰지 않는다 → 깨우기 = 그린 프레임).
 * - 저전력: Battery(≤ 20% · 충전 안 함) · saveData · rAF 간격 ≈ 33ms(iPad 저전력 모드 = Safari 30Hz) → 한 단계씩 낮춘다.
 * - 발열 추정: 원하는 간격의 1.5배를 넘는 프레임 p95가 10초 → 한 단계 낮춤(최대 2), 30초 정상이면 하나 회복.
 * - 쉼으로 들어갈 땐 주변 시계가 2초에 걸쳐 멈추고(AmbientClock), 돌아올 땐 600ms에 걸쳐 다시 빨라진다(점프 없음).
 */

export type PowerState = 'busy' | 'active' | 'normal' | 'deep' | 'rest' | 'hidden'

export interface PowerRule {
  /** 입력이 없을 때 normal → deep 까지 (ms) */
  deepAfterMs: number
  /** 입력이 없을 때 → rest 까지 (ms) */
  restAfterMs: number
}

export const ACTIVE_MS = 2000
export const DEFAULT_RULE: PowerRule = { deepAfterMs: 60_000, restAfterMs: 300_000 }
/** 공간별 규칙 (리더 결정 2026-10-17): 집중 20초 → 쉼, 글이 하늘을 많이 가리는 화면 30초 → 깊은 대기 */
export const SPACE_RULES: Record<string, PowerRule> = {
  focus: { deepAfterMs: 20_000, restAfterMs: 20_000 },
  notes: { deepAfterMs: 30_000, restAfterMs: 300_000 },
  review: { deepAfterMs: 30_000, restAfterMs: 300_000 },
  settings: { deepAfterMs: 30_000, restAfterMs: 300_000 },
}

/** 상태별 목표 fps (0 = 그리지 않음, busy는 기기 주사율) */
export const STATE_FPS: Record<PowerState, number> = { busy: Infinity, active: 60, normal: 30, deep: 15, rest: 0, hidden: 0 }
/** 내부 해상도 배율 권고 (galaxy3d용 — 2.5D 하늘은 굽기 층 때문에 쓰지 않는다, power-budget §7) */
export const STATE_SCALE: Record<PowerState, number> = { busy: 1, active: 1, normal: 0.75, deep: 0.6, rest: 0.6, hidden: 0.6 }

const LADDER: PowerState[] = ['active', 'normal', 'deep', 'rest']

/* ---------- 입력 · 저전력 · 발열 감시 (페이지에 하나) ---------- */

type Nav = Navigator & {
  connection?: { saveData?: boolean; addEventListener?: (t: string, f: () => void) => void }
  getBattery?: () => Promise<{ level: number; charging: boolean; addEventListener: (t: string, f: () => void) => void }>
}

class PowerMonitor {
  private last = typeof performance !== 'undefined' ? performance.now() : 0
  private wakers = new Set<() => void>()
  private battery = false
  private saveData = false
  private slowVsync = false
  private vs: number[] = []
  private heat: number[] = []
  private heatT0 = 0
  private okT0 = 0
  /** 발열 단계 0–2 */
  thermal = 0
  private started = false

  start() {
    if (this.started || typeof window === 'undefined') return
    this.started = true
    const onInput = () => {
      const now = performance.now()
      const wasIdle = now - this.last > 250
      this.last = now
      if (wasIdle) this.wakers.forEach((f) => f())
    }
    const o = { passive: true, capture: true } as AddEventListenerOptions
    for (const t of ['pointerdown', 'pointermove', 'wheel', 'keydown', 'touchstart', 'scroll']) window.addEventListener(t, onInput, o)
    const nav = navigator as Nav
    const sd = () => {
      this.saveData = !!nav.connection?.saveData
    }
    sd()
    nav.connection?.addEventListener?.('change', sd)
    nav
      .getBattery?.()
      .then((b) => {
        const up = () => {
          const low = !b.charging && b.level <= 0.2
          if (low !== this.battery) {
            this.battery = low
            this.wakers.forEach((f) => f())
          }
        }
        up()
        b.addEventListener('levelchange', up)
        b.addEventListener('chargingchange', up)
      })
      .catch(() => {})
  }

  lastInput(): number {
    return this.last
  }
  /** 입력·저전력 변화 때 불린다 (루프가 쉬고 있으면 다시 걸 것) */
  onWake(f: () => void): () => void {
    this.wakers.add(f)
    return () => this.wakers.delete(f)
  }
  lowPower(): boolean {
    return this.battery || this.saveData || this.slowVsync
  }
  reasons() {
    return { battery: this.battery, saveData: this.saveData, vsync30: this.slowVsync, thermal: this.thermal }
  }

  /**
   * 매 vsync를 요청한 프레임의 간격(ms)과 그 프레임이 원한 간격(ms).
   * ① 매 vsync 요청인데 간격 중앙값이 30–36ms로 2초 → 저전력(iPad Safari 30Hz) ② 원한 간격 × 1.5 넘는 p95가 10초 → 발열 단계 +1
   */
  noteFrame(interval: number, wanted: number, everyVsync: boolean) {
    if (interval <= 0 || interval > 250 || document.hidden) {
      this.vs = []
      return
    }
    if (everyVsync) {
      this.vs.push(interval)
      if (this.vs.length >= 60) {
        const s = [...this.vs].sort((a, b) => a - b)
        const med = s[s.length >> 1]!
        this.vs = []
        const slow = med > 30 && med < 36
        if (slow !== this.slowVsync) {
          this.slowVsync = slow
          this.wakers.forEach((f) => f())
        }
      }
    }
    const now = performance.now()
    this.heat.push(interval / Math.max(wanted, 1000 / 120))
    if (!this.heatT0) this.heatT0 = now
    if (now - this.heatT0 < 10_000 || this.heat.length < 20) return
    const s = [...this.heat].sort((a, b) => a - b)
    const p95 = s[Math.floor(0.95 * (s.length - 1))]!
    this.heat = []
    this.heatT0 = now
    if (p95 > 1.5) {
      this.okT0 = 0
      if (this.thermal < 2) this.thermal++
    } else if (this.thermal > 0) {
      if (!this.okT0) this.okT0 = now
      else if (now - this.okT0 > 30_000) {
        this.thermal--
        this.okT0 = 0
      }
    }
  }
}

export const powerMonitor = new PowerMonitor()

/* ---------- 상태 판단 ---------- */

export function decideState(now: number, o: { busy: boolean; rule?: PowerRule; hidden?: boolean }): PowerState {
  if (o.hidden ?? (typeof document !== 'undefined' && document.hidden)) return 'hidden'
  if (o.busy) return 'busy'
  const rule = o.rule ?? DEFAULT_RULE
  const idle = now - powerMonitor.lastInput()
  const low = powerMonitor.lowPower()
  let s: PowerState
  if (idle < ACTIVE_MS) s = 'active'
  else if (idle >= rule.restAfterMs || (low && idle >= Math.min(rule.restAfterMs, 20_000))) s = 'rest'
  else if (idle >= rule.deepAfterMs) s = 'deep'
  else s = 'normal'
  // 저전력·발열은 한 단계씩 (쉼은 입력이 없을 때만 — 상호작용을 끊지 않는다)
  let down = (low ? 1 : 0) + powerMonitor.thermal
  while (down-- > 0 && s !== 'rest') {
    const i = LADDER.indexOf(s)
    const next = LADDER[Math.min(i + 1, 2)]!
    if (next === s) break
    s = next
  }
  return s
}

/** 상태의 최소 프레임 간격(ms): 0 = 매 vsync, Infinity = 예약 안 함 */
export function stateInterval(s: PowerState): number {
  const f = STATE_FPS[s]
  if (f === Infinity) return powerMonitor.lowPower() ? 1000 / 60 : 0
  return f > 0 ? 1000 / f : Infinity
}

/* ---------- 예약 ---------- */

/**
 * 다음 프레임 하나를 예약한다. delay ≤ 6ms면 rAF, 아니면 setTimeout(delay − 4) → rAF.
 * 돌려준 함수로 취소. 쉼·숨김에서는 부르지 않는다(깨우기 0).
 */
export function scheduleFrame(cb: FrameRequestCallback, delayMs: number): () => void {
  let raf = 0
  let to = 0
  if (delayMs <= 6) raf = requestAnimationFrame(cb)
  else
    to = window.setTimeout(() => {
      to = 0
      raf = requestAnimationFrame(cb)
    }, delayMs - 4)
  return () => {
    if (to) clearTimeout(to)
    if (raf) cancelAnimationFrame(raf)
    to = raf = 0
  }
}

/* ---------- 주변 시계 (쉼 2초 감속 · 복귀 600ms 가속) ---------- */

const RAMP_UP_MS = 600
const RAMP_DOWN_MS = 2000

/**
 * 주변 움직임(반짝임·별가루·공전)용 시계(초). 상태가 rest가 되면 2초에 걸쳐 속도 1 → 0, 깨어나면 600ms에 걸쳐 0 → 1.
 * 프레임 사이 간격은 최대 100ms만 반영(숨김·멈춤 뒤 점프 없음). 사건 시계(now)와 분리해서 쓴다.
 */
export class AmbientClock {
  t: number
  private rate = 1
  private from = 1
  private to = 1
  private t0 = 0
  private dur = 1
  constructor(start: number) {
    this.t = start
  }
  /** 쉼이면 멈추는 중인가 / 멈췄는가 */
  stopped(): boolean {
    return this.to === 0 && this.rate === 0
  }
  settling(): boolean {
    return this.to === 0 && this.rate > 0
  }
  private ramp(to: number, now: number, dur: number) {
    if (this.to === to) return
    this.from = this.rate
    this.to = to
    this.t0 = now
    this.dur = dur
  }
  /** 이번 프레임: 상태를 반영하고 dtMs만큼 나아간다 */
  advance(now: number, dtMs: number, state: PowerState) {
    if (state === 'rest' || state === 'hidden') this.ramp(0, now, RAMP_DOWN_MS)
    else this.ramp(1, now, this.rate < 0.999 ? RAMP_UP_MS : 1)
    const k = Math.min(1, (now - this.t0) / this.dur)
    const e = k * k * (3 - 2 * k)
    this.rate = this.from + (this.to - this.from) * e
    if (k >= 1) this.rate = this.to
    this.t += (Math.min(100, Math.max(0, dtMs)) / 1000) * this.rate
  }
  /** 숨김에서 돌아옴: 속도 0에서 600ms 가속 */
  wakeFromStop(now: number) {
    this.rate = 0
    this.from = 0
    this.to = 1
    this.t0 = now
    this.dur = RAMP_UP_MS
  }
}
