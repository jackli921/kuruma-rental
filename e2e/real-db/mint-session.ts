import { ADMIN_SEED_EMAIL, OPERATOR_SEED_EMAIL, RENTER_SEED_EMAIL } from './constants'
import { testSql } from './pg'

// The Vite/CF-Pages stack (#378) authenticates the browser with the API's own
// `kuruma_session` HS256 JWT — NOT an Auth.js JWE (the retired Next.js path). We
// mint it here with the SAME contract as packages/api/src/middleware/auth.ts
// `mintSessionToken` (iss/aud/alg/exp + a `csrf` claim) — keep the two in sync.
// GET /auth/session echoes the `csrf` claim as `csrfToken`; the wizard's
// Reserve-now POST sends it back through the API's CSRF middleware, so a session
// minted without it would pass auth but fail every mutation.
//
// Why inline `jose` instead of importing the API helper: Playwright runs these
// specs under Node with its own loader, which transpiles files in the test dir
// but NOT an arbitrary `packages/api/**.ts` reached via dynamic import. `jose` is
// a published package, so importing IT is safe (mirrors the prior next-auth/jwt use).
export const SESSION_COOKIE_NAME = 'kuruma_session'

// Mirror of packages/api/src/middleware/auth.ts (API_TOKEN_ISSUER/AUDIENCE, TTL).
const API_TOKEN_ISSUER = 'kuruma-web'
const API_TOKEN_AUDIENCE = 'kuruma-api'
const SESSION_TTL = '7d'

// Best Car Rental owner — db/constants.ts BEST_CAR_RENTAL_OWNER_EMAIL. operatorId
// is NOT hard-coded: the demo seed mints UUID ids (db/seed-id.ts), so we read the
// owner's actual operatorId off the user row below. A stale slug here would scope
// the operator token to the wrong tenant and the portal would show no data.
const OPERATOR = {
  email: OPERATOR_SEED_EMAIL,
  name: 'Best Car Rental Owner',
  role: 'OPERATOR_OWNER',
} as const

// Renter persona — seed-data/bookings.ts DEMO_RENTERS (Sarah Smith, en). A RENTER
// has operatorId = null in the DB, so its token omits the claim: the booking API
// forces renterId = ctx.userId for non-staff, so this owns a self-service booking.
const RENTER = {
  email: RENTER_SEED_EMAIL,
  name: 'Sarah Smith',
  role: 'RENTER',
} as const

// Platform-admin persona (#462 revenue tab). Email mirrors PLATFORM_ADMIN_EMAILS
// fed to the seed (ADMIN_SEED_EMAIL), which upserts it as role PLATFORM_ADMIN
// with operatorId = null — so its token omits the tenant claim, matching a real
// admin who belongs to no operator (proposal §6.2).
const ADMIN = {
  email: ADMIN_SEED_EMAIL,
  name: 'Platform Admin',
  role: 'PLATFORM_ADMIN',
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
  role: 'RENTER' | 'OPERATOR_OWNER' | 'PLATFORM_ADMIN'
}

/**
 * Mint a `kuruma_session` JWT for a seeded user, signed with AUTH_SECRET — the
 * same secret the API verifies with (middleware/auth.ts verifyAndMap). The
 * DB-resolved operatorId becomes the tenant claim (omitted for an unscoped RENTER).
 */
async function mintSession(identity: SessionIdentity): Promise<string> {
  const secret = process.env.AUTH_SECRET
  if (!secret) throw new Error('AUTH_SECRET is required to mint an e2e session')

  const user = await findUser(identity.email)

  // jose is ESM-only; dynamic import so Playwright's CJS transform of this file
  // doesn't ERR_REQUIRE_ESM at load time.
  const { SignJWT } = await import('jose')
  const key = new TextEncoder().encode(secret)

  const payload: Record<string, unknown> = {
    role: identity.role,
    csrf: crypto.randomUUID(),
    name: identity.name,
    email: identity.email,
  }
  if (user.operatorId) payload.operatorId = user.operatorId

  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setIssuer(API_TOKEN_ISSUER)
    .setAudience(API_TOKEN_AUDIENCE)
    .setExpirationTime(SESSION_TTL)
    .sign(key)
}

/** Session cookie value for the seeded Best Car Rental OPERATOR_OWNER. */
export function mintOperatorSessionToken(): Promise<string> {
  return mintSession(OPERATOR)
}

/**
 * Session cookie value for an ARBITRARY OPERATOR_OWNER email — used by the
 * cold-start spec, which inserts a throwaway empty operator + owner at runtime
 * (not in the seed) and needs to swap the project storageState onto it. The
 * tenant claim is resolved from that owner's freshly-inserted `users` row, so
 * the token is scoped to the new operator exactly like a seeded one.
 */
export function mintOperatorSessionTokenFor(
  email: string,
  name = 'Cold Start Owner',
): Promise<string> {
  return mintSession({ email, name, role: 'OPERATOR_OWNER' })
}

/** Session cookie value for the seeded RENTER persona (Sarah Smith). */
export function mintRenterSessionToken(): Promise<string> {
  return mintSession(RENTER)
}

/**
 * Session cookie value for an ARBITRARY RENTER email — used by the sign-in-first
 * onboarding spec, which inserts a throwaway RENTER applicant at runtime (not in
 * the seed) and needs a stale RENTER token for it. Mirrors mintOperatorSessionTokenFor
 * but with role RENTER: findUser resolves the id off the freshly-inserted `users`
 * row (operatorId null for a renter, so the token omits the tenant claim), so the
 * SAME token string can later be re-presented AFTER server-side promotion to prove
 * the stale session reconciles. Insert the applicant row BEFORE calling this.
 */
export function mintRenterSessionTokenFor(email: string, name = 'E2E Applicant'): Promise<string> {
  return mintSession({ email, name, role: 'RENTER' })
}

/** Session cookie value for the seeded PLATFORM_ADMIN persona (#462 revenue tab). */
export function mintAdminSessionToken(): Promise<string> {
  return mintSession(ADMIN)
}
