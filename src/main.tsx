import { StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { RouterProvider } from '@tanstack/react-router'
import { router } from '@/app/router'
import { Probe } from '@/perf/probe'
import '@/styles/tokens.css'
import '@/styles/base.css'
import '@/styles/shell.css'
import '@/styles/screens.css'

/** 루트는 한 번만 만든다 (개발 서버 HMR로 이 모듈이 다시 실행돼도 같은 root를 재사용) */
type RootHost = HTMLElement & { __gyeolRoot?: Root }

function boot() {
  const host = document.getElementById('root') as RootHost | null
  if (!host) return
  host.__gyeolRoot ??= createRoot(host)
  host.__gyeolRoot.render(
    <StrictMode>
      <Probe id="root">
        <RouterProvider router={router} />
      </Probe>
    </StrictMode>,
  )
}

// 개발 빌드: 전력 계측(__gyeolPower)을 하늘·타이머보다 먼저 붙인다. 프로덕션에서는 이 분기와 src/perf/power.ts가 빠진다.
if (import.meta.env.DEV) void import('@/perf/power').then((m) => m.install()).catch(() => {}).finally(boot)
else boot()
