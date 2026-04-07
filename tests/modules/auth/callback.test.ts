import { describe, expect, it, vi, beforeEach } from 'vitest'
import { handleOAuthCallback } from '@/modules/auth/callback'

const mockExchangeCodeForSession = vi.fn()
const mockGetUser = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn().mockResolvedValue({
    auth: {
      exchangeCodeForSession: (...args: unknown[]) => mockExchangeCodeForSession(...args),
      getUser: () => mockGetUser(),
    },
  }),
}))

const mockSelect = vi.fn()
const mockWhere = vi.fn()
const mockInsert = vi.fn()
const mockValues = vi.fn()

vi.mock('@/db', () => ({
  getDb: vi.fn(() => ({
    select: () => ({
      from: () => ({
        where: (...args: unknown[]) => {
          mockWhere(...args)
          return mockSelect()
        },
      }),
    }),
    insert: (...args: unknown[]) => {
      mockInsert(...args)
      return { values: mockValues }
    },
  })),
}))

describe('handleOAuthCallback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('exchanges code for session and returns success', async () => {
    mockExchangeCodeForSession.mockResolvedValue({ error: null })
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: 'supabase-uid-oauth',
          email: 'oauth@example.com',
          user_metadata: { full_name: 'OAuth User' },
        },
      },
    })
    mockSelect.mockResolvedValue([{ id: 'existing-profile' }])

    const result = await handleOAuthCallback('test-code')

    expect(mockExchangeCodeForSession).toHaveBeenCalledWith('test-code')
    expect(result.success).toBe(true)
  })

  it('creates profile row for first-time OAuth user', async () => {
    mockExchangeCodeForSession.mockResolvedValue({ error: null })
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: 'supabase-uid-new',
          email: 'new@example.com',
          user_metadata: { full_name: 'New User' },
        },
      },
    })
    mockSelect.mockResolvedValue([])
    mockValues.mockResolvedValue(undefined)

    const result = await handleOAuthCallback('test-code')

    expect(result.success).toBe(true)
    expect(mockInsert).toHaveBeenCalled()
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        supabaseAuthId: 'supabase-uid-new',
        email: 'new@example.com',
        name: 'New User',
        role: 'RENTER',
      }),
    )
  })

  it('does not create duplicate profile for returning user', async () => {
    mockExchangeCodeForSession.mockResolvedValue({ error: null })
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: 'supabase-uid-existing',
          email: 'existing@example.com',
          user_metadata: { full_name: 'Existing User' },
        },
      },
    })
    mockSelect.mockResolvedValue([{ id: 'existing-profile' }])

    await handleOAuthCallback('test-code')

    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('returns error when code exchange fails', async () => {
    mockExchangeCodeForSession.mockResolvedValue({
      error: { message: 'Invalid code' },
    })

    const result = await handleOAuthCallback('bad-code')

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toBe('Invalid code')
    }
  })

  it('uses email as name when full_name not provided', async () => {
    mockExchangeCodeForSession.mockResolvedValue({ error: null })
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: 'supabase-uid-noname',
          email: 'noname@example.com',
          user_metadata: {},
        },
      },
    })
    mockSelect.mockResolvedValue([])
    mockValues.mockResolvedValue(undefined)

    await handleOAuthCallback('test-code')

    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'noname@example.com',
      }),
    )
  })
})
