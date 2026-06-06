import { defineConfig, devices } from '@playwright/test'
import { E2E_AUTH_SECRET } from './e2e/mint-mock-session'

const PORT = 3001
const BASE_URL = `http://localhost:${PORT}`
const MOCK_API_PORT = 8787
const MOCK_API_URL = `http://localhost:${MOCK_API_PORT}`

export default defineConfig({
  testDir: './e2e',
  // The authenticated real-DB track has its own config (playwright.real-db.config.ts)
  // with real servers + a seeded Neon branch. Exclude it here so the mock track
  // never tries to run those specs against the unauthenticated mock API.
  testIgnore: '**/real-db/**',
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
      url: `${MOCK_API_URL}/vehicles`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: { MOCK_API_PORT: String(MOCK_API_PORT) },
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
        AUTH_SECRET: E2E_AUTH_SECRET,
        DATABASE_URL: 'postgresql://e2e:e2e@localhost:5432/e2e?connect_timeout=1',
        NEXT_PUBLIC_API_URL: MOCK_API_URL,
      },
    },
  ],
})
