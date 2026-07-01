import { Route } from '@/routes/$locale/_business/manage/settings'
import type { FeatureFlagOverrides } from '@kuruma/shared/feature-flags/registry'
import { afterEach, describe, expect, it, vi } from 'vitest'

// The beta MVP demo hides operator settings (#903) behind a flag. The nav link is
// filtered out elsewhere, but the load-bearing block against a direct URL / bookmark
// is THIS beforeLoad redirect — so it gets its own test: hiding the link is not the
// same guarantee as blocking the route. Since #1322 the guard reads the runtime
// override (effective = override ?? build-time env ?? false), so these drive both.
const beforeLoad = Route.options.beforeLoad as (input: {
  context: { queryClient: { ensureQueryData: (opts: unknown) => Promise<FeatureFlagOverrides> } }
  params: { locale: string }
}) => Promise<void>

// The guard resolves the flag from the ['feature-flags'] override map; the mock
// returns it regardless of the query-options arg, and vi.stubEnv controls the
// build-time fallback so both precedence directions can be asserted.
function runGuard(overrides: FeatureFlagOverrides): Promise<void> {
  const ensureQueryData = vi.fn().mockResolvedValue(overrides)
  return beforeLoad({ context: { queryClient: { ensureQueryData } }, params: { locale: 'en' } })
}

describe('/manage/settings feature-flag guard', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('redirects a direct URL to /manage/bookings when the flag is off (no override, beta env default)', async () => {
    vi.stubEnv('VITE_FEATURE_OPERATOR_SETTINGS', undefined)
    // TanStack's redirect() throws a Response-like object carrying the target under
    // `.options` — assert the destination, not just that something threw.
    await expect(runGuard({})).rejects.toMatchObject({
      options: { to: '/$locale/manage/bookings', params: { locale: 'en' } },
    })
  })

  it('lets a direct URL through when a runtime override enables settings even if the build default is off', async () => {
    vi.stubEnv('VITE_FEATURE_OPERATOR_SETTINGS', undefined)
    await expect(runGuard({ OPERATOR_SETTINGS: true })).resolves.toBeUndefined()
  })

  it('does not redirect when the build default is on and no override is set (full build)', async () => {
    vi.stubEnv('VITE_FEATURE_OPERATOR_SETTINGS', 'true')
    await expect(runGuard({})).resolves.toBeUndefined()
  })

  it('a runtime override OFF still redirects even when the build default is on', async () => {
    vi.stubEnv('VITE_FEATURE_OPERATOR_SETTINGS', 'true')
    await expect(runGuard({ OPERATOR_SETTINGS: false })).rejects.toMatchObject({
      options: { to: '/$locale/manage/bookings', params: { locale: 'en' } },
    })
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
