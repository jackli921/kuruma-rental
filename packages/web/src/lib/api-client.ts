import type { AppType } from '@kuruma/api'
import { hc } from 'hono/client'

const DEFAULT_API_URL = 'http://localhost:8787'

export function getApiBaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_API_URL
  return url.replace(/\/$/, '')
}

export function createApiClient() {
  return hc<AppType>(getApiBaseUrl())
}

export type ApiClient = ReturnType<typeof createApiClient>
