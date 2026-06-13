import { timingSafeEqual } from 'node:crypto'
import {
  ALL_ROLES,
  BUSINESS_ROLES,
  OPERATOR_ROLES,
  PLATFORM_ROLES,
  SCOPE_BYPASS_ROLES,
  type UserRole,
} from '@kuruma/shared/auth/roles'
import type { Context, MiddlewareHandler } from 'hono'
import { getCookie } from 'hono/cookie'
import { SignJWT, jwtVerify } from 'jose'
import { fail } from '../routes/helpers'

// Role identifiers + membership sets are single-sourced in @kuruma/shared/auth/
// roles (edge-safe, zero-import) so the API and the web edge middleware can't
// drift (#387). Re-exported here so the existing API import surface is unchanged.
// PARTNER is API-key-only (3rd-party callers), not a DB role; OPERATOR_* and
// PLATFORM_ADMIN are the marketplace roles (epic #385) and exist in the DB enum.
export type { UserRole }
export { PRIVILEGED_ROLES } from '@kuruma/shared/auth/roles'

export interface AuthUser {
  id: string
  role: UserRole
  // Tenant the caller belongs to. Present for OPERATOR_* roles; absent for
  // renters, platform admins, and legacy privileged roles.
  operatorId?: string
}

// The web package mints API tokens with these claims (packages/web/src/lib/
// api-token.ts). verifyJwt asserts both so a token minted with the shared
// AUTH_SECRET for any other purpose cannot be replayed as an API caller.
export const API_TOKEN_ISSUER = 'kuruma-web'
export const API_TOKEN_AUDIENCE = 'kuruma-api'

// Cookie that carries the browser session JWT (Vite/CF Pages migration, #378).
// Set by the API at OAuth sign-in; read by requireAuth's cookie path, the CSRF
// middleware, and GET /auth/session. See design spec §5.3.
export const SESSION_COOKIE = 'kuruma_session'

/** True for tenant-scoped roles (OPERATOR_OWNER / OPERATOR_STAFF). */
export function isOperatorRole(role: UserRole): boolean {
  return OPERATOR_ROLES.has(role)
}

function isValidRole(value: string): value is UserRole {
  return ALL_ROLES.has(value)
}

function isAuthUser(v: unknown): v is AuthUser {
  return (
    typeof v === 'object' &&
    v !== null &&
    'id' in v &&
    typeof (v as AuthUser).id === 'string' &&
    'role' in v &&
    isValidRole((v as AuthUser).role)
  )
}

/** Caller identity extracted from JWT — required by every scoped repository method. */
export interface CallerContext {
  readonly userId: string
  readonly role: UserRole
  /** Tenant the caller is scoped to. Set for OPERATOR_* roles. */
  readonly operatorId?: string
  /** True only for PLATFORM_ADMIN + legacy privileged roles. OPERATOR_* never bypass. */
  readonly bypassScope?: boolean
}

export function toCallerContext(user: AuthUser): CallerContext {
  const bypassScope = SCOPE_BYPASS_ROLES.has(user.role)
  // Only attach operatorId for tenant-scoped roles, and only when present
  // (exactOptionalPropertyTypes forbids an explicit `operatorId: undefined`).
  if (OPERATOR_ROLES.has(user.role) && user.operatorId !== undefined) {
    return { userId: user.id, role: user.role, operatorId: user.operatorId, bypassScope }
  }
  return { userId: user.id, role: user.role, bypassScope }
}

/** System-level context for internal queries that need full access (stats, fleet overview, availability). */
export const SYSTEM_CONTEXT: CallerContext = {
  userId: 'system',
  role: 'PLATFORM_ADMIN',
  bypassScope: true,
} as const

/**
 * Context for anonymous, public catalog reads (renter storefront). Renters
 * browse the cross-operator marketplace, so this resolves to an `all` operator
 * scope (operatorReadScope) — NOT a privilege bypass. Use it on unauthenticated
 * routes so scoped repos still receive a caller context (#395).
 */
export const PUBLIC_CONTEXT: CallerContext = {
  userId: 'public',
  role: 'RENTER',
  bypassScope: false,
} as const

/**
 * Consumer-facing aliases of the single-sourced sets in @kuruma/shared/auth/roles.
 * The names are kept so the ~25 existing route/repo gates import unchanged, but
 * the platform tier (STAFF_ROLES → PLATFORM_ROLES) is now a SEPARATE set from the
 * business tier (FLEET_WRITE/MANAGEMENT_READ → BUSINESS_ROLES). That split lets
 * #487 tighten platform-admin access (PLATFORM_ROLES → {PLATFORM_ADMIN}) without
 * touching business management. Members are identical to before — behavior-preserving.
 *
 * STAFF_ROLES: platform-staff tier (no operators) — STAFF / ADMIN / PLATFORM_ADMIN.
 * FLEET_WRITE_ROLES / MANAGEMENT_READ_ROLES: the platform base PLUS tenant
 * operators; each admitted operator is still bounded to its own tenant by the
 * repository's operator predicate (#386 F2 / #397), and RENTER / PARTNER are
 * excluded so operator-private config (insurance/fees) never leaks (slice-4 [P0]).
 * These INTENTIONALLY alias BUSINESS_ROLES, not PLATFORM_ROLES: #487 narrows the
 * platform tier only, so do NOT "harmonize" these onto PLATFORM_ROLES — that
 * would silently strip tenant operators from fleet management.
 */
export const STAFF_ROLES = PLATFORM_ROLES
export const FLEET_WRITE_ROLES = BUSINESS_ROLES
export const MANAGEMENT_READ_ROLES = BUSINESS_ROLES

/**
 * Repo-layer read guard for operator-private config. Must be called BEFORE
 * `operatorReadScope(ctx)`, because that helper maps every non-operator role —
 * including RENTER — to `{kind:'all'}` (the vehicle catalog is public). Without
 * this seal a renter or PARTNER could read every operator's insurance/fees
 * config. Throws `ForbiddenError` (-> 403) for RENTER / PARTNER (slice-4 [P0]).
 */
export function requireManagementRead(ctx: CallerContext): void {
  if (!MANAGEMENT_READ_ROLES.has(ctx.role)) {
    throw new ForbiddenError('management read scope required')
  }
}

/**
 * Gate for PLATFORM-level reads that span every operator — the #462 admin
 * revenue tab. Admits only the platform tier (`PLATFORM_ROLES` = STAFF / ADMIN /
 * PLATFORM_ADMIN today), the exact set the web `_admin` portal admits. References
 * PLATFORM_ROLES directly (not the STAFF_ROLES alias) so #487's tightening of
 * PLATFORM_ROLES → {PLATFORM_ADMIN} narrows this gate automatically. Deliberately
 * EXCLUDES OPERATOR_* (a tenant must never see another partner's revenue) and
 * RENTER / PARTNER. Narrower than `bypassScope`, which also covers PARTNER
 * (Trip.com) — a 3rd-party caller must not read revenue.
 */
export function requirePlatformRead(ctx: CallerContext): void {
  if (!PLATFORM_ROLES.has(ctx.role)) {
    throw new ForbiddenError('platform admin scope required')
  }
}

/**
 * Thrown by repo-layer guards when a non-authorised caller hits a
 * protected method. The global error handler maps this to a 403 response
 * so a bypassed route-level gate surfaces as a policy denial, not a 500.
 */
export class ForbiddenError extends Error {
  readonly name = 'ForbiddenError'
  constructor(message = 'Forbidden') {
    super(message)
  }
}

/**
 * Thrown when a non-operator caller (PLATFORM_ADMIN / legacy STAFF / ADMIN) tries
 * to create tenant-owned inventory without naming a target operator, and the
 * target cannot be inferred (zero or 2+ operators exist). Replaces the old
 * silent Best-Car-Rental default (#401) so a legacy admin write can no longer be
 * misattributed once a second operator exists. Mapped to 422 by the global
 * handler — the request is well-formed but missing a required `operatorId`.
 */
export class OperatorRequiredError extends Error {
  readonly name = 'OperatorRequiredError'
  constructor(message = 'operatorId is required') {
    super(message)
  }
}

/**
 * Repo-layer guard for fleet mutation methods. Admits STAFF roles and
 * tenant-scoped operators (`FLEET_WRITE_ROLES`); a tenant-scoped caller missing
 * its operatorId fails closed via `requireOperatorScope`. Defence in depth
 * against a route forgetting its gate (issue #329). The caller's tenant is
 * enforced by the repository's operator predicate, so an admitted operator can
 * only mutate its own vehicles. `SYSTEM_CONTEXT` (PLATFORM_ADMIN) passes.
 */
export function requireFleetWriteScope(ctx: CallerContext): void {
  if (!FLEET_WRITE_ROLES.has(ctx.role)) {
    throw new ForbiddenError('fleet write scope required')
  }
  requireOperatorScope(ctx)
}

/**
 * Repo-layer guard for operator-scoped paths. Throws `ForbiddenError` if a
 * tenant-scoped caller (OPERATOR_*) reached a scoped method without an
 * operatorId — a fail-closed defence against a token that lost its tenant claim.
 */
export function requireOperatorScope(ctx: CallerContext): void {
  if (OPERATOR_ROLES.has(ctx.role) && !ctx.operatorId) {
    throw new ForbiddenError('operator scope required')
  }
}

/**
 * Fail-closed guard for repos NOT yet operator-scoped in this slice. An
 * OPERATOR_* caller hitting such a repo is rejected with a specific message
 * rather than silently falling through to a global-bypass path (plan v2 P1a).
 * Legacy STAFF/ADMIN, PARTNER, PLATFORM_ADMIN, and RENTER paths are unaffected.
 */
export function rejectOperatorContextUntilScoped(ctx: CallerContext, repoName: string): void {
  if (OPERATOR_ROLES.has(ctx.role)) {
    throw new ForbiddenError(`${repoName} not yet operator-scoped`)
  }
}

/**
 * Guard for platform-admin-only paths (operator bootstrap, proposal §9 item 23).
 * Only PLATFORM_ADMIN passes — legacy STAFF/ADMIN do NOT, since operator
 * creation is a platform-governance action, not a fleet-management one.
 * `SYSTEM_CONTEXT` (role PLATFORM_ADMIN) passes.
 */
export function requirePlatformAdmin(ctx: CallerContext): void {
  if (ctx.role !== 'PLATFORM_ADMIN') {
    throw new ForbiddenError('PLATFORM_ADMIN role required')
  }
}

export function getUser(c: { get: (key: string) => unknown }): AuthUser | undefined {
  const raw = c.get('user')
  return isAuthUser(raw) ? raw : undefined
}

/** Fail-closed: throws if no authenticated user in context. */
export function requireUser(c: { get: (key: string) => unknown }): AuthUser {
  const user = getUser(c)
  if (!user) throw new Error('requireUser: no authenticated user in context')
  return user
}

export function requireAuth(): MiddlewareHandler {
  return async (c: Context, next) => {
    // Skip if an upstream middleware already authenticated (e.g. createApp's
    // app-level requireAuth or testAuthMiddleware). Prevents double-verify
    // when public + protected routes are mounted in the same Hono instance.
    if (getUser(c)) return next()

    const authHeader = c.req.header('Authorization')

    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7)
      const user = await verifyJwt(token)
      if (user) {
        c.set('user', user)
        return next()
      }
    }

    // Browser callers authenticate with the HttpOnly kuruma_session cookie
    // (Vite/CF Pages migration, #378). CSRF for these is enforced separately by
    // the csrf middleware; here we only establish identity.
    const cookieToken = getCookie(c, SESSION_COOKIE)
    if (cookieToken) {
      const user = await verifyJwt(cookieToken)
      if (user) {
        c.set('user', user)
        return next()
      }
    }

    const apiKey = c.req.header('X-API-Key')
    if (apiKey) {
      const user = verifyApiKey(apiKey)
      if (user) {
        c.set('user', user)
        return next()
      }
    }

    return fail(c, 'Unauthorized', 401)
  }
}

/** Display-only profile a session token may carry (navbar avatar/name/email).
 *  Deliberately separate from AuthUser: these fields NEVER participate in
 *  authorization, so they can't widen any access check. Mirrors the name/email/
 *  image NextAuth carried in its session JWT before the #378 migration. */
export interface SessionProfile {
  readonly name?: string
  readonly email?: string
  readonly image?: string
}

/** A verified session: the caller identity plus the CSRF token bound to it.
 *  `csrf` is absent for Bearer API tokens (they carry no csrf claim and are
 *  CSRF-immune anyway — see middleware/csrf.ts). `profile` is absent on Bearer
 *  tokens and on legacy session cookies minted before profile claims existed. */
export interface VerifiedSession {
  readonly user: AuthUser
  readonly csrf?: string
  readonly profile?: SessionProfile
  // Operator slug for the granted tenant (#521 §8). Lets the web /manage/$slug
  // guard match the URL segment. Session metadata, NOT an authz field — authz is
  // role + operatorId (on `user`), so this never widens an access check. Present
  // only when operatorId is, derived server-side from the stored operators.slug.
  readonly operatorSlug?: string
}

/** Read the optional display profile from a token payload. Returns undefined
 *  when no profile claim is present (so the caller omits the key entirely under
 *  exactOptionalPropertyTypes), never a partially-empty object. */
function readProfile(payload: Record<string, unknown>): SessionProfile | undefined {
  const name = typeof payload.name === 'string' ? payload.name : undefined
  const email = typeof payload.email === 'string' ? payload.email : undefined
  const image = typeof payload.image === 'string' ? payload.image : undefined
  if (name === undefined && email === undefined && image === undefined) return undefined
  return {
    ...(name !== undefined ? { name } : {}),
    ...(email !== undefined ? { email } : {}),
    ...(image !== undefined ? { image } : {}),
  }
}

/** Verify an HS256 token (Bearer API token or session cookie) and map its
 *  payload to a caller + CSRF token. Single verification path so the cookie and
 *  Bearer flows can never diverge on what a valid token means. */
async function verifyAndMap(token: string): Promise<VerifiedSession | null> {
  const secret = process.env.AUTH_SECRET
  if (!secret) return null

  try {
    const key = new TextEncoder().encode(secret)
    const { payload } = await jwtVerify(token, key, {
      algorithms: ['HS256'],
      issuer: API_TOKEN_ISSUER,
      audience: API_TOKEN_AUDIENCE,
    })

    const id = payload.sub
    if (!id) return null

    const rawRole = typeof payload.role === 'string' ? payload.role : undefined
    const role: UserRole = rawRole && isValidRole(rawRole) ? rawRole : 'RENTER'
    const operatorId = typeof payload.operatorId === 'string' ? payload.operatorId : undefined
    const operatorSlug = typeof payload.operatorSlug === 'string' ? payload.operatorSlug : undefined
    const csrf = typeof payload.csrf === 'string' ? payload.csrf : undefined
    // exactOptionalPropertyTypes: omit optional keys entirely rather than set undefined.
    const user: AuthUser = operatorId !== undefined ? { id, role, operatorId } : { id, role }
    const profile = readProfile(payload)
    return {
      user,
      ...(csrf !== undefined ? { csrf } : {}),
      ...(profile !== undefined ? { profile } : {}),
      ...(operatorSlug !== undefined ? { operatorSlug } : {}),
    }
  } catch {
    return null
  }
}

async function verifyJwt(token: string): Promise<AuthUser | null> {
  const session = await verifyAndMap(token)
  return session ? session.user : null
}

/** Verify a `kuruma_session` cookie JWT → caller + CSRF token, or null if
 *  invalid/expired/tampered. Used by GET /auth/session and the CSRF middleware. */
export async function verifySessionCookie(token: string): Promise<VerifiedSession | null> {
  return verifyAndMap(token)
}

// 7-day session, matching Auth.js today and the cookie maxAge (design spec §5.3).
const SESSION_TTL = '7d'

/**
 * Mint a `kuruma_session` JWT for a signed-in user. Kept beside
 * `verifySessionCookie` so the two halves of the session contract (and its
 * iss/aud) can't drift. Shared by the Google sign-in flow (the only provider).
 */
export async function mintSessionToken(
  claims: {
    sub: string
    role: UserRole
    operatorId?: string
    operatorSlug?: string
    csrf: string
    name?: string
    email?: string
    image?: string
  },
  secret: string,
): Promise<string> {
  const key = new TextEncoder().encode(secret)
  const payload: Record<string, unknown> = { role: claims.role, csrf: claims.csrf }
  if (claims.operatorId !== undefined) payload.operatorId = claims.operatorId
  if (claims.operatorSlug !== undefined) payload.operatorSlug = claims.operatorSlug
  if (claims.name !== undefined) payload.name = claims.name
  if (claims.email !== undefined) payload.email = claims.email
  if (claims.image !== undefined) payload.image = claims.image
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setIssuer(API_TOKEN_ISSUER)
    .setAudience(API_TOKEN_AUDIENCE)
    .setExpirationTime(SESSION_TTL)
    .sign(key)
}

function verifyApiKey(key: string): AuthUser | null {
  const expected = process.env.PARTNER_API_KEY
  if (!expected) return null

  const a = Buffer.from(key)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  return { id: 'partner:api-key', role: 'PARTNER' }
}
