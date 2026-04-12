import { getApiBaseUrl } from '@/lib/api-client'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

describe('getApiBaseUrl', () => {
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

  test('returns NEXT_PUBLIC_API_URL when set', () => {
    process.env.NEXT_PUBLIC_API_URL = 'https://api.kuruma.example.com'
    expect(getApiBaseUrl()).toBe('https://api.kuruma.example.com')
  })

  test('returns localhost fallback when env var is not set', () => {
    Reflect.deleteProperty(process.env, 'NEXT_PUBLIC_API_URL')
    expect(getApiBaseUrl()).toBe('http://localhost:8787')
  })

  test('strips trailing slash from URL', () => {
    process.env.NEXT_PUBLIC_API_URL = 'https://api.example.com/'
    expect(getApiBaseUrl()).toBe('https://api.example.com')
  })
})
