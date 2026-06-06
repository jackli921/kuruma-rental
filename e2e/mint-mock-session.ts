// Mock-track session minting for the admin-portal guard E2E (#462).
//
// The admin shell renders no DB data, so its guard only needs a *decodable*
// session cookie carrying a role — not a seeded Neon branch. We mint with the
// same AUTH_SECRET the mock-track web server runs with (playwright.config.ts)
// so both the edge middleware and the Node layout `auth()` can decrypt the JWE.
// `roleRefreshedAt = now` keeps auth.ts's jwt callback inside its 5-minute skip
// window, so the role is read from the token and no live DB is queried.

// On http/localhost Auth.js uses the unprefixed cookie name (no `__Secure-`).
// The `encode` salt MUST equal this name or `auth()` cannot decrypt the cookie
// (same constraint proven by the real-db lane, #416).
export const SESSION_COOKIE_NAME = 'authjs.session-token'

// Throwaway secret, shared with the mock-track web server in
// playwright.config.ts. The mock track never touches real auth or a real DB.
export const E2E_AUTH_SECRET = 'e2e-placeholder-secret-not-real'

/** Mint an Auth.js v5 session-cookie value for a synthetic user of `role`. */
export async function mintMockSessionToken(role: string): Promise<string> {
  // next-auth/jwt is ESM-only; dynamic import so Playwright's CJS transform of
  // this file doesn't ERR_REQUIRE_ESM at load time.
  const { encode } = await import('next-auth/jwt')
  return encode({
    salt: SESSION_COOKIE_NAME,
    secret: E2E_AUTH_SECRET,
    token: {
      sub: `e2e-${role.toLowerCase()}`,
      name: `E2E ${role}`,
      email: `${role.toLowerCase()}@e2e.local`,
      role,
      roleRefreshedAt: Date.now(),
    },
  })
}
