import { auth } from '@/auth'
import { SignJWT } from 'jose'

const TOKEN_TTL = '60s'

export async function getApiToken(): Promise<string | undefined> {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return undefined

  const secret = process.env.AUTH_SECRET
  if (!secret) return undefined

  const role = session.user.role ?? 'RENTER'
  const key = new TextEncoder().encode(secret)

  // Only tenant-scoped (OPERATOR_*) sessions carry an operatorId. Omit the claim
  // entirely otherwise so the API treats the caller as unscoped (verifyJwt).
  const claims: Record<string, unknown> = { role }
  if (session.user.operatorId) claims.operatorId = session.user.operatorId

  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuer('kuruma-web')
    .setAudience('kuruma-api')
    .setExpirationTime(TOKEN_TTL)
    .sign(key)
}
