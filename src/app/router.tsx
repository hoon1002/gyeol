/**
 * TanStack Router — 코드 기반 라우트. URL이 곧 장소라 새로고침해도 같은 장소.
 * 장소 6: / · /notes · /map · /review · /plan · /focus. 설정은 장소가 아니라 시트(useUi.settingsOpen).
 * 옛 주소: /graph → /map, /planner → /plan, /settings → 오늘(/) 위에 설정 시트.
 */
import { createRootRoute, createRoute, createRouter, redirect } from '@tanstack/react-router'
import { RootLayout } from './RootLayout'
import { NotFoundScreen } from '@/screens/NotFound'
import { useUi } from '@/stores/ui'

/** 화면은 RootLayout의 KeepAlive가 그린다(라우트는 URL·새로고침 유지용) */
const Empty = () => null

const rootRoute = createRootRoute({ component: RootLayout, notFoundComponent: NotFoundScreen })

const place = (path: string) => createRoute({ getParentRoute: () => rootRoute, path, component: Empty })
const moved = (path: string, to: '/map' | '/plan') =>
  createRoute({
    getParentRoute: () => rootRoute,
    path,
    beforeLoad: () => {
      throw redirect({ to, replace: true })
    },
  })

const routes = [
  place('/'),
  place('/notes'),
  place('/map'),
  place('/review'),
  place('/plan'),
  place('/focus'),
  moved('/graph', '/map'),
  moved('/planner', '/plan'),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/settings',
    beforeLoad: ({ preload }) => {
      // 링크 미리 불러오기(호버)에서는 열지 않는다
      if (!preload) useUi.getState().openSettings(null)
      throw redirect({ to: '/', replace: true })
    },
  }),
]

const routeTree = rootRoute.addChildren(routes)

export const router = createRouter({ routeTree, defaultPreload: 'intent' })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
