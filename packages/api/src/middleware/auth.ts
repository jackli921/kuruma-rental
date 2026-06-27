import type { Context, MiddlewareHandler } from 'hono'
import { getCookie } from 'hono/cookie'

import { toCallerContext } from '../auth/context'
import { requirePlatformRead } from '../auth/guards'
import { SESSION_COOKIE, verifyApiKey, verifyJwt } from '../auth/jwt'
import { type AuthUser, isAuthUser, isOperatorRole } from '../auth/roles'
import { fail } from '../routes/helpers'

// The auth concerns are split across cohesive auth/ modules (#724); this file is
// the thin Hono `requireAuth` middleware plus the context accessors, and a barrel
// that re-exports the prior public surface so the ~190 existing `middleware/auth`
// import sites compile unchanged:
//   auth/roles.ts    — UserRole, AuthUser, role-set aliases, isOperatorRole
//   auth/context.ts  — CallerContext + SYSTEM/PUBLIC contexts
//   auth/guards.ts   — Forbidden/OperatorRequiredError + require* guards
//   auth/jwt.ts      — session-token constants/types + verify/mint crypto
export type { AuthUser, UserRole } from '../auth/roles'
export {
  FLEET_WRITE_ROLES,
  isOperatorRole,
  MANAGEMENT_READ_ROLES,
  PRIVILEGED_ROLES,
  STAFF_ROLES,
} from '../auth/roles'
export {
  type CallerContext,
  PUBLIC_CONTEXT,
  SYSTEM_CONTEXT,
  toCallerContext,
} from '../auth/context'
export {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  OperatorRequiredError,
  ScopeRequiredError,
  requireFleetWriteScope,
  requireManagementRead,
  requireOperatorOwnerWrite,
  requireOperatorScope,
  requirePlatformAdmin,
  requirePlatformRead,
} from '../auth/guards'
export {
  API_TOKEN_AUDIENCE,
  API_TOKEN_ISSUER,
  mintSessionToken,
  SESSION_COOKIE,
  type SessionProfile,
  verifySessionCookie,
  type VerifiedSession,
} from '../auth/jwt'

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

// #939: a verified signature is necessary but not sufficient for operator roles.
// verifyJwt is pure crypto, so a deactivated member keeps valid operator claims
// for the whole <=7d token TTL. The composition root supplies this per-request
// check (closing over the users projection the JWT is minted from); requireAuth
// rejects the token when it returns true so the caller must re-auth.
const OPERATOR_REVOCATION_CHECK = 'operatorSessionRevocationCheck'

/** Returns true when an operator caller's session has been revoked since the JWT
 *  was minted (member deactivated, moved tenant, or role changed). */
export type OperatorSessionRevocationCheck = (user: AuthUser) => Promise<boolean>

/** Registers the operator-session revocation check on the request context so the
 *  per-prefix AND factory-internal requireAuth instances all consult one source
 *  (#939). Register app-wide in createApp before any requireAuth runs. */
export function provideOperatorSessionRevocation(
  check: OperatorSessionRevocationCheck,
): MiddlewareHandler {
  return async (c: Context, next) => {
    c.set(OPERATOR_REVOCATION_CHECK, check)
    return next()
  }
}

/** Consult the context-supplied revocation check, but only for operator roles —
 *  renter/admin/partner traffic does zero extra work (the common-case latency AC).
 *  Fail-open when no check is registered (e.g. unit apps that don't wire it).
 *  Exported so GET /auth/session reuses the SAME check (#957): the session read
 *  and the data routes must agree on revocation — one check, never two that drift. */
export async function isOperatorSessionRevoked(
  c: { get: (key: string) => unknown },
  user: AuthUser,
): Promise<boolean> {
  if (!isOperatorRole(user.role)) return false
  const check = c.get(OPERATOR_REVOCATION_CHECK)
  return typeof check === 'function' ? Boolean(await check(user)) : false
}

async function resolveCaller(c: Context): Promise<AuthUser | null> {
  const authHeader = c.req.header('Authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const user = await verifyJwt(authHeader.slice(7))
    if (user) return user
  }
  // Browser callers authenticate with the HttpOnly kuruma_session cookie
  // (Vite/CF Pages migration, #378). CSRF for these is enforced separately by
  // the csrf middleware; here we only establish identity.
  const cookieToken = getCookie(c, SESSION_COOKIE)
  if (cookieToken) {
    const user = await verifyJwt(cookieToken)
    if (user) return user
  }
  const apiKey = c.req.header('X-API-Key')
  if (apiKey) {
    const user = verifyApiKey(apiKey)
    if (user) return user
  }
  return null
}

export function requireAuth(): MiddlewareHandler {
  return async (c: Context, next) => {
    // Skip if an upstream middleware already authenticated (e.g. createApp's
    // app-level requireAuth or testAuthMiddleware). Prevents double-verify
    // when public + protected routes are mounted in the same Hono instance.
    if (getUser(c)) return next()

    const user = await resolveCaller(c)
    if (!user) return fail(c, 'Unauthorized', 401)
    if (await isOperatorSessionRevoked(c, user)) return fail(c, 'Unauthorized', 401)

    c.set('user', user)
    return next()
  }
}

/** Structural role gate for the whole `/admin/*` namespace (#1164). Mount it right
 *  after `app.use('/admin/*', requireAuth())` so the user is already set; it rejects
 *  any caller below the platform tier with 403 BEFORE the handler runs. This makes
 *  the role gate structural rather than per-handler, so a future sibling admin route
 *  that forgets its in-body `requirePlatform*` call is still authz-protected. The
 *  per-handler gates stay as defense-in-depth (and carry the stricter write-only
 *  `requirePlatformAdmin` distinction). Uses the platform-tier floor `requirePlatformRead`
 *  so a read route never breaks if `PLATFORM_ROLES` ever widens past PLATFORM_ADMIN. */
export function requirePlatformMember(): MiddlewareHandler {
  return async (c: Context, next) => {
    requirePlatformRead(toCallerContext(requireUser(c)))
    return next()
  }
}
