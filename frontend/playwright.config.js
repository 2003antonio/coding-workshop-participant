import { defineConfig, devices } from '@playwright/test'
import { PYTHON } from './e2e/global-setup.js'

// End-to-end tests against the real local stack: the backend dev server on port
// 3001 (scripts/dev_server.py) and the Vite dev server on port 3000, both started
// here unless already running. The demo data is re-seeded before every run.
// Run: npm run e2e   (needs .env.local with the DEMO_*_PASSWORD values)
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.js',
  // The tests share one demo database and run in file order: pages first, then flows that change data.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3000',
    viewport: { width: 1280, height: 800 },
    // No traces or videos: a trace would store the login request with its password.
    trace: 'off',
    video: 'off',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } }],
  webServer: [
    {
      command: `"${PYTHON}" ../scripts/dev_server.py`,
      url: 'http://127.0.0.1:3001/api/auth/me', // 401 once it is up
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: 'npm run dev -- --port 3000 --strictPort',
      url: 'http://localhost:3000',
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
})
