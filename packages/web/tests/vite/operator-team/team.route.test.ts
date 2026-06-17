import { Route } from '@/routes/$locale/_business/manage/team'
import { afterEach, describe, expect, it, vi } from 'vitest'

// The beta MVP demo hides operator team management (#904) behind a build flag. The
// nav link is filtered out elsewhere, but the load-bearing block against a direct
// URL / bookmark is THIS beforeLoad redirect — so it gets its own test: hiding the
// link is not the same guarantee as blocking the route.
const beforeLoad = Route.options.beforeLoad as (input: { params: { locale: string } }) => void

describe('/manage/team feature-flag guard', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('redirects a direct URL to /manage/bookings when the team flag is off (beta default)', () => {
    vi.stubEnv('VITE_FEATURE_OPERATOR_TEAM', undefined)
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

  it('does not redirect when the team flag is enabled (full build)', () => {
    vi.stubEnv('VITE_FEATURE_OPERATOR_TEAM', 'true')
    expect(() => beforeLoad({ params: { locale: 'en' } })).not.toThrow()
  })
})
