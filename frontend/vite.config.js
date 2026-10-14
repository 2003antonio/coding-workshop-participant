import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000
  },
  // Vitest: run component tests in a simulated browser (jsdom).
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/setupTests.js'],
    // `npm run coverage` fails if any total drops below 80%.
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{js,jsx}'],
      exclude: ['src/main.jsx', 'src/setupTests.js', 'src/test/**', 'src/**/*.test.{js,jsx}'],
      thresholds: { lines: 80, statements: 80, functions: 80, branches: 80 },
    },
  },
})
