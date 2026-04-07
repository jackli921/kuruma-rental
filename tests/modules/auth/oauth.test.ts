import { describe, expect, it, vi, beforeEach } from 'vitest'
import { loginWithOAuth } from '@/modules/auth/oauth'

const mockSignInWithOAuth = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn().mockResolvedValue({
    auth: {
      signInWithOAuth: (...args: unknown[]) => mockSignInWithOAuth(...args),
    },
  }),
}))

vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue('http://localhost:3000'),
  }),
}))

describe('loginWithOAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('initiates Google OAuth with correct redirect URL', async () => {
    mockSignInWithOAuth.mockResolvedValue({
      data: { url: 'https://accounts.google.com/oauth/authorize?...' },
      error: null,
    })

    const result = await loginWithOAuth('google')

    expect(mockSignInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: {
        redirectTo: 'http://localhost:3000/api/auth/callback',
      },
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.url).toBe('https://accounts.google.com/oauth/authorize?...')
    }
  })

  it('initiates Apple OAuth with correct redirect URL', async () => {
    mockSignInWithOAuth.mockResolvedValue({
      data: { url: 'https://appleid.apple.com/auth/authorize?...' },
      error: null,
    })

    const result = await loginWithOAuth('apple')

    expect(mockSignInWithOAuth).toHaveBeenCalledWith({
      provider: 'apple',
      options: {
        redirectTo: 'http://localhost:3000/api/auth/callback',
      },
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.url).toBe('https://appleid.apple.com/auth/authorize?...')
    }
  })

  it('returns error when OAuth initiation fails', async () => {
    mockSignInWithOAuth.mockResolvedValue({
      data: { url: null },
      error: { message: 'Provider not configured' },
    })

    const result = await loginWithOAuth('google')

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toBe('Provider not configured')
    }
  })
})
