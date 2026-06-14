import type { Context, MiddlewareHandler } from 'hono'
import { getCookie } from 'hono/cookie'

import { SESSION_COOKIE, verifyApiKey, verifyJwt } from '../auth/jwt'
import { type AuthUser, isAuthUser } from '../auth/roles'
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
  ForbiddenError,
  OperatorRequiredError,
  rejectOperatorContextUntilScoped,
  requireFleetWriteScope,
  requireManagementRead,
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
