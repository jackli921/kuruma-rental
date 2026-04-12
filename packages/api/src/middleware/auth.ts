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

/** Roles that can manage bookings across all users */
export const PRIVILEGED_ROLES: ReadonlySet<UserRole> = new Set(['STAFF', 'ADMIN', 'PARTNER'])

/** Roles that can manage vehicles */
export const STAFF_ROLES: ReadonlySet<UserRole> = new Set(['STAFF', 'ADMIN'])

export function getUser(c: { get: (key: string) => unknown }): AuthUser | undefined {
  return c.get('user') as AuthUser | undefined
}

export function requireUser(c: { get: (key: string) => unknown }): AuthUser | null {
  const user = getUser(c)
  return user?.id ? user : null
}

export function requireAuth(): MiddlewareHandler {
  return async (c: Context, next) => {
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
    const { payload } = await jwtVerify(token, key)

    const id = payload.sub
    if (!id) return null

    const VALID_ROLES = new Set<UserRole>(['RENTER', 'STAFF', 'ADMIN', 'PARTNER'])
    const rawRole = payload.role as string | undefined
    const role: UserRole =
      rawRole && VALID_ROLES.has(rawRole as UserRole) ? (rawRole as UserRole) : 'RENTER'
    return { id, role }
  } catch {
    return null
  }
}

function verifyApiKey(key: string): AuthUser | null {
  const expected = process.env.PARTNER_API_KEY
  if (!expected || key.length !== expected.length) return null

  // Constant-time comparison
  let mismatch = 0
  for (let i = 0; i < key.length; i++) {
    mismatch |= key.charCodeAt(i) ^ expected.charCodeAt(i)
  }

  if (mismatch !== 0) return null
  return { id: 'partner:api-key', role: 'PARTNER' as const }
}
