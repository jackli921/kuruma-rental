import { testSql } from './pg'

// On http/localhost Auth.js uses the unprefixed cookie name (no `__Secure-`).
// The `encode` salt MUST equal this name or the web's `auth()` cannot decrypt
// the session JWE. See issue #416 proven reference.
export const SESSION_COOKIE_NAME = 'authjs.session-token'

// Seed identities, mirrored from @kuruma/shared seed data. Duplicated on purpose:
// Playwright require()s this file as CJS, and importing the shared workspace
// package's TS source here breaks. Update both if the seed changes.
//
// Best Car Rental owner — db/constants.ts BEST_CAR_RENTAL_OWNER_EMAIL. operatorId
// is NOT hard-coded: the demo seed mints UUID ids (db/seed-id.ts), so we read the
// owner's actual operatorId off the user row below. A stale slug here would scope
// the operator token to the wrong tenant and the portal would show no data.
const OPERATOR = {
  email: 'owner@best-car-rental.local',
  name: 'Best Car Rental Owner',
  role: 'OPERATOR_OWNER',
} as const

// Renter persona — seed-data/bookings.ts DEMO_RENTERS (Sarah Smith, en). A RENTER
// has operatorId = null in the DB, so its token omits the claim: the booking API
// forces renterId = ctx.userId for non-staff, so this owns a self-service booking.
const RENTER = {
  email: 'sarah@example.test',
  name: 'Sarah Smith',
  role: 'RENTER',
} as const

/** Look up a seeded user's id + tenant (operatorId) by its stable seed email. */
async function findUser(email: string): Promise<{ id: string; operatorId: string | null }> {
  const sql = testSql()
  try {
    const rows = await sql<{ id: string; operatorId: string | null }[]>`
      SELECT id, "operatorId" FROM users WHERE email = ${email} LIMIT 1
    `
    const user = rows[0]
    if (!user) {
      throw new Error(`User ${email} not found — run db:seed against the e2e Neon branch first`)
    }
    return user
  } finally {
    await sql.end({ timeout: 5 })
  }
}

interface SessionIdentity {
  email: string
  name: string
  role: string
}

/**
 * Mint an Auth.js v5 session-cookie value for a seeded user, using the app's own
 * `encode` so the JWE format matches what `auth()` expects. The browser receives
 * only this cookie; the web mints the downstream HS256 API token itself
 * (`lib/api-token.ts`) from the same secret. The DB-resolved operatorId becomes
 * the token's tenant claim (omitted for an unscoped RENTER).
 */
async function mintSessionToken(identity: SessionIdentity): Promise<string> {
  const secret = process.env.AUTH_SECRET
  if (!secret) throw new Error('AUTH_SECRET is required to mint an e2e session')

  const user = await findUser(identity.email)

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
      sub: user.id,
      name: identity.name,
      email: identity.email,
      role: identity.role,
      ...(user.operatorId ? { operatorId: user.operatorId } : {}),
      roleRefreshedAt: Date.now(),
    },
  })
}

/** Session cookie value for the seeded Best Car Rental OPERATOR_OWNER. */
export function mintOperatorSessionToken(): Promise<string> {
  return mintSessionToken(OPERATOR)
}

/** Session cookie value for the seeded RENTER persona (Sarah Smith). */
export function mintRenterSessionToken(): Promise<string> {
  return mintSessionToken(RENTER)
}
