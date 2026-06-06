import { timingSafeEqual } from 'node:crypto'
import type { Context, MiddlewareHandler } from 'hono'
import { getCookie } from 'hono/cookie'
import { SignJWT, jwtVerify } from 'jose'
import { fail } from '../routes/helpers'

// PARTNER is API-key-only (3rd-party callers) — not a DB role. OPERATOR_* and
// PLATFORM_ADMIN are the marketplace roles (epic #385); they exist in the DB
// roleEnum. See packages/shared/src/db/schema.ts.
export type UserRole =
  | 'RENTER'
  | 'STAFF'
  | 'ADMIN'
  | 'PARTNER'
  | 'OPERATOR_OWNER'
  | 'OPERATOR_STAFF'
  | 'PLATFORM_ADMIN'

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

const ALL_ROLES: ReadonlySet<string> = new Set<string>([
  'RENTER',
  'STAFF',
  'ADMIN',
  'PARTNER',
  'OPERATOR_OWNER',
  'OPERATOR_STAFF',
  'PLATFORM_ADMIN',
])

/** Tenant-scoped roles. They NEVER bypass operator scope (proposal §6.2). */
const OPERATOR_ROLES: ReadonlySet<UserRole> = new Set(['OPERATOR_OWNER', 'OPERATOR_STAFF'])

/** True for tenant-scoped roles (OPERATOR_OWNER / OPERATOR_STAFF). */
export function isOperatorRole(role: UserRole): boolean {
  return OPERATOR_ROLES.has(role)
}

/**
 * Roles that see across all operators. PLATFORM_ADMIN is the sanctioned bypass;
 * legacy STAFF / ADMIN / PARTNER are treated as temporary platform-admin
 * equivalents during the marketplace transition (proposal §6.2). OPERATOR_*
 * are deliberately excluded — they are always tenant-scoped.
 */
const SCOPE_BYPASS_ROLES: ReadonlySet<UserRole> = new Set([
  'STAFF',
  'ADMIN',
  'PARTNER',
  'PLATFORM_ADMIN',
])

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
 * DEPRECATED — legacy global-bypass roles. Treated as temporary platform-admin
 * equivalents during the marketplace transition (proposal §6.2). Do NOT add new
 * users to these roles, and OPERATOR_OWNER / OPERATOR_STAFF must NEVER inherit
 * this bypass — use `requireOperatorScope` / `rejectOperatorContextUntilScoped`.
 */
export const PRIVILEGED_ROLES: ReadonlySet<UserRole> = new Set([
  'STAFF',
  'ADMIN',
  'PARTNER',
  // PLATFORM_ADMIN is the most-privileged role and SYSTEM_CONTEXT's role; it
  // must pass every gate ADMIN passed (stats / fleet-overview / availability
  // read SYSTEM_CONTEXT). OPERATOR_* are NOT here — they are tenant-scoped.
  'PLATFORM_ADMIN',
])

/**
 * Roles that can manage vehicles. PARTNER is deliberately excluded —
 * 3rd-party API callers (Trip.com) manage bookings, not fleet inventory.
 * PLATFORM_ADMIN included as the platform super-admin (and SYSTEM_CONTEXT role).
 */
export const STAFF_ROLES: ReadonlySet<UserRole> = new Set(['STAFF', 'ADMIN', 'PLATFORM_ADMIN'])

/**
 * Roles permitted to mutate fleet inventory: STAFF roles PLUS tenant-scoped
 * operators (OPERATOR_OWNER / OPERATOR_STAFF). Operators are further bounded to
 * their own tenant by the repository's operator predicate — the repo, not the
 * route, is the tenant boundary (#386 F2 / #397).
 */
export const FLEET_WRITE_ROLES: ReadonlySet<UserRole> = new Set<UserRole>([
  ...STAFF_ROLES,
  ...OPERATOR_ROLES,
])

/**
 * Roles permitted to READ operator-private config (insurance options, fee
 * schedules). STAFF roles (incl. PLATFORM_ADMIN) PLUS tenant-scoped operators.
 * Deliberately EXCLUDES RENTER and PARTNER: unlike the public vehicle catalog,
 * insurance/fees are operator-private, so they must never reach a renter or a
 * 3rd-party API caller (slice-4 plan §2 [P0]).
 */
export const MANAGEMENT_READ_ROLES: ReadonlySet<UserRole> = new Set<UserRole>([
  ...STAFF_ROLES,
  ...OPERATOR_ROLES,
])

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

/** A verified session: the caller identity plus the CSRF token bound to it.
 *  `csrf` is absent for Bearer API tokens (they carry no csrf claim and are
 *  CSRF-immune anyway — see middleware/csrf.ts). */
export interface VerifiedSession {
  readonly user: AuthUser
  readonly csrf?: string
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
    const csrf = typeof payload.csrf === 'string' ? payload.csrf : undefined
    // exactOptionalPropertyTypes: omit optional keys entirely rather than set undefined.
    const user: AuthUser = operatorId !== undefined ? { id, role, operatorId } : { id, role }
    return csrf !== undefined ? { user, csrf } : { user }
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
 * iss/aud) can't drift. Reused by every OAuth provider (Google now, Apple next).
 */
export async function mintSessionToken(
  claims: { sub: string; role: UserRole; operatorId?: string; csrf: string },
  secret: string,
): Promise<string> {
  const key = new TextEncoder().encode(secret)
  const payload: Record<string, unknown> = { role: claims.role, csrf: claims.csrf }
  if (claims.operatorId !== undefined) payload.operatorId = claims.operatorId
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
