// Forge an Auth.js v5 session cookie for the E2E renter (#392). The booking flow
// is auth-gated (middleware redirects /bookings/* when unauthenticated), so the
// spec sets this cookie to "sign in" without real OAuth. No production code is
// touched — the cookie is a JWE encrypted with the SAME placeholder AUTH_SECRET
// the dev server runs with (playwright.config.ts).

import type { Cookie } from '@playwright/test'

// Must match playwright.config.ts webServer env AUTH_SECRET.
const AUTH_SECRET = 'e2e-placeholder-secret-not-real'
// v5 non-secure (http://localhost) session cookie name. The salt for encode is
// the cookie name itself.
const SESSION_COOKIE = 'authjs.session-token'
// Must match TEST_RENTER_ID in e2e/mock-api.ts (the booking's renterId).
export const TEST_RENTER_ID = 'e2e-renter-1'

export async function renterSessionCookie(): Promise<Cookie> {
  // Dynamic import: @auth/core/jwt is ESM-only and Playwright's runner is CJS.
  const { encode } = await import('@auth/core/jwt')
  const token = await encode({
    salt: SESSION_COOKIE,
    secret: AUTH_SECRET,
    token: {
      sub: TEST_RENTER_ID,
      name: 'E2E Renter',
      email: 'e2e-renter@example.com',
      role: 'RENTER',
      operatorId: null,
      // Present + fresh so the jwt callback skips its DB role refresh (the E2E
      // DATABASE_URL is an unreachable placeholder).
      roleRefreshedAt: Date.now(),
    },
  })

  return {
    name: SESSION_COOKIE,
    value: token,
    domain: 'localhost',
    path: '/',
    httpOnly: true,
    secure: false,
    sameSite: 'Lax',
    expires: Math.floor(Date.now() / 1000) + 60 * 60,
  }
}
