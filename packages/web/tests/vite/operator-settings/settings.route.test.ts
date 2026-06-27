import { Route } from '@/routes/$locale/_business/manage/settings'
import { afterEach, describe, expect, it, vi } from 'vitest'

// The beta MVP demo hides operator settings (#903) behind a build flag. The nav
// link is filtered out elsewhere, but the load-bearing block against a direct URL /
// bookmark is THIS beforeLoad redirect — so it gets its own test: hiding the link
// is not the same guarantee as blocking the route.
const beforeLoad = Route.options.beforeLoad as (input: { params: { locale: string } }) => void

describe('/manage/settings feature-flag guard', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('redirects a direct URL to /manage/bookings when the settings flag is off (beta default)', () => {
    vi.stubEnv('VITE_FEATURE_OPERATOR_SETTINGS', undefined)
    let thrown: unknown
    try {
      beforeLoad({ params: { locale: 'en' } })
    } catch (err) {
      thrown = err
    }
    // TanStack's redirect() throws a Response-like object carrying the target
    // under `.options` — assert the destination, not just that something threw.
    expect(thrown).toMatchObject({
      options: { to: '/$locale/manage/bookings', params: { locale: 'en' } },
    })
  })

  it('does not redirect when the settings flag is enabled (full build)', () => {
    vi.stubEnv('VITE_FEATURE_OPERATOR_SETTINGS', 'true')
    expect(() => beforeLoad({ params: { locale: 'en' } })).not.toThrow()
  })
})

// The loader prefetches the EFFECTIVE operator's profile so the component's
// useSuspenseQuery resolves without a FOUC. Effective id = own operatorId (operator
// session) ?? deps.operator (bypass admin's pick) — the same resolution the
// component uses (one derivation, two readers must stay in lockstep).
const loader = Route.options.loader as (args: {
  context: { queryClient: { ensureQueryData: ReturnType<typeof vi.fn> } }
  deps: { operator: string | undefined }
}) => Promise<unknown>
const loaderDeps = Route.options.loaderDeps as (a: {
  search: { operator?: string }
}) => { operator?: string }

describe('/manage/settings loader effective-id prefetch', () => {
  it('threads the operator search param through loaderDeps', () => {
    expect(loaderDeps({ search: { operator: 'op_9' } })).toEqual({ operator: 'op_9' })
  })

  it('prefetches the PICKED operator profile for a bypass admin (no own operatorId)', async () => {
    const ensureQueryData = vi
      .fn()
      .mockResolvedValueOnce({ user: { id: 'u', role: 'PLATFORM_ADMIN' }, csrfToken: 't' }) // session
      .mockResolvedValueOnce({}) // profile
    await loader({ context: { queryClient: { ensureQueryData } }, deps: { operator: 'op_9' } })
    const profileCall = ensureQueryData.mock.calls[1][0] as { queryKey: unknown }
    expect(profileCall.queryKey).toEqual(['operator-profile', 'op_9'])
  })

  it("uses an operator session's own id and ignores a stray ?operator param", async () => {
    const ensureQueryData = vi
      .fn()
      .mockResolvedValueOnce({
        user: { id: 'u', role: 'OPERATOR_OWNER', operatorId: 'op_self' },
        csrfToken: 't',
      })
      .mockResolvedValueOnce({})
    await loader({ context: { queryClient: { ensureQueryData } }, deps: { operator: 'op_9' } })
    const profileCall = ensureQueryData.mock.calls[1][0] as { queryKey: unknown }
    expect(profileCall.queryKey).toEqual(['operator-profile', 'op_self'])
  })
})
