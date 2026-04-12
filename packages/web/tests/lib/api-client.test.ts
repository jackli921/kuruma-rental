import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { createApiClient } from '@/lib/api-client'

describe('createApiClient', () => {
  let originalUrl: string | undefined

  beforeEach(() => {
    originalUrl = process.env.NEXT_PUBLIC_API_URL
  })

  afterEach(() => {
    if (originalUrl === undefined) {
      Reflect.deleteProperty(process.env, 'NEXT_PUBLIC_API_URL')
    } else {
      process.env.NEXT_PUBLIC_API_URL = originalUrl
    }
  })

  test('returns an hc client targeting NEXT_PUBLIC_API_URL when set', () => {
    process.env.NEXT_PUBLIC_API_URL = 'https://api.kuruma.example.com'
    const client = createApiClient()
    // hc client exposes $url() on route segments — verify the base URL is correct
    const url = client.vehicles.$url()
    expect(url.origin).toBe('https://api.kuruma.example.com')
  })

  test('returns an hc client targeting localhost fallback when env var is not set', () => {
    Reflect.deleteProperty(process.env, 'NEXT_PUBLIC_API_URL')
    const client = createApiClient()
    const url = client.vehicles.$url()
    expect(url.origin).toBe('http://localhost:8787')
  })

  test('strips trailing slash from URL', () => {
    process.env.NEXT_PUBLIC_API_URL = 'https://api.example.com/'
    const client = createApiClient()
    const url = client.vehicles.$url()
    expect(url.origin).toBe('https://api.example.com')
    // Ensure no double-slash in path
    expect(url.pathname).toBe('/vehicles')
  })
})
