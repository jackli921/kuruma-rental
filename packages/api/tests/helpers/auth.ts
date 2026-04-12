import { SignJWT } from 'jose'

export const TEST_AUTH_SECRET = 'test-auth-secret-at-least-32-chars-long'

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
