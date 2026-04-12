import { auth } from '@/auth'
import type { createApp } from '@kuruma/api'
import { hc } from 'hono/client'
import { SignJWT } from 'jose'

type AppType = ReturnType<typeof createApp>

const DEFAULT_API_URL = 'http://localhost:8787'

export function getApiBaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_API_URL
  return url.replace(/\/$/, '')
}

export function createApiClient() {
  return hc<AppType>(getApiBaseUrl())
}

export type ApiClient = ReturnType<typeof createApiClient>

/**
 * Create a short-lived JWT for API calls. The API verifies this token
 * using the same AUTH_SECRET that NextAuth uses.
 */
async function mintApiToken(userId: string, role: string): Promise<string> {
  const secret = process.env.AUTH_SECRET
  if (!secret) throw new Error('AUTH_SECRET not configured')

  const key = new TextEncoder().encode(secret)
  return new SignJWT({ sub: userId, role })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('5m')
    .setIssuedAt()
    .sign(key)
}

/**
 * Fetch wrapper that adds JWT auth from the current session.
 * Use for all API calls from server actions/components.
 */
export async function authedFetch(url: string, init?: RequestInit): Promise<Response> {
  const session = await auth()
  const headers = new Headers(init?.headers)

  if (session?.user?.id) {
    const role = (session.user as { role?: string }).role ?? 'RENTER'
    const token = await mintApiToken(session.user.id, role)
    headers.set('Authorization', `Bearer ${token}`)
  }

  return fetch(url, { ...init, headers })
}
