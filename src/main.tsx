import { StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { RouterProvider } from '@tanstack/react-router'
import { router } from '@/app/router'
import '@/styles/tokens.css'
import '@/styles/base.css'
import '@/styles/shell.css'
import '@/styles/screens.css'

/** 루트는 한 번만 만든다 (개발 서버 HMR로 이 모듈이 다시 실행돼도 같은 root를 재사용) */
type RootHost = HTMLElement & { __gyeolRoot?: Root }

const host = document.getElementById('root') as RootHost | null
if (host) {
  host.__gyeolRoot ??= createRoot(host)
  host.__gyeolRoot.render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  )
}
