import type { MiddlewareHandler } from 'hono'
import { SignJWT } from 'jose'
import type { AuthUser } from '../../src/middleware/auth'

export const TEST_AUTH_SECRET = 'test-auth-secret-at-least-32-chars-long'

/** Middleware that injects a fake authenticated user into context.
 *  Use in isolation tests that mount routes without the real auth middleware.
 *  Override per-request via X-Test-User-Id / X-Test-User-Role headers. */
export function fakeAuth(
  defaultUser: AuthUser = { id: 'test-user-id', role: 'ADMIN' },
): MiddlewareHandler {
  return async (c, next) => {
    const overrideId = c.req.header('X-Test-User-Id')
    const user: AuthUser = overrideId
      ? {
          id: overrideId,
          role: (c.req.header('X-Test-User-Role') as AuthUser['role']) ?? defaultUser.role,
        }
      : defaultUser
    c.set('user', user)
    await next()
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
