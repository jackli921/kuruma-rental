import postgres from 'postgres'

// On http/localhost Auth.js uses the unprefixed cookie name (no `__Secure-`).
// The `encode` salt MUST equal this name or the web's `auth()` cannot decrypt
// the session JWE. See issue #416 proven reference.
export const SESSION_COOKIE_NAME = 'authjs.session-token'

// Seed identity, mirrored from @kuruma/shared/db/constants. Duplicated on
// purpose: Playwright require()s this file as CJS, and importing the shared
// workspace package's TS source there breaks. Update both if the seed changes.
const OWNER_EMAIL = 'owner@best-car-rental.local'
const OWNER_NAME = 'Best Car Rental Owner'
const OPERATOR_ID = 'op_best_car_rental'

/** Look up the seeded owner's auto-generated id by its stable seed email. */
async function findOwnerId(databaseUrl: string): Promise<string> {
  const u = new URL(databaseUrl)
  // Build from URL parts so libpq-only params (e.g. channel_binding) don't reach
  // postgres-js; the Neon `-pooler` host accepts TCP with ssl=require.
  const sql = postgres({
    host: u.hostname,
    port: u.port ? Number(u.port) : 5432,
    database: u.pathname.replace(/^\//, ''),
    username: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    ssl: 'require',
    max: 1,
  })
  try {
    const rows = await sql<{ id: string }[]>`
      SELECT id FROM users WHERE email = ${OWNER_EMAIL} LIMIT 1
    `
    const owner = rows[0]
    if (!owner) {
      throw new Error(
        `Owner ${OWNER_EMAIL} not found — run db:seed against the e2e Neon branch first`,
      )
    }
    return owner.id
  } finally {
    await sql.end({ timeout: 5 })
  }
}

/**
 * Mint an Auth.js v5 session-cookie value for the seeded Best Car Rental owner,
 * using the app's own `encode` so the JWE format matches what `auth()` expects.
 * The browser receives only this cookie; the web mints the downstream HS256 API
 * token itself (`lib/api-token.ts`) from the same secret.
 */
export async function mintOperatorSessionToken(): Promise<string> {
  const secret = process.env.AUTH_SECRET
  const databaseUrl = process.env.DATABASE_URL
  if (!secret) throw new Error('AUTH_SECRET is required to mint an e2e session')
  if (!databaseUrl) throw new Error('DATABASE_URL is required to resolve the owner id')

  const sub = await findOwnerId(databaseUrl)

  // next-auth/jwt is ESM-only; dynamic import so Playwright's CJS transform of
  // this file doesn't ERR_REQUIRE_ESM at load time.
  const { encode } = await import('next-auth/jwt')

  // roleRefreshedAt = now keeps the token self-sufficient: the jwt callback's
  // `else if (token.sub)` branch skips its DB role re-fetch for 5 minutes
  // (packages/web/src/auth.ts), so the session needs no live DB to stay valid.
  return encode({
    salt: SESSION_COOKIE_NAME,
    secret,
    token: {
      sub,
      name: OWNER_NAME,
      email: OWNER_EMAIL,
      role: 'OPERATOR_OWNER',
      operatorId: OPERATOR_ID,
      roleRefreshedAt: Date.now(),
    },
  })
}
