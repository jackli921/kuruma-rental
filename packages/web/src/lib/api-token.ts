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

  return new SignJWT({ role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuer('kuruma-web')
    .setAudience('kuruma-api')
    .setExpirationTime(TOKEN_TTL)
    .sign(key)
}
