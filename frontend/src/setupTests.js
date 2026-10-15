// Runs before every test file (see vite.config.js -> test.setupFiles).
import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { afterEach, beforeAll, vi } from 'vitest'
import { preloadPages } from './routes'

// Pages are lazy (routes.jsx). Load their code once so a test sees the page
// straight away, as before; routes.test.jsx checks the skeleton-first path.
beforeAll(() => preloadPages())

// findBy*/waitFor wait up to 3 s (default 1 s): the first page render in a file
// can take over a second while other test runs share the CPU.
configure({ asyncUtilTimeout: 3000 })

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
