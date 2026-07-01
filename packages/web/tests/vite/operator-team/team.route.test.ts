import { Route } from '@/routes/$locale/_business/manage/team'
import type { FeatureFlagOverrides } from '@kuruma/shared/feature-flags/registry'
import { afterEach, describe, expect, it, vi } from 'vitest'

// The beta MVP demo hides operator team management (#904) behind a flag. The nav
// link is filtered out elsewhere, but the load-bearing block against a direct URL /
// bookmark is THIS beforeLoad redirect — so it gets its own test: hiding the link is
// not the same guarantee as blocking the route. Since #1322 the guard reads the
// runtime override (effective = override ?? build-time env ?? false).
const beforeLoad = Route.options.beforeLoad as (input: {
  context: { queryClient: { ensureQueryData: (opts: unknown) => Promise<FeatureFlagOverrides> } }
  params: { locale: string }
}) => Promise<void>

function runGuard(overrides: FeatureFlagOverrides): Promise<void> {
  const ensureQueryData = vi.fn().mockResolvedValue(overrides)
  return beforeLoad({ context: { queryClient: { ensureQueryData } }, params: { locale: 'en' } })
}

describe('/manage/team feature-flag guard', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('redirects a direct URL to /manage/bookings when the flag is off (no override, beta env default)', async () => {
    vi.stubEnv('VITE_FEATURE_OPERATOR_TEAM', undefined)
    // TanStack's redirect() throws a Response-like object carrying the target under
    // `.options` — assert the destination, not just that something threw.
    await expect(runGuard({})).rejects.toMatchObject({
      options: { to: '/$locale/manage/bookings', params: { locale: 'en' } },
    })
  })

  it('lets a direct URL through when a runtime override enables team even if the build default is off', async () => {
    vi.stubEnv('VITE_FEATURE_OPERATOR_TEAM', undefined)
    await expect(runGuard({ OPERATOR_TEAM: true })).resolves.toBeUndefined()
  })

  it('does not redirect when the build default is on and no override is set (full build)', async () => {
    vi.stubEnv('VITE_FEATURE_OPERATOR_TEAM', 'true')
    await expect(runGuard({})).resolves.toBeUndefined()
  })

  it('a runtime override OFF still redirects even when the build default is on', async () => {
    vi.stubEnv('VITE_FEATURE_OPERATOR_TEAM', 'true')
    await expect(runGuard({ OPERATOR_TEAM: false })).rejects.toMatchObject({
      options: { to: '/$locale/manage/bookings', params: { locale: 'en' } },
    })
  })
})
