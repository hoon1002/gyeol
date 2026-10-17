/**
 * 앱 루트: FieldProvider(필드 캔버스 1개, 화면이 바뀌어도 다시 만들지 않음) + 셸 크롬 + 화면.
 * 레이어 규칙: html 배경(--bg-0) / body 투명 / 앱 루트 position:relative; z-index:1.
 */
import { Outlet, useRouterState } from '@tanstack/react-router'
import { MotionConfig } from 'motion/react'
import { memo, useEffect, useMemo, useState, type ComponentType } from 'react'
import { FieldProvider, RippleSurface, SkyEntrance, useSkyLens, useSkyPhase, type SkyPhase } from '@/fx'
import { requestPersistence } from '@/db/schema'
import { applyTheme, resolveTheme, type Eff } from '@/lib/theme'
import { CommandPalette } from '@/shell/CommandPalette'
import { Dock, Toaster, TopBar } from '@/shell/Chrome'
import { SettingsSheet } from '@/shell/SettingsSheet'
import { useEffectiveMotion, useEffectiveRotation, useMediaQuery, useScrollHide } from '@/shell/hooks'
import { useSettings } from '@/stores/settings'
import { StarPress } from '@/shell/StarPress'
import { SPACES } from '@/shell/spaces'
import { ActiveContext } from './keepAlive'
import { installZones } from './zones'
import { Probe } from '@/perf/probe'
import { TodayScreen } from '@/screens/Today'
import { NotesScreen } from '@/screens/Notes'
import { MapScreen } from '@/screens/Map'
import { ReviewScreen } from '@/screens/Review'
import { PlanScreen } from '@/screens/Plan'
import { FocusScreen } from '@/screens/Focus'
import { useUi } from '@/stores/ui'
import { MemoSheet } from '@/capture/MemoSheet'
import { TipLayer } from '@/shell/Tip'
import { DustSheet } from '@/capture/DustBox'
import { CaptureSky } from '@/capture/CaptureSky'
import { Onboarding } from '@/onboarding/Onboarding'

/**
 * 1분마다(분 경계에 맞춰) + 앱이 다시 보일 때 시계를 갱신 → 상황 엔진 재평가.
 * 전력: 탭이 숨으면 타이머를 멈춘다(숨은 동안 장소 6 재렌더·DB 재조회 0, 깨우기 0). 다시 보이면 바로 갱신하고 분 경계에 다시 맞춘다.
 */
function useClockTicker() {
  const bump = useUi((s) => s.bumpTick)
  useEffect(() => {
    let iv = 0
    let t = 0
    const stop = () => {
      clearTimeout(t)
      clearInterval(iv)
      t = iv = 0
    }
    const arm = () => {
      stop()
      t = window.setTimeout(() => {
        bump()
        iv = window.setInterval(bump, 60_000)
      }, 60_000 - (Date.now() % 60_000) + 50)
    }
    const onVis = () => {
      if (document.hidden) stop()
      else {
        bump()
        arm()
      }
    }
    if (!document.hidden) arm()
    document.addEventListener('visibilitychange', onVis)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [bump])
}

/** 실제 적용 테마. 집중 화면은 테마와 상관없이 '밤' 팔레트(design.md 3-1). */
function useEffectiveTheme(path: string): Eff {
  const pref = useSettings((s) => s.theme)
  const sysLight = useMediaQuery('(prefers-color-scheme: light)')
  if (path === '/focus') return 'dark'
  return pref === 'system' ? (sysLight ? 'light' : 'dark') : resolveTheme(pref)
}

/** 하늘 시간대: 실시간이면 엔진이 시계를 따르고(auto), 개발용 시각 고정이면 그 시각의 하늘 */
function SkyLink() {
  const clock = useSettings((s) => s.clock)
  const lens = useSettings((s) => s.lens)
  const phase: SkyPhase = clock === 'live' ? 'auto' : clock === 'night' || clock === 'late' ? 'night' : clock === 'morning' ? 'dawn' : 'blue'
  useSkyPhase(phase)
  const color = lens ? getComputedStyle(document.documentElement).getPropertyValue(`--s-${lens}`).trim() || undefined : undefined
  useSkyLens(lens, color)
  return <SkyEntrance once="session" />
}

const SCREENS: Record<string, ComponentType> = {
  '/': TodayScreen,
  '/notes': NotesScreen,
  '/map': MapScreen,
  '/review': ReviewScreen,
  '/plan': PlanScreen,
  '/focus': FocusScreen,
}

installZones()

/** 한 공간. 비활성이면 보이지만 않게(visibility, 배치는 유지 → 다시 보일 때 레이아웃 계산 없음) + inert. memo라 활성 여부가 바뀔 때만 다시 그린다 */
const Space = memo(function Space({ path, active }: { path: string; active: boolean }) {
  const Screen = SCREENS[path]!
  const content = useMemo(() => <Probe id={path}><Screen /></Probe>, [Screen, path])
  return (
    <ActiveContext.Provider value={active}>
      <div className="space" data-path={path} data-inactive={!active ? '' : undefined} aria-hidden={!active || undefined} inert={!active ? true : undefined}>
        {content}
      </div>
    </ActiveContext.Provider>
  )
})

/**
 * keep-alive: 처음 연 공간만 바로 마운트하고, 나머지는 첫 화면이 뜬 뒤 유휴 시간에 하나씩 숨긴 채 마운트한다.
 * 이후 공간 전환은 hidden 속성만 바뀌므로 전환 첫 프레임에 React 마운트가 없다.
 */
function KeepAlive({ path }: { path: string }) {
  const [mounted, setMounted] = useState<string[]>(() => (SCREENS[path] ? [path] : []))
  if (SCREENS[path] && !mounted.includes(path)) setMounted((m) => [...m, path])
  useEffect(() => {
    let cancelled = false
    const ric: (cb: () => void) => number = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback
      ? (cb) => (window as Window & { requestIdleCallback: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback(cb, { timeout: 1500 })
      : (cb) => window.setTimeout(cb, 200)
    const queue = SPACES.map((x) => x.path as string)
    const step = () => {
      if (cancelled) return
      const next = queue.shift()
      if (!next) return
      setMounted((m) => (m.includes(next) ? m : [...m, next]))
      ric(step)
    }
    // 첫 진입 연출(약 1초)이 끝난 뒤부터
    const t = window.setTimeout(() => ric(step), 1400)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [])
  return (
    <>
      {mounted.map((p) => (
        <Space key={p} path={p} active={p === path} />
      ))}
    </>
  )
}

export function RootLayout() {
  const path = useRouterState({ select: (s) => s.location.pathname })
  const theme = useEffectiveTheme(path)
  const level = useEffectiveMotion()
  const tier = useSettings((s) => s.tier)
  const fps = useSettings((s) => s.fps)
  const travelPref = useSettings((s) => s.travel)
  const travel = level === 'off' ? 'off' : travelPref
  const rotation = useEffectiveRotation()
  const land = useMediaQuery('(min-width: 600px) and (min-aspect-ratio: 1/1)')
  useClockTicker()
  useScrollHide()

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  useEffect(() => {
    document.documentElement.dataset.motion = level
  }, [level])

  useEffect(() => {
    // M2: 첫 실행은 자동 시드 대신 첫 실행 2분(src/onboarding)이 맡는다
    void requestPersistence()
  }, [])

  // 화면이 바뀌면 숨겨 둔 크롬을 다시 보인다
  useEffect(() => {
    useUi.getState().setScrollHidden(false)
    useUi.getState().setLensOpen(false)
  }, [path])

  return (
    <FieldProvider level={level} theme={theme} tier={tier} debug={fps} travel={travel} rotation={rotation}>
      <SkyLink />
      <CaptureSky />
      <MotionConfig reducedMotion={level === 'off' ? 'always' : 'never'}>
        <div className="app" data-space={path === '/' ? 'today' : path.slice(1)}>
          <a className="skip" href="#stage">본문으로 건너뛰기</a>
          <TopBar />
          <RippleSurface as="main" className="stage">
            <div id="stage" tabIndex={-1} className="stage-inner" data-gx-vt-root="">
              <KeepAlive path={path} />
              {!SCREENS[path] && <Outlet />}
            </div>
          </RippleSurface>
          <Dock />
          <MemoSheet />
          <DustSheet inlineOnToday={land && path === '/'} />
          <Onboarding />
          <StarPress />
          <SettingsSheet />
          <CommandPalette />
          <Toaster />
          <TipLayer />
        </div>
      </MotionConfig>
    </FieldProvider>
  )
}
