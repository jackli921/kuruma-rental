import { isRedirect } from '@tanstack/react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Route } from './messages'

// Invoke the route's beforeLoad directly with a minimal stubbed context to prove the
// wiring (design §4.1 / §8): the guard reads the session, runs the admin-bypass rule,
// and redirects home when messaging is hidden. The decision itself is unit-tested in
// feature-visibility.test.ts; this asserts the route is wired to it correctly.
function runGuard(role: string | undefined): Promise<unknown> {
  const session = role ? { user: { role } } : null
  const context = { queryClient: { ensureQueryData: async () => session } }
  // Minimal stub — the real beforeLoad arg carries more, but the guard only touches these.
  return (Route.options.beforeLoad as (arg: unknown) => Promise<unknown>)({
    context,
    params: { locale: 'en' },
  })
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('messages route guard (admin bypass)', () => {
  it('redirects a renter home when messaging is hidden in beta', async () => {
    try {
      await runGuard('RENTER')
      expect.unreachable('guard should have redirected the renter')
    } catch (error) {
      expect(isRedirect(error)).toBe(true)
    }
  })

  it('redirects a signed-out viewer (undefined role) home — fails safe, no bypass', async () => {
    try {
      await runGuard(undefined)
      expect.unreachable('guard should have redirected the signed-out viewer')
    } catch (error) {
      expect(isRedirect(error)).toBe(true)
    }
  })

  it('admits the platform admin so the owner can preview on beta', async () => {
    await expect(runGuard('PLATFORM_ADMIN')).resolves.toBeUndefined()
  })

  it('admits a renter once the messaging flag is on', async () => {
    vi.stubEnv('VITE_FEATURE_MESSAGING', 'true')
    await expect(runGuard('RENTER')).resolves.toBeUndefined()
  })
})
