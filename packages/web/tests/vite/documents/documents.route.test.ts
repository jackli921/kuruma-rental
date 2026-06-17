import { Route } from '@/routes/$locale/_renter/documents'
import { afterEach, describe, expect, it, vi } from 'vitest'

// The beta MVP demo hides the renter document-upload page (#459) behind a build
// flag — the instant-book flow no longer gates on it. The nav link is filtered
// out elsewhere; the load-bearing block against a direct URL / bookmark is THIS
// beforeLoad redirect, so it gets its own test.
const beforeLoad = Route.options.beforeLoad as (input: { params: { locale: string } }) => void

describe('/documents feature-flag guard', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('redirects a direct URL to /search when the documents flag is off (beta default)', () => {
    vi.stubEnv('VITE_FEATURE_RENTER_DOCUMENTS', undefined)
    let thrown: unknown
    try {
      beforeLoad({ params: { locale: 'en' } })
    } catch (err) {
      thrown = err
    }
    // TanStack's redirect() throws a Response-like object carrying the target
    // under `.options` — assert the destination, not just that something threw.
    expect(thrown).toMatchObject({
      options: { to: '/$locale/search', params: { locale: 'en' } },
    })
  })

  it('does not redirect when the documents flag is enabled (full build)', () => {
    vi.stubEnv('VITE_FEATURE_RENTER_DOCUMENTS', 'true')
    expect(() => beforeLoad({ params: { locale: 'en' } })).not.toThrow()
  })
})
