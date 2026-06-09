import { defineConfig, devices } from '@playwright/test'

const PORT = 3001
const BASE_URL = `http://localhost:${PORT}`
const MOCK_API_PORT = 8787
const MOCK_API_URL = `http://localhost:${MOCK_API_PORT}`

export default defineConfig({
  testDir: './e2e',
  // The authenticated real-DB track has its own config (playwright.real-db.config.ts)
  // with real servers + a seeded Neon branch. Exclude it here so the mock track
  // never tries to run those specs against the unauthenticated mock API.
  //
  // admin-portal + booking specs exercise /en/admin and /manage/bookings, routes
  // the Vite shell does not serve yet (#378 migration is public-flow first).
  // Re-enable each when its flow is ported. Tracked in #501.
  testIgnore: ['**/real-db/**', '**/admin-portal.spec.ts', '**/booking.spec.ts'],
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
        // The Vite dev server proxies /api + /auth to this mock API (see
        // vite.config.mts `server.proxy`). Unlike the old Next middleware, the
        // SPA has no server-side auth import chain, so no AUTH_SECRET/DATABASE_URL.
        VITE_DEV_API_PROXY: MOCK_API_URL,
      },
    },
  ],
})
