import type { createApp } from '@kuruma/api'
import { hc } from 'hono/client'
import { SignJWT } from 'jose'

type AppType = ReturnType<typeof createApp>

const DEFAULT_API_URL = 'http://localhost:8787'

function getApiBaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_API_URL
  return url.replace(/\/$/, '')
}

// Response body types require `as ApiResponse<T>` casts because the API's
// ok()/fail() helpers return plain Response, not Hono's TypedResponse.
// Full end-to-end inference requires removing `: Response` from those helpers.
export function createApiClient(headers?: Record<string, string>) {
  return hc<AppType>(getApiBaseUrl(), headers ? { headers } : undefined)
}

/** Sign a short-lived JWT that the API's requireAuth() middleware accepts. */
export async function signApiToken(user: { id: string; role: string }): Promise<string> {
  const secret = process.env.AUTH_SECRET
  if (!secret) throw new Error('AUTH_SECRET is not configured')

  return new SignJWT({ role: user.role })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime('5m')
    .setProtectedHeader({ alg: 'HS256' })
    .sign(new TextEncoder().encode(secret))
}

/** Create an hc client that forwards the current user's auth to the API. */
export async function createAuthApiClient(user: { id: string; role: string }) {
  const token = await signApiToken(user)
  return createApiClient({ Authorization: `Bearer ${token}` })
}
