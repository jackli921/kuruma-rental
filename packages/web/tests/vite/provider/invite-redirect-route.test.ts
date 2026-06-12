import { Route } from '@/routes/provider/invite/$token'
import { describe, expect, it, vi } from 'vitest'

// The API mints locale-free invite links (it can't know the recipient's locale),
// so this unprefixed route catches them and redirects to the localized acceptance
// page using the same browser detection as `/`. (#521 review P1)
vi.mock('@/vite/i18n/detectBrowserLocale', () => ({
  detectBrowserLocale: () => 'ja',
}))

const beforeLoad = Route.options.beforeLoad as (input: { params: { token: string } }) => void

describe('/provider/invite/$token (locale-free) redirect', () => {
  it('redirects an emailed invite link to the localized acceptance page, preserving the token', () => {
    let thrown: unknown
    try {
      beforeLoad({ params: { token: 'tok-x' } })
    } catch (err) {
      thrown = err
    }
    // TanStack's redirect() throws a Response-like object carrying the target
    // under `.options`.
    expect(thrown).toMatchObject({
      options: {
        to: '/$locale/provider/invite/$token',
        params: { locale: 'ja', token: 'tok-x' },
      },
    })
  })
})
