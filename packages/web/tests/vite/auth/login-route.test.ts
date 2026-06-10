import { Route } from '@/routes/$locale/login'
import { describe, expect, it, vi } from 'vitest'

const validateSearch = Route.options.validateSearch as (search: Record<string, unknown>) => {
  returnTo?: string
}

const beforeLoad = Route.options.beforeLoad as (input: {
  context: { queryClient: { ensureQueryData: ReturnType<typeof vi.fn> } }
  params: { locale: string }
  search: { returnTo?: string }
}) => Promise<void>

async function expectRedirect(promise: Promise<void>, location: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({ status: 307 })
  await promise.catch((err: Response) => {
    expect(err.headers.get('location')).toBe(location)
  })
}

describe('/$locale/login route', () => {
  it('keeps only a safe local returnTo search param', () => {
    expect(validateSearch({ returnTo: '/en/bookings/new' })).toEqual({
      returnTo: '/en/bookings/new',
    })
    expect(validateSearch({ returnTo: 'https://evil.example/login' })).toEqual({})
    expect(validateSearch({ returnTo: '//evil.example/login' })).toEqual({})
  })

  it('does not redirect signed-out users away from login', async () => {
    const ensureQueryData = vi.fn(async () => null)

    await expect(
      beforeLoad({
        context: { queryClient: { ensureQueryData } },
        params: { locale: 'en' },
        search: { returnTo: '/en/bookings/new' },
      }),
    ).resolves.toBeUndefined()
  })

  it('redirects already-authenticated users to the safe returnTo path', async () => {
    const ensureQueryData = vi.fn(async () => ({
      user: { id: 'u1', role: 'RENTER' },
      csrfToken: 'csrf',
    }))

    await expectRedirect(
      beforeLoad({
        context: { queryClient: { ensureQueryData } },
        params: { locale: 'en' },
        search: { returnTo: '/en/bookings/new' },
      }),
      '/en/bookings/new',
    )
  })

  it('redirects already-authenticated users to the locale home when returnTo is absent', async () => {
    const ensureQueryData = vi.fn(async () => ({
      user: { id: 'u1', role: 'RENTER' },
      csrfToken: 'csrf',
    }))

    await expectRedirect(
      beforeLoad({
        context: { queryClient: { ensureQueryData } },
        params: { locale: 'ja' },
        search: {},
      }),
      '/ja',
    )
  })
})
