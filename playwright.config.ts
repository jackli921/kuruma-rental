import { defineConfig, devices } from '@playwright/test'

const PORT = 3001
const BASE_URL = `http://localhost:${PORT}`

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: [
    {
      command: 'bun run e2e/mock-api.ts',
      url: 'http://localhost:8787/vehicles',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: 'bun run --filter @kuruma/web dev',
      url: BASE_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        // Valid-format placeholders — the E2E spec routes hit the mock API,
        // not the real DB. Middleware's auth() import chain touches neon()
        // and will crash on empty values even if the DB is never queried.
        AUTH_SECRET: 'e2e-placeholder-secret-not-real',
        DATABASE_URL: 'postgresql://e2e:e2e@localhost:5432/e2e?connect_timeout=1',
        NEXT_PUBLIC_API_URL: 'http://localhost:8787',
      },
    },
  ],
})
