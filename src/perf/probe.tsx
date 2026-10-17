/**
 * React 커밋 계측용 감싸개. 개발 빌드에서만 <Profiler>가 되고, 프로덕션에서는 children 그대로(Profiler·콜백 없음).
 * 커밋은 src/perf/power.ts가 설치한 window.__gyeolPowerReact로 보낸다(설치 전이면 버린다).
 */
import { Profiler, type ProfilerOnRenderCallback, type ReactNode } from 'react'

type Sink = (id: string, ms: number) => void

const onRender: ProfilerOnRenderCallback = (id, _phase, actualDuration) => {
  ;(window as Window & { __gyeolPowerReact?: Sink }).__gyeolPowerReact?.(id, actualDuration)
}

function DevProbe({ id, children }: { id: string; children: ReactNode }) {
  return (
    <Profiler id={id} onRender={onRender}>
      {children}
    </Profiler>
  )
}

function PassThrough({ children }: { id: string; children: ReactNode }) {
  return <>{children}</>
}

export const Probe = import.meta.env.DEV ? DevProbe : PassThrough
