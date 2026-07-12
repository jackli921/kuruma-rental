import { isRedirect } from '@tanstack/react-router'
import { describe, expect, it, vi } from 'vitest'
import { Route } from './register'

// Sign-in-first gate (#877): the register route is authed now. beforeLoad reads the
// session via ensureQueryData and:
//   - signed out  → redirect to /$locale/login carrying returnTo (so OAuth lands back here)
//   - operator     → redirect to /$locale/dashboard (already an operator; the API also 409s)
//   - signed-in renter → fall through (renders the form)
// The stub returns the given session for the ['session'] query key.
interface StubSession {
  user: { operatorSlug?: string; email?: string }
  csrfToken?: string
}

function runGuard(session: StubSession | null): Promise<unknown> {
  const ensureQueryData = vi.fn().mockResolvedValue(session)
  const context = { queryClient: { ensureQueryData } }
  return (Route.options.beforeLoad as (arg: unknown) => Promise<unknown>)({
    context,
    params: { locale: 'en' },
    location: { pathname: '/en/business/register' },
  })
}

describe('business/register beforeLoad guard (sign-in-first)', () => {
  it('redirects a signed-out visitor to login carrying returnTo', async () => {
    try {
      await runGuard(null)
      expect.unreachable('guard should have redirected a signed-out visitor')
    } catch (error) {
      expect(isRedirect(error)).toBe(true)
      const options = (error as { options?: { to?: string; search?: { returnTo?: string } } })
        .options
      expect(options?.to).toBe('/$locale/login')
      expect(options?.search?.returnTo).toBe('/en/business/register')
    }
  })

  it('redirects an existing operator to the dashboard', async () => {
    try {
      await runGuard({ user: { operatorSlug: 'acme', email: 'owner@acme.co' } })
      expect.unreachable('guard should have redirected an operator')
    } catch (error) {
      expect(isRedirect(error)).toBe(true)
      const options = (error as { options?: { to?: string } }).options
      expect(options?.to).toBe('/$locale/dashboard')
    }
  })

  it('admits a signed-in renter (no redirect)', async () => {
    await expect(runGuard({ user: { email: 'renter@x.io' } })).resolves.toBeUndefined()
  })
})
