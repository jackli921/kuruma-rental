import { Route } from '@/routes/$locale/_renter/documents'
import type { FeatureFlagOverrides } from '@kuruma/shared/feature-flags/registry'
import { afterEach, describe, expect, it, vi } from 'vitest'

// The beta MVP demo hides the renter document-upload page (#459) behind a flag —
// the instant-book flow no longer gates on it. The nav link is filtered out
// elsewhere; the load-bearing block against a direct URL / bookmark is THIS
// beforeLoad redirect, so it gets its own test. Since #1322 the guard reads the
// runtime override (effective = override ?? build-time env ?? false).
const beforeLoad = Route.options.beforeLoad as (input: {
  context: { queryClient: { fetchQuery: (opts: unknown) => Promise<FeatureFlagOverrides> } }
  params: { locale: string }
}) => Promise<void>

function runGuard(overrides: FeatureFlagOverrides): Promise<void> {
  const fetchQuery = vi.fn().mockResolvedValue(overrides)
  return beforeLoad({ context: { queryClient: { fetchQuery } }, params: { locale: 'en' } })
}

describe('/documents feature-flag guard', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('redirects a direct URL to /search when the flag is off (no override, beta env default)', async () => {
    vi.stubEnv('VITE_FEATURE_RENTER_DOCUMENTS', undefined)
    // TanStack's redirect() throws a Response-like object carrying the target under
    // `.options` — assert the destination, not just that something threw.
    await expect(runGuard({})).rejects.toMatchObject({
      options: { to: '/$locale/search', params: { locale: 'en' } },
    })
  })

  it('lets a direct URL through when a runtime override enables documents even if the build default is off', async () => {
    vi.stubEnv('VITE_FEATURE_RENTER_DOCUMENTS', undefined)
    await expect(runGuard({ RENTER_DOCUMENTS: true })).resolves.toBeUndefined()
  })

  it('does not redirect when the build default is on and no override is set (full build)', async () => {
    vi.stubEnv('VITE_FEATURE_RENTER_DOCUMENTS', 'true')
    await expect(runGuard({})).resolves.toBeUndefined()
  })

  it('a runtime override OFF still redirects even when the build default is on', async () => {
    vi.stubEnv('VITE_FEATURE_RENTER_DOCUMENTS', 'true')
    await expect(runGuard({ RENTER_DOCUMENTS: false })).rejects.toMatchObject({
      options: { to: '/$locale/search', params: { locale: 'en' } },
    })
  })
})
