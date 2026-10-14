// Runs before every test file (see vite.config.js -> test.setupFiles).
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeAll, vi } from 'vitest'
import { preloadPages } from './routes'

// Pages are lazy (routes.jsx). Load their code once so a test sees the page
// straight away, as before; routes.test.jsx checks the skeleton-first path.
beforeAll(() => preloadPages())

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
