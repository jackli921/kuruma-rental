import { defineConfig, devices } from '@playwright/test'
import { STORAGE_STATE } from './e2e/real-db/constants'

// Authenticated, real-DB e2e track (#416). Distinct from the mock track in
// playwright.config.ts: it runs the REAL Hono API + web against a seeded Neon
// branch, with a minted Auth.js session cookie. Own ports so it never collides
// with the mock track's servers (web 3001 / mock-api 8787).
const WEB_PORT = 3002
const API_PORT = 8788
const BASE_URL = `http://localhost:${WEB_PORT}`
const API_URL = `http://localhost:${API_PORT}`

const AUTH_SECRET = process.env.AUTH_SECRET
const DATABASE_URL = process.env.DATABASE_URL
if (!AUTH_SECRET || !DATABASE_URL) {
  throw new Error(
    'The real-DB e2e track needs AUTH_SECRET + DATABASE_URL (a seeded Neon branch). ' +
      'Run: AUTH_SECRET=<secret> DATABASE_URL=<neon-branch-url> bun run test:e2e:real-db',
  )
}

export default defineConfig({
  testDir: './e2e/real-db',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'authenticated-real-db',
      testMatch: /.*\.auth\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], storageState: STORAGE_STATE },
    },
  ],

  webServer: [
    {
      command: 'bun run e2e/real-db/real-api-server.ts',
      url: `${API_URL}/vehicle-classes`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: {
        REAL_API_PORT: String(API_PORT),
        DATABASE_URL,
        AUTH_SECRET,
        WEB_ORIGIN: BASE_URL,
      },
    },
    {
      command: 'bun run next dev -p 3002',
      cwd: 'packages/web',
      url: BASE_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        AUTH_SECRET,
        DATABASE_URL,
        NEXT_PUBLIC_API_URL: API_URL,
      },
    },
  ],
})
