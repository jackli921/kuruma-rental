import { describe, expect, it, vi } from 'vitest'

const mockSignIn = vi.fn()
const mockSignOut = vi.fn()

vi.mock('@/auth', () => ({
  signIn: (...args: unknown[]) => mockSignIn(...args),
  signOut: (...args: unknown[]) => mockSignOut(...args),
}))

describe('auth actions', () => {
  it('loginWithGoogle calls signIn with google provider', async () => {
    const { loginWithGoogle } = await import('@/modules/auth/actions')
    await loginWithGoogle()

    expect(mockSignIn).toHaveBeenCalledWith('google', { redirectTo: '/en' })
  })

  it('loginWithApple calls signIn with apple provider', async () => {
    const { loginWithApple } = await import('@/modules/auth/actions')
    await loginWithApple()

    expect(mockSignIn).toHaveBeenCalledWith('apple', { redirectTo: '/en' })
  })

  it('logout calls signOut with redirect', async () => {
    const { logout } = await import('@/modules/auth/actions')
    await logout()

    expect(mockSignOut).toHaveBeenCalledWith({ redirectTo: '/en/login' })
  })
})
