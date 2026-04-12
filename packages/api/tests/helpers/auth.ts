import type { MiddlewareHandler } from 'hono'
import { SignJWT } from 'jose'
import type { UserRole } from '../../src/middleware/auth'

export const TEST_AUTH_SECRET = 'test-auth-secret-at-least-32-chars-long'

/** Middleware that sets a fake authenticated user for unit tests that
 *  mount route handlers directly (without the full createApp() + JWT flow). */
export function testAuthMiddleware(id = 'test-user', role: UserRole = 'ADMIN'): MiddlewareHandler {
  return async (c, next) => {
    c.set('user', { id, role })
    return next()
  }
}

export async function signTestJwt(
  payload: { sub: string; role?: string } = { sub: 'test-user-id', role: 'ADMIN' },
  secret = TEST_AUTH_SECRET,
): Promise<string> {
  const key = new TextEncoder().encode(secret)
  return new SignJWT({ role: payload.role ?? 'ADMIN', ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('1h')
    .setIssuedAt()
    .sign(key)
}

export function setupAuthEnv(): void {
  process.env.AUTH_SECRET = TEST_AUTH_SECRET
}

export async function authHeaders(payload?: { sub: string; role?: string }): Promise<
  Record<string, string>
> {
  const token = await signTestJwt(payload)
  return { Authorization: `Bearer ${token}` }
}
