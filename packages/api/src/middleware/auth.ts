import { timingSafeEqual } from 'node:crypto'
import type { Context, MiddlewareHandler } from 'hono'
import { jwtVerify } from 'jose'
import { fail } from '../routes/helpers'

export type UserRole = 'RENTER' | 'STAFF' | 'ADMIN' | 'PARTNER'

export interface AuthUser {
  id: string
  role: UserRole
}

export interface AuthEnv {
  Variables: {
    user: AuthUser
  }
}

const ALL_ROLES: ReadonlySet<string> = new Set<string>(['RENTER', 'STAFF', 'ADMIN', 'PARTNER'])

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
}

export function toCallerContext(user: AuthUser): CallerContext {
  return { userId: user.id, role: user.role }
}

/** System-level context for internal queries that need full access (stats, fleet overview, availability). */
export const SYSTEM_CONTEXT: CallerContext = { userId: 'system', role: 'ADMIN' } as const

/** Roles that can manage bookings across all users */
export const PRIVILEGED_ROLES: ReadonlySet<UserRole> = new Set(['STAFF', 'ADMIN', 'PARTNER'])

/**
 * Roles that can manage vehicles. PARTNER is deliberately excluded —
 * 3rd-party API callers (Trip.com) manage bookings, not fleet inventory.
 */
export const STAFF_ROLES: ReadonlySet<UserRole> = new Set(['STAFF', 'ADMIN'])

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
 * Repo-layer guard for mutation methods. Throws `ForbiddenError` if the
 * caller is not a STAFF role. Defence in depth against a route forgetting
 * its `STAFF_ROLES` gate (issue #329). `SYSTEM_CONTEXT` (role: ADMIN) passes.
 */
export function requireStaffContext(ctx: CallerContext): void {
  if (!STAFF_ROLES.has(ctx.role)) {
    throw new ForbiddenError('STAFF role required')
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

async function verifyJwt(token: string): Promise<AuthUser | null> {
  const secret = process.env.AUTH_SECRET
  if (!secret) return null

  try {
    const key = new TextEncoder().encode(secret)
    const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'] })

    const id = payload.sub
    if (!id) return null

    const rawRole = typeof payload.role === 'string' ? payload.role : undefined
    const role: UserRole = rawRole && isValidRole(rawRole) ? rawRole : 'RENTER'
    return { id, role }
  } catch {
    return null
  }
}

function verifyApiKey(key: string): AuthUser | null {
  const expected = process.env.PARTNER_API_KEY
  if (!expected) return null

  const a = Buffer.from(key)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  return { id: 'partner:api-key', role: 'PARTNER' }
}
