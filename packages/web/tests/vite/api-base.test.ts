import { getApiBaseUrl } from '@/vite/api-base'
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('getApiBaseUrl', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('defaults to the same-origin /api proxy path when VITE_API_BASE_URL is unset', () => {
    vi.stubEnv('VITE_API_BASE_URL', undefined)
    expect(getApiBaseUrl()).toBe('/api')
  })

  it('returns the configured VITE_API_BASE_URL when set', () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.kuruma.example')
    expect(getApiBaseUrl()).toBe('https://api.kuruma.example')
  })
})
