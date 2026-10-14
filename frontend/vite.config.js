import { defineConfig } from 'vite'
import { configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    // Dev server only (npm run dev): requests to /api go to the local backend,
    // so a page can call "/api/..." without CORS. Not used by `vite build` or
    // by E2E, which talks to http://localhost:3001 directly.
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
  // Vitest: run component tests in a simulated browser (jsdom).
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/setupTests.js'],
    // The longest form tests type every key; under coverage they take ~4.5 s
    // alone and more while other test runs share the CPU. 5 s was too tight.
    testTimeout: 15000,
    // e2e/ holds the Playwright tests (npm run e2e), not Vitest ones.
    exclude: [...configDefaults.exclude, 'e2e/**'],
    // `npm run coverage` fails if any total drops below 80%.
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{js,jsx}'],
      exclude: ['src/main.jsx', 'src/setupTests.js', 'src/test/**', 'src/**/*.test.{js,jsx}'],
      thresholds: { lines: 80, statements: 80, functions: 80, branches: 80 },
    },
  },
})
