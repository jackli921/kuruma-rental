import { describe, expect, it, vi, beforeEach } from 'vitest'
import { register } from '@/modules/auth/actions'

const mockSignUp = vi.fn()
const mockAdminDeleteUser = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn().mockResolvedValue({
    auth: {
      signUp: (...args: unknown[]) => mockSignUp(...args),
      admin: {
        deleteUser: (...args: unknown[]) => mockAdminDeleteUser(...args),
      },
    },
  }),
}))

const mockInsert = vi.fn()
const mockValues = vi.fn()

vi.mock('@/db', () => ({
  getDb: vi.fn(() => ({
    insert: (...args: unknown[]) => {
      mockInsert(...args)
      return { values: mockValues }
    },
  })),
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`)
  }),
}))

describe('register', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns validation errors for invalid input', async () => {
    const result = await register({
      name: '',
      email: 'bad',
      password: 'short',
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.errors).toBeDefined()
    }
    expect(mockSignUp).not.toHaveBeenCalled()
  })

  it('creates auth user and profile row on valid input', async () => {
    mockSignUp.mockResolvedValue({
      data: { user: { id: 'supabase-uid-123' } },
      error: null,
    })
    mockValues.mockResolvedValue(undefined)

    try {
      await register({
        name: 'Test User',
        email: 'test@example.com',
        password: 'password123',
      })
    } catch (e) {
      // redirect throws
      expect((e as Error).message).toBe('REDIRECT:/en')
    }

    expect(mockSignUp).toHaveBeenCalledWith({
      email: 'test@example.com',
      password: 'password123',
      options: { data: { name: 'Test User' } },
    })
    expect(mockInsert).toHaveBeenCalled()
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        supabaseAuthId: 'supabase-uid-123',
        email: 'test@example.com',
        name: 'Test User',
        role: 'RENTER',
      }),
    )
  })

  it('returns error when Supabase auth fails', async () => {
    mockSignUp.mockResolvedValue({
      data: { user: null },
      error: { message: 'User already registered' },
    })

    const result = await register({
      name: 'Test User',
      email: 'existing@example.com',
      password: 'password123',
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toBe('User already registered')
    }
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('cleans up auth user if profile insert fails', async () => {
    mockSignUp.mockResolvedValue({
      data: { user: { id: 'supabase-uid-456' } },
      error: null,
    })
    mockValues.mockRejectedValue(new Error('DB insert failed'))

    const result = await register({
      name: 'Test User',
      email: 'test@example.com',
      password: 'password123',
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toBe('Registration failed. Please try again.')
    }
    expect(mockAdminDeleteUser).toHaveBeenCalledWith('supabase-uid-456')
  })
})
