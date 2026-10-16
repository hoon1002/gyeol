/** TanStack Router — 코드 기반 라우트. URL이 곧 화면이라 새로고침해도 같은 화면. */
import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { RootLayout } from './RootLayout'
import { NotFoundScreen } from '@/screens/NotFound'

/** 화면은 RootLayout의 KeepAlive가 그린다(라우트는 URL·새로고침 유지용) */
const Empty = () => null

const rootRoute = createRootRoute({ component: RootLayout, notFoundComponent: NotFoundScreen })

const routes = [
  createRoute({ getParentRoute: () => rootRoute, path: '/', component: Empty }),
  createRoute({ getParentRoute: () => rootRoute, path: '/notes', component: Empty }),
  createRoute({ getParentRoute: () => rootRoute, path: '/graph', component: Empty }),
  createRoute({ getParentRoute: () => rootRoute, path: '/review', component: Empty }),
  createRoute({ getParentRoute: () => rootRoute, path: '/planner', component: Empty }),
  createRoute({ getParentRoute: () => rootRoute, path: '/focus', component: Empty }),
  createRoute({ getParentRoute: () => rootRoute, path: '/settings', component: Empty }),
]

const routeTree = rootRoute.addChildren(routes)

export const router = createRouter({ routeTree, defaultPreload: 'intent' })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
