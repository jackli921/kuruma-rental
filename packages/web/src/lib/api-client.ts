import type { createApp } from '@kuruma/api'
import { hc } from 'hono/client'

type AppType = ReturnType<typeof createApp>

const DEFAULT_API_URL = 'http://localhost:8787'

function getApiBaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_API_URL
  return url.replace(/\/$/, '')
}

// Response body types require `as ApiResponse<T>` casts because the API's
// ok()/fail() helpers return plain Response, not Hono's TypedResponse.
// Full end-to-end inference requires removing `: Response` from those helpers.
export function createApiClient(token?: string) {
  const headers: Record<string, string> = {}
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  return hc<AppType>(getApiBaseUrl(), { headers })
}
