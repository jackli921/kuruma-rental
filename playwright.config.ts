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
  // The slice-6 booking spec was retired in #1255: its journey is now proven end
  // to end by the real-DB lane (e2e/real-db/marketplace-happy-path.auth.spec.ts).
  // The admin-portal spec runs here (#541): /admin is served on Vite and
  // mock-api.ts resolves a role from the `e2e-mock-role` cookie, so the
  // authenticated guard cases run in the mock track.
  testIgnore: ['**/real-db/**'],
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
      // Desktop specs only. A project-level testIgnore REPLACES the config-level
      // one (Playwright overrides, not merges), so the real-db exclusion must be
      // repeated here. The mobile lane is a distinct project (real iPhone WebKit)
      // so a phone-specific regression can't hide behind desktop chrome.
      testIgnore: ['**/real-db/**', '**/mobile/**'],
    },
    {
      // Mobile UX hardening gate (#1294): real iPhone 13 (WebKit) so touch-target
      // sizes and dvh/scroll behaviour are proven on the browser phones actually
      // run, not desktop Chromium emulation. Wave 1 (#1298) seeds e2e/mobile/;
      // B/C/D/E extend it.
      name: 'mobile-safari',
      use: { ...devices['iPhone 13'] },
      testMatch: ['**/mobile/**'],
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
