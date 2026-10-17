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

// 경로는 글자 그대로 적어야 라우터 타입이 장소 주소를 안다
const today = createRoute({ getParentRoute: () => rootRoute, path: '/', component: Empty })
const notes = createRoute({ getParentRoute: () => rootRoute, path: '/notes', component: Empty })
const map = createRoute({ getParentRoute: () => rootRoute, path: '/map', component: Empty })
const review = createRoute({ getParentRoute: () => rootRoute, path: '/review', component: Empty })
const plan = createRoute({ getParentRoute: () => rootRoute, path: '/plan', component: Empty })
const focus = createRoute({ getParentRoute: () => rootRoute, path: '/focus', component: Empty })

/** 옛 주소 → 새 주소 (기록을 남기지 않고 바꿔 끼운다) */
const graph = createRoute({
  getParentRoute: () => rootRoute,
  path: '/graph',
  beforeLoad: () => {
    throw redirect({ href: '/map', replace: true })
  },
})
const planner = createRoute({
  getParentRoute: () => rootRoute,
  path: '/planner',
  beforeLoad: () => {
    throw redirect({ href: '/plan', replace: true })
  },
})
/** 설정은 장소가 아니다: 주소로 열면 오늘 위에 시트로 */
const settings = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  beforeLoad: ({ preload }) => {
    // 링크 미리 불러오기(호버)에서는 열지 않는다
    if (!preload) useUi.getState().openSettings(null)
    throw redirect({ href: '/', replace: true })
  },
})

const routes = [today, notes, map, review, plan, focus, graph, planner, settings]

const routeTree = rootRoute.addChildren(routes)

export const router = createRouter({ routeTree, defaultPreload: 'intent' })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
