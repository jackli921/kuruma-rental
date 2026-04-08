import { getApiBaseUrl } from '@/lib/api-client'
import { describe, expect, test } from 'vitest'

describe('getApiBaseUrl', () => {
  test('returns NEXT_PUBLIC_API_URL when set', () => {
    const original = process.env.NEXT_PUBLIC_API_URL
    process.env.NEXT_PUBLIC_API_URL = 'https://api.kuruma.example.com'

    expect(getApiBaseUrl()).toBe('https://api.kuruma.example.com')

    process.env.NEXT_PUBLIC_API_URL = original
  })

  test('returns localhost fallback when env var is not set', () => {
    const original = process.env.NEXT_PUBLIC_API_URL
    process.env.NEXT_PUBLIC_API_URL = undefined as unknown as string

    expect(getApiBaseUrl()).toBe('http://localhost:8787')

    process.env.NEXT_PUBLIC_API_URL = original
  })

  test('strips trailing slash from URL', () => {
    const original = process.env.NEXT_PUBLIC_API_URL
    process.env.NEXT_PUBLIC_API_URL = 'https://api.example.com/'

    expect(getApiBaseUrl()).toBe('https://api.example.com')

    process.env.NEXT_PUBLIC_API_URL = original
  })
})
