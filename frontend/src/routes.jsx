// The route table. Every page is lazy: its code downloads the first time
// someone opens it, and App.jsx shows PageSkeleton meanwhile. Add a page with
// one line in the right list (and one in navigation.js for a menu link).
import { lazy } from 'react'

/**
 * React.lazy plus preload(): once a page's code is loaded, it renders at once
 * instead of showing the skeleton again. setupTests.js preloads every page so
 * component tests see pages straight away.
 */
export function lazyPage(load) {
  let loaded
  const Page = lazy(() => (loaded
    ? { then: (resolve) => resolve(loaded) } // already here: React renders without waiting
    : load().then((module) => (loaded = module))))
  Page.preload = () => load().then((module) => { loaded = module })
  return Page
}

/** Open to everyone. */
export const PUBLIC_ROUTES = [
  { path: '/login', Page: lazyPage(() => import('./pages/LoginPage')) },
]

/** Need a session (ProtectedRoute); each page checks its own role rules. */
export const PROTECTED_ROUTES = [
  { path: '/', Page: lazyPage(() => import('./pages/HomePage')) },
  { path: '/activity', Page: lazyPage(() => import('./pages/ActivityPage')) },
  { path: '/employees', Page: lazyPage(() => import('./pages/EmployeesPage')) },
  { path: '/my-work', Page: lazyPage(() => import('./pages/MyWorkPage')) },
  { path: '/projects', Page: lazyPage(() => import('./pages/ProjectsPage')) },
  { path: '/projects/:id', Page: lazyPage(() => import('./pages/ProjectDetailPage')) },
  { path: '/reports', Page: lazyPage(() => import('./pages/ReportsPage')) },
  { path: '/teams', Page: lazyPage(() => import('./pages/TeamsPage')) },
  { path: '/teams/:id', Page: lazyPage(() => import('./pages/TeamDetailPage')) },
]

/** Load every page's code now (tests; could also warm the cache after sign-in). */
export const preloadPages = () => Promise.all([...PUBLIC_ROUTES, ...PROTECTED_ROUTES].map(({ Page }) => Page.preload()))
