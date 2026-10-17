import { createElement, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react'
import { flushSync } from 'react-dom'
import { getActiveEngine, useFieldEngine, usePrefsInternal } from './context'
import type { CameraTarget, SkyPhase, SkyStatsOut, StarKind } from './sky/field'
import { input } from './engine/input'
import type {
  FieldData,
  FieldMoodProps,
  MotionPrefs,
  PauseReason,
  RippleOptions,
  RippleSurfaceProps,
  SealOptions,
  TransitionOptions,
} from './types'

const stableKey = (v: unknown) => {
  try {
    return JSON.stringify(v) ?? ''
  } catch {
    return String(v)
  }
}

function centerOf(at: Element | { x: number; y: number } | undefined): { x: number; y: number } | null {
  if (!at) return null
  if (typeof Element !== 'undefined' && at instanceof Element) {
    const r = at.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }
  const p = at as { x: number; y: number }
  return { x: p.x, y: p.y }
}

/* ---------- 분위기 ---------- */

/**
 * 화면이 자기 하늘 장면을 선언한다(렌더 없음). 여러 개가 동시에 있으면 마지막에 마운트된 것이 이긴다.
 * v3: preset = 하늘 장면(노출·별 한계·데이터 층). 바뀌면 450ms 노출 미끄러짐(V6, 굽기 없음).
 * override.dim만 노출 배수로 쓰고 등고선 값(speed·step·aniso·knot)은 무시한다. knotRef도 무시.
 * 커밋 중(레이아웃 효과)에 등록해서 useFieldTransition과 같은 프레임에 하늘 전환이 시작된다.
 */
export function FieldMood({ preset, override, knotRef, transitionMs }: FieldMoodProps): null {
  const eng = useFieldEngine()
  const idRef = useRef(0)
  const spec = { preset, override, knotRef, transitionMs }
  const specRef = useRef(spec)
  specRef.current = spec
  const key = preset + '|' + stableKey(override) + '|' + (transitionMs ?? '')

  useLayoutEffect(() => {
    if (!eng) return
    idRef.current = eng.pushMood(specRef.current)
    return () => {
      eng.removeMood(idRef.current)
      idRef.current = 0
    }
  }, [eng])

  useLayoutEffect(() => {
    if (eng && idRef.current) eng.updateMood(idRef.current, specRef.current)
  }, [eng, key, knotRef])

  return null
}

/** v3: 아무 일도 하지 않는다(옹이 개념 폐지, export 유지) */
export function useFieldKnot(ref: RefObject<Element | null>, opts?: { strength?: number; followPointer?: boolean }): void {
  const eng = useFieldEngine()
  const idRef = useRef(0)
  const strength = opts?.strength
  const follow = opts?.followPointer
  useEffect(() => {
    if (!eng) return
    idRef.current = eng.pushPin({ ref, strength, followPointer: follow })
    return () => eng.removePin(idRef.current)
    // 처음 한 번만 등록하고, 값 변경은 아래에서 갱신
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eng, ref])
  useEffect(() => {
    if (eng && idRef.current) eng.updatePin(idRef.current, { ref, strength, followPointer: follow })
  }, [eng, ref, strength, follow])
}

/** 데이터 → 데이터 별: rings = 오늘의 별 수, load = 복습 별 밀도, pressure = 시험 별 다가옴(0..1 → D-14..D-0), tint = 반사 성운 색 */
export function useFieldData(data: FieldData): void {
  const eng = useFieldEngine()
  const idRef = useRef(0)
  const dataRef = useRef(data)
  dataRef.current = data
  const key = stableKey(data)
  useEffect(() => {
    if (!eng) return
    idRef.current = eng.pushData(dataRef.current)
    return () => eng.removeData(idRef.current)
  }, [eng])
  useEffect(() => {
    if (eng && idRef.current) eng.updateData(idRef.current, dataRef.current)
  }, [eng, key])
}

/* ---------- 손길 ---------- */

/** V8 손끝 별빛: 그 자리 별이 밝아진다(최대 +35~60%, 켜짐 250ms · 꺼짐 900ms). 고리·물결 없음 */
export function useRipple(): (x: number, y: number, opts?: RippleOptions) => void {
  const eng = useFieldEngine()
  return useCallback((x: number, y: number, opts?: RippleOptions) => eng?.ripple?.(x, y, opts), [eng])
}

/** 이 영역 안에서 누를 때마다(pointerdown) 그 자리 별빛이 밝아진다(V8). 편집 영역은 이 바깥에 두거나 disabled */
export function RippleSurface({ disabled, strength, as, className, children }: RippleSurfaceProps) {
  const ripple = useRipple()
  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if (disabled) return
      if (e.pointerType === 'mouse' && e.button !== 0) return
      ripple(e.clientX, e.clientY, { strength })
    },
    [disabled, strength, ripple],
  )
  return createElement(as ?? 'div', { className, onPointerDown }, children)
}

/** 완료 순간: 그 자리에 별이 태어난다(V1, birthStar kind 'set'과 같다). stamp 옵션은 무시(도장 폐지) */
export function useSeal(): (at: Element | { x: number; y: number }, opts?: SealOptions) => void {
  const eng = useFieldEngine()
  return useCallback(
    (at: Element | { x: number; y: number }, opts?: SealOptions) => {
      const c = centerOf(at)
      if (!c) return
      eng?.seal?.(c.x, c.y)
      void opts
    },
    [eng],
  )
}

/**
 * 필기('ink')·입력('typing') 중: 하늘 노출이 300ms 동안 85%로 내려가고 시간이 멈춘다(마지막 모습 유지).
 * 그 사이 drawLink는 보류함에 쌓였다가 active가 false가 되고 1.5초 뒤 재생된다.
 * 'overlay'(⌘K·시트): V12 노출 ×0.6 (열림 200ms · 닫힘 260ms).
 */
export function useFieldPause(active: boolean, reason: PauseReason): void {
  const eng = useFieldEngine()
  const idRef = useRef(0)
  useEffect(() => {
    if (!eng) return
    if (!idRef.current) idRef.current = eng.pauseId()
    const id = idRef.current
    return () => eng.removePause(id)
  }, [eng])
  useEffect(() => {
    if (!eng) return
    if (!idRef.current) idRef.current = eng.pauseId()
    eng.setPause(idRef.current, reason, active)
  }, [eng, active, reason])
}

/* ---------- 화면 전환 ---------- */

/* 진행 중인 전환 (연타하면 아직 커밋 안 한 이동은 새 이동으로 바뀐다) */
let pending: { commit: () => void | Promise<void>; timer: number; t0: number; done: Array<() => void>; fail: Array<(e: unknown) => void> } | null = null
let fading: Animation | null = null

const MOOD_NAMES = ['landing', 'today', 'notes', 'graph', 'review', 'planner', 'focus', 'settings', 'map', 'plan']
/** 목적지 장소 추정: opts.to가 없으면 누른 링크의 href('/', '/notes' …)에서 */
function guessMood(opts?: TransitionOptions): string | null {
  if (opts?.to) return opts.to
  const o = opts?.origin
  if (typeof Element !== 'undefined' && o instanceof Element) {
    const a = o.closest('a[href]')
    const href = a?.getAttribute('href')
    if (href) {
      const seg = href.replace(/^https?:\/\/[^/]+/, '').split(/[?#]/)[0]!.replace(/^\//, '').split('/')[0]!
      const m = seg === '' ? 'today' : seg
      if (MOOD_NAMES.includes(m)) return m
    }
  }
  return null
}

/**
 * 화면 전환 (design-v3-motion §3 · camera-brief): 한 타임라인.
 *  t=0 (누른 프레임)  하늘 노출 미끄러짐(V6)·카메라 비행이 바로 출발 + A 내용 opacity 1→0 (180ms)
 *  t≈170ms           라우트 commit (내용이 안 보일 때. 이 프레임 일은 앱 렌더뿐)
 *  다음 프레임         B 내용 opacity 0→1 (220ms)
 * View Transition을 쓰지 않는다 — 스냅숏 동안 렌더가 멈춰 하늘 프레임이 25–50ms 끊기던 원인(측정). opacity는 합성 스레드 애니메이션.
 * 목적지 장소는 opts.to(MoodName) 또는 누른 링크 href로 안다. 모르면 commit 때 새 화면의 FieldMood가 출발시킨다.
 * 끔: 바로 commit. 절제: 200ms 선형.
 */
export function useFieldTransition(): (commit: () => void | Promise<void>, opts?: TransitionOptions) => Promise<void> {
  const eng = useFieldEngine()
  return useCallback(
    (commit: () => void | Promise<void>, opts?: TransitionOptions) => {
      const mode = eng?.mode ?? 'off'
      const target = (document.querySelector('[data-gx-vt-root]') as HTMLElement | null) ?? null
      if (!eng || mode === 'off' || !target || typeof target.animate !== 'function') {
        if (pending) {
          window.clearTimeout(pending.timer)
          pending.done.forEach((f) => f())
          pending = null
        }
        // 진행 중이던 페이드아웃이 0에 멈춰 있지 않게
        fading?.cancel()
        fading = null
        eng?.holdFlight?.(false)
        return Promise.resolve(commit())
      }
      const to = guessMood(opts)
      // 노출(V6)은 누른 프레임에 출발, 카메라 비행은 새 화면이 커밋·첫 페인트된 다음 프레임에 출발(B 글자와 같은 프레임)
      if (eng.onFlight !== undefined) eng.onFlight = opts?.onFlight ?? null
      eng.holdFlight?.(true)
      const flightGuard = window.setTimeout(() => eng.holdFlight?.(false), 600)
      if (to) eng.previewScene?.(to as Parameters<typeof eng.previewScene>[0])
      else eng.navStart?.()
      if (opts?.origin && mode === 'rich') eng.glint?.(centerOf(opts.origin) ?? undefined) // V11: 누른 아이콘 위 별빛 점
      const calm = mode === 'calm'
      const outMs = calm ? 200 : 180
      const inMs = calm ? 200 : 220
      return new Promise<void>((resolve, reject) => {
        // 연타: 아직 커밋 안 한 이동은 버리고 새 이동으로 (하늘은 지금 위치·속도에서 이어 간다)
        if (pending) {
          window.clearTimeout(pending.timer)
          pending.commit = commit
          pending.done.push(resolve)
          pending.fail.push(reject)
          pending.timer = window.setTimeout(run, Math.max(0, outMs - 10 - (performance.now() - pending.t0)))
          return
        }
        const startOpacity = Number(getComputedStyle(target).opacity) || 1
        fading?.cancel()
        fading = target.animate([{ opacity: startOpacity }, { opacity: 0 }], { duration: outMs * startOpacity, easing: calm ? 'linear' : 'cubic-bezier(.4,0,1,1)', fill: 'forwards' })
        pending = { commit, timer: window.setTimeout(run, outMs - 10), t0: performance.now(), done: [resolve], fail: [reject] }
        // 안전장치: 무슨 일이 있어도 1.5초 뒤에는 내용이 보이고 비행 붙잡기가 풀린다
        window.setTimeout(() => {
          if (pending) return
          const a = fading
          if (a && a.playState !== 'running' && Number(getComputedStyle(target!).opacity) < 0.99) {
            a.cancel()
            if (fading === a) fading = null
          }
          eng?.holdFlight?.(false)
        }, 1500)
        function run() {
          const p = pending
          pending = null
          if (!p) return
          let r: void | Promise<void> = undefined
          const c0 = performance.now()
          try {
            flushSync(() => {
              r = p.commit()
            })
            eng?.noteCommit?.(performance.now() - c0)
          } catch (e) {
            p.fail.forEach((f) => f(e))
            fading?.cancel()
            return
          }
          Promise.resolve(r)
            .catch((e: unknown) => {
              p.fail.forEach((f) => f(e))
            })
            .finally(() => {
              requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                  window.clearTimeout(flightGuard)
                  eng?.holdFlight?.(false)
                  if (eng && eng.onFlight !== undefined) eng.onFlight = null
                })
                fading?.cancel()
                fading = target!.animate([{ opacity: 0 }, { opacity: 1 }], { duration: inMs, easing: calm ? 'linear' : 'cubic-bezier(0,0,.2,1)' })
                const f = fading
                f.finished.then(
                  () => p.done.forEach((d) => d()),
                  () => p.done.forEach((d) => d()),
                )
              })
            })
        }
      })
    },
    [eng],
  )
}

/* ---------- 상태 ---------- */

/** 현재 모션 상태 { level, reduced, tier, fps }. fps는 1초마다 바뀐다 */
export function useMotionPrefs(): MotionPrefs {
  return usePrefsInternal()
}

/** ms 동안 입력(포인터·키·스크롤·휠)이 없으면 true */
export function useIdle(ms: number): boolean {
  const [idle, setIdle] = useState(false)
  useEffect(() => {
    let timer = 0
    let isIdle = false
    const check = () => {
      const rem = ms - (performance.now() - input.last())
      if (rem <= 0) {
        if (!isIdle) {
          isIdle = true
          setIdle(true)
        }
      } else timer = window.setTimeout(check, rem + 16)
    }
    const wake = () => {
      if (!isIdle) return
      isIdle = false
      setIdle(false)
      window.clearTimeout(timer)
      timer = window.setTimeout(check, ms + 16)
    }
    const unsub = input.subscribe(wake)
    timer = window.setTimeout(check, Math.max(16, ms - (performance.now() - input.last())))
    return () => {
      unsub()
      window.clearTimeout(timer)
    }
  }, [ms])
  return idle
}

/* ---------- v3 사건 API (design-v3-motion §5-2) — 새 이름으로 추가 ---------- */

type AtLike = 'next' | Element | { x: number; y: number }

export interface SkyEvents {
  birthStar: (o: { id: string; at?: AtLike; kind: StarKind; subject?: string; level?: number }) => void
  growStar: (id: string, progress: number) => void
  fadeStar: (id: string, o?: { to?: number; ms?: number }) => void
  relight: (ids: string | string[], level: number, o?: { glint?: boolean }) => void
  drawLink: (fromId: string, toId: string, o?: { layer?: 'today' | 'graph'; deferIfPaused?: boolean }) => void
  meteor: (o?: { kind?: 'signal' | 'ambient'; size?: 'sm' | 'md' }) => void
  /** M1: 'seat'(나의 자리의 가장 밝은 오늘 별) · { band: 마감까지 남은 날 }(계획의 시간 띠). 3D에서 화면 점은 무시 */
  glint: (near?: Element | { x: number; y: number } | 'seat' | { band: number }) => void
  /** M1: at = 'seat' | 'cluster' 자리 부풂(V13s) */
  swellBand: (o?: { amount?: number; ms?: number; at?: 'seat' | 'cluster' }) => void
  gatherDust: (target: Element | { x: number; y: number } | 'next' | null) => void
  select: (id: string | null) => void
  /* ---- M2 (design-m2 10장) ---- */
  /** D1 메모 저장 → 나의 자리 둘레 별가루 한 점 (45%, 모이지 않는다) */
  dust: (o: { id: string; subjectId?: string }) => void
  /** D2 별가루 수 — 보이는 점은 min(n, 24) */
  setDust: (n: number) => void
  /** D3–D5 나누기: 'note'(기본) 그 과목 성운 쪽으로 흘러감 · 'task' 반짝 뒤 사라짐 · 'archive' 사라짐 */
  fileDust: (id: string, subjectId: string | null, to?: 'note' | 'task' | 'archive') => void
  /** D8 검색 결과 별 반짝 뒤 고정(+25%, 나머지 ×0.5). []이면 원래대로 */
  glintNotes: (ids: string[]) => void
  /** D9 과목 성운 피기 (순간 ①). 카메라는 움직이지 않는다 */
  bloomNebula: (subjectId: string, color: string) => void
  /** D10 은하 보이기: 첫 실행 자세(FieldMood 'onboarding') → 오늘, 회전 0 · 2.6초. 끝나면 resolve */
  revealGalaxy: () => Promise<void>
  /** D11 가져오기 끝: 새 노트 별 앞 12개만 V1s(80ms 간격) */
  importNotes: (ids: string[]) => void
}

const NOOP_EVENTS: SkyEvents = {
  birthStar: () => {},
  growStar: () => {},
  fadeStar: () => {},
  relight: () => {},
  drawLink: () => {},
  meteor: () => {},
  glint: () => {},
  swellBand: () => {},
  gatherDust: () => {},
  select: () => {},
  dust: () => {},
  setDust: () => {},
  fileDust: () => {},
  glintNotes: () => {},
  bloomNebula: () => {},
  revealGalaxy: () => Promise.resolve(),
  importNotes: () => {},
}

/** 하늘 사건 묶음. 모든 함수는 멱등이고 실패하지 않는다(WebGL이 없으면 아무 일도 안 함). 모드별 대체는 엔진이 한다 */
export function useSkyEvent(): SkyEvents {
  const eng = useFieldEngine()
  return useMemo<SkyEvents>(() => {
    if (!eng) return NOOP_EVENTS
    return {
      birthStar: (o) => eng.birthStar?.(o),
      growStar: (id, p) => eng.growStar?.(id, p),
      fadeStar: (id, o) => eng.fadeStar?.(id, o),
      relight: (ids, level, o) => eng.relight?.(ids, level, o),
      drawLink: (a, b, o) => eng.drawLink?.(a, b, o),
      meteor: (o) => eng.meteor?.(o),
      glint: (near) => eng.glint?.(near),
      swellBand: (o) => eng.swellBand?.(o),
      gatherDust: (t) => eng.gatherDust?.(t),
      select: (id) => eng.select?.(id),
      dust: (o) => eng.dust?.(o),
      setDust: (n) => eng.setDust?.(n),
      fileDust: (id, sj, to) => eng.fileDust?.(id, sj, to),
      glintNotes: (ids) => eng.glintNotes?.(ids),
      bloomNebula: (sj, c) => eng.bloomNebula?.(sj, c),
      revealGalaxy: () => eng.revealGalaxy?.() ?? Promise.resolve(),
      importNotes: (ids) => eng.importNotes?.(ids),
    }
  }, [eng])
}

/** 시간대 위상 (#40). 'auto'는 06·18·24시 경계를 60초에 걸쳐 바꾼다 */
export function useSkyPhase(phase: SkyPhase): void {
  const eng = useFieldEngine()
  useEffect(() => {
    eng?.setPhase?.(phase)
  }, [eng, phase])
}

/** V10 과목 렌즈·필터: 반사 성운 색(섞음 ≤ 10%), 다른 과목 별 25% */
export function useSkyLens(subjectId: string | null, color?: string): void {
  const eng = useFieldEngine()
  useEffect(() => {
    eng?.setLens?.(subjectId, color)
    return () => eng?.setLens?.(null)
  }, [eng, subjectId, color])
}

export interface SkyStarsSpec {
  today?: Array<{ id: string; at?: number; kind: StarKind }>
  exam?: { id: string; dday: number } | null
  review?: Array<{ id: string; subject: string; level: number }>
  graph?: { nodes: Array<{ id: string; subject: string; links: number }>; links: Array<[string, string]> }
  /** M2 노트 별: 지도의 과목 성운 둘레에 노트마다 별 하나(id 해시로 자리 고정). links = 링크 수(크기·밝기) */
  notes?: Array<{ id: string; subjectId: string; links: number }>
  /** M2 빛줄기: 노트 사이 링크 쌍(정적 버퍼, 바뀔 때만 다시 올린다) */
  noteLinks?: Array<[string, string]>
  /** M2 과목 색 (빛줄기·노트 별 색 섞기·성운 색) */
  subjects?: Array<{ id: string; color: string }>
}

/** 데이터 층 선언형 동기화 — 사건 없이 최종 상태만 맞춘다(새로고침·이동 뒤) */
export function useSkyStars(spec: SkyStarsSpec): void {
  const eng = useFieldEngine()
  const key = stableKey(spec)
  const ref = useRef(spec)
  ref.current = spec
  useEffect(() => {
    eng?.syncStars?.(ref.current)
  }, [eng, key])
}

const ENTRANCE_IDLE = { playing: false, done: true }

/** 진입 안무 상태 { playing, skip() } */
export function useSkyEntrance(): { playing: boolean; skip: () => void } {
  const eng = useFieldEngine()
  const st = useSyncExternalStore(
    eng ? eng.subscribeEntrance : () => () => {},
    eng ? eng.getEntrance : () => ENTRANCE_IDLE,
    () => ENTRANCE_IDLE,
  )
  const skip = useCallback(() => eng?.skipEntrance?.(), [eng])
  return { playing: st.playing, skip }
}

/** 첫 화면 진입 안무 (§4). 루트에 1번. once="session"이면 탭(세션)마다 1번 */
export function SkyEntrance({ once = 'session' }: { once?: 'session' | 'always' }): null {
  const eng = useFieldEngine()
  useEffect(() => {
    if (!eng) return
    const KEY = 'gx-sky-entrance'
    try {
      if (once === 'session' && sessionStorage.getItem(KEY)) return
      sessionStorage.setItem(KEY, '1')
    } catch {
      /* 저장 못 해도 진행 */
    }
    eng.playEntrance?.()
  }, [eng, once])
  return null
}

/** 3초 숫자 캡션 (#33·#44). opacity만 */
export function useSkyCaption(): { show: (text: string, at: Element | { x: number; y: number }, ms?: number) => void } {
  const eng = useFieldEngine()
  const show = useCallback(
    (text: string, at: Element | { x: number; y: number }, ms = 3000) => {
      const c = centerOf(at)
      if (c && eng) eng.showCaption?.(text, c.x, c.y, ms)
    },
    [eng],
  )
  return { show }
}

/**
 * 은하 카메라 (team/camera-brief.md): 줌·평행 이동만. flyTo는 비행 길이(900–1300ms) 뒤에 끝난다.
 * focus는 하늘 좌표(집 화면 비율 0..1, useSkyPick().pick()의 sky 값) — 그 대상이 '별 좌석'에 앉도록 다가간다.
 * back()은 직전 위치로 물러난다. FieldMood preset이 바뀌면 그 공간의 장소로 자동 비행한다.
 */
export function useSkyCamera(): {
  flyTo: (target: CameraTarget, opts?: { duration?: number }) => Promise<void>
  back: (opts?: { duration?: number }) => Promise<void>
  current: CameraTarget
} {
  const eng = useFieldEngine()
  return useMemo(
    () => ({
      flyTo: (t: CameraTarget, o?: { duration?: number }) => eng?.flyTo?.(t, o) ?? Promise.resolve(),
      back: (o?: { duration?: number }) => eng?.back?.(o) ?? Promise.resolve(),
      get current() {
        return eng?.currentCamera?.() ?? { scene: 'today' as const }
      },
    }),
    [eng],
  )
}

/** 별 누르기: 화면 px ↔ 하늘 좌표, 누른 자리에서 가장 가까운 데이터 별 */
export function useSkyPick(): {
  /** world: 3D 은하 좌표 [x, y, z] (M1 추가). 2.5D 대체에서는 [하늘 x, 하늘 y, 0] */
  pick: (x: number, y: number, radius?: number) => { id: string; layer: string; kind?: 'note'; sky: [number, number]; screen: [number, number]; dist: number; world: [number, number, number] } | null
  toSky: (x: number, y: number) => [number, number]
  toScreen: (skyX: number, skyY: number) => [number, number]
} {
  const eng = useFieldEngine()
  return useMemo(
    () => ({
      pick: (x: number, y: number, r?: number) => eng?.pick?.(x, y, r) ?? null,
      toSky: (x: number, y: number) => eng?.toSky?.(x, y) ?? [x / window.innerWidth, y / window.innerHeight],
      toScreen: (wx: number, wy: number) => eng?.toScreenPx?.(wx, wy) ?? [wx * window.innerWidth, wy * window.innerHeight],
    }),
    [eng],
  )
}

/** 리더 검증용 계측: 굽기 횟수(시작 뒤 늘지 않아야 함), 전환 중 긴 작업 수, 전환 프레임 p95 */
export function getSkyStats(): SkyStatsOut {
  return getActiveEngine()?.skyStats() ?? { bakes: 0, lastBakeMs: 0, longTasksInNav: 0, navP95Ms: 0, tier: 'C', fps: 0 }
}

/* ---------- M1 계약 (m1-brief): 설정 시트 · 앵커 · 빈 하늘 드래그 ---------- */

let sheetSeq = 0
/** 설정 시트가 열려 있는 동안 은하를 어둡게(노출 ×0.65)·느리게. 비행은 없다 */
export function useSkySheet(open: boolean): void {
  const eng = useFieldEngine()
  const idRef = useRef(0)
  if (!idRef.current) idRef.current = ++sheetSeq
  useEffect(() => {
    if (!eng) return
    const id = idRef.current
    eng.setSheet(id, open)
    return () => eng.setSheet(id, false)
  }, [eng, open])
}

/**
 * 은하의 화면 위치(CSS px)를 콜백으로 알린다 — React를 다시 그리지 않는다.
 * 'focus-disk' = 집중 원반 중심·베젤 반지름(타이머 링 자리), 'core' = 은하 중심·보이는 팔 반지름.
 * 비행이 끝날 때 · 크기가 바뀔 때 · 끌기가 멈출 때만 부른다(구독하면 마지막 값을 바로 한 번).
 */
export function useSkyAnchor(name: 'focus-disk' | 'core', cb: (a: { x: number; y: number; r: number; visible: boolean }) => void): void {
  const eng = useFieldEngine()
  const cbRef = useRef(cb)
  cbRef.current = cb
  useEffect(() => {
    if (!eng) return
    return eng.onAnchor(name, (a) => cbRef.current(a))
  }, [eng, name])
}

let dragSeq = 0
/** 빈 하늘 드래그(트랙볼)를 켜고 끈다. 마지막에 선언한 화면이 이긴다. 기본: 오늘·지도·집중 켬, 노트·복습·계획 끔 */
export function useSkyDrag(enabled: boolean): void {
  const eng = useFieldEngine()
  const idRef = useRef(0)
  if (!idRef.current) idRef.current = ++dragSeq
  useLayoutEffect(() => {
    if (!eng) return
    const id = idRef.current
    eng.setDrag(id, enabled)
    return () => eng.setDrag(id, null)
  }, [eng, enabled])
}

/**
 * 집중 시계 (리더 결정 2, design-m1 #9–#11): 은하 각도 = 진행률 × 360°. null(타이머 없음)이면 집중에서 0.24°/s 공전.
 * clock.startedAt = 지금 달리는 구간이 시작된 시각(Date.now 기준), clock.elapsedMs = 그 전 구간까지 쌓인 시간, paused면 elapsedMs만 쓴다.
 * 쉼 상태(20초 무입력)에서는 은하가 멈추고, 돌아오면 그 시각의 각도로 600ms에 걸쳐 따라붙는다.
 */
export function useSkyClock(clock: { startedAt: number; durationMs: number; elapsedMs: number; paused: boolean } | null): void {
  const eng = useFieldEngine()
  const key = clock ? `${clock.startedAt}|${clock.durationMs}|${clock.elapsedMs}|${clock.paused}` : 'none'
  const ref = useRef(clock)
  ref.current = clock
  useEffect(() => {
    eng?.setClock(ref.current)
  }, [eng, key])
  useEffect(() => () => eng?.setClock(null), [eng])
}
