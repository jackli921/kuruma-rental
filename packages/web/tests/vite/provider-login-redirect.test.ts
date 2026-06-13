import { Route } from '@/routes/$locale/provider/login'
import type { Session } from '@/vite/session'
import { isRedirect } from '@tanstack/react-router'
import { describe, expect, it } from 'vitest'

// Invoke the route's beforeLoad with a stubbed context so we assert WHERE an
// already-signed-in operator lands — the seam between provider login (#521) and
// the real operator portal (#523). The portal was built slug-less under
// `_business` (`/$locale/dashboard`), so the old `/manage/$slug/dashboard` stub
// must never be the destination.
function runBeforeLoad(session: Session | null) {
  const context = { queryClient: { ensureQueryData: async () => session } }
  return Route.options.beforeLoad?.({
    context,
    params: { locale: 'en' },
  } as never)
}

const operatorSession: Session = {
  user: { id: 'u', role: 'OPERATOR_OWNER', operatorSlug: 'acme' },
  csrfToken: 't',
}

describe('provider/login beforeLoad', () => {
  it('sends an already-authed operator to the real /$locale/dashboard, not the stub', async () => {
    let thrown: unknown
    try {
      await runBeforeLoad(operatorSession)
    } catch (e) {
      thrown = e
    }
    expect(isRedirect(thrown)).toBe(true)
    const redirect = thrown as { options: { to: string; params?: { locale?: string } } }
    expect(redirect.options.to).toBe('/$locale/dashboard')
    expect(redirect.options.params?.locale).toBe('en')
  })

  it('does not redirect a signed-out visitor (the sign-in card renders)', async () => {
    await expect(runBeforeLoad(null)).resolves.toBeUndefined()
  })

  it('does not redirect a signed-in non-operator (no operatorSlug)', async () => {
    const renter: Session = { user: { id: 'u', role: 'RENTER' }, csrfToken: 't' }
    await expect(runBeforeLoad(renter)).resolves.toBeUndefined()
  })
})
