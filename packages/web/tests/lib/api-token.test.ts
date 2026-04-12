import { jwtVerify } from 'jose'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/auth', () => ({
  auth: vi.fn(),
}))

describe('getApiToken', () => {
  const TEST_SECRET = 'test-secret-at-least-32-chars-long!'

  beforeEach(() => {
    vi.restoreAllMocks()
    process.env.AUTH_SECRET = TEST_SECRET
  })

  it('returns undefined when session is null', async () => {
    const { auth } = await import('@/auth')
    vi.mocked(auth).mockResolvedValueOnce(null)

    const { getApiToken } = await import('@/lib/api-token')
    const token = await getApiToken()

    expect(token).toBeUndefined()
  })

  it('returns undefined when session.user is undefined', async () => {
    const { auth } = await import('@/auth')
    vi.mocked(auth).mockResolvedValueOnce({ expires: '' } as never)

    const { getApiToken } = await import('@/lib/api-token')
    const token = await getApiToken()

    expect(token).toBeUndefined()
  })

  it('returns undefined when AUTH_SECRET is missing', async () => {
    Reflect.deleteProperty(process.env, 'AUTH_SECRET')
    const { auth } = await import('@/auth')
    vi.mocked(auth).mockResolvedValueOnce({
      user: { id: 'user-1', role: 'STAFF' },
      expires: '',
    } as never)

    const { getApiToken } = await import('@/lib/api-token')
    const token = await getApiToken()

    expect(token).toBeUndefined()
  })

  it('mints a JWS with sub and role from session', async () => {
    const { auth } = await import('@/auth')
    vi.mocked(auth).mockResolvedValueOnce({
      user: { id: 'user-42', role: 'ADMIN' },
      expires: '',
    } as never)

    const { getApiToken } = await import('@/lib/api-token')
    const token = await getApiToken()

    expect(token).toBeDefined()

    const key = new TextEncoder().encode(TEST_SECRET)
    const { payload } = await jwtVerify(token!, key, { algorithms: ['HS256'] })
    expect(payload.sub).toBe('user-42')
    expect(payload.role).toBe('ADMIN')
    expect(payload.exp).toBeDefined()
  })

  it('defaults role to RENTER when session.user has no role', async () => {
    const { auth } = await import('@/auth')
    vi.mocked(auth).mockResolvedValueOnce({
      user: { id: 'user-1' },
      expires: '',
    } as never)

    const { getApiToken } = await import('@/lib/api-token')
    const token = await getApiToken()

    const key = new TextEncoder().encode(TEST_SECRET)
    const { payload } = await jwtVerify(token!, key)
    expect(payload.role).toBe('RENTER')
  })
})
