import type { FeatureFlagOverrides } from '@kuruma/shared/feature-flags/registry'
import { isRedirect } from '@tanstack/react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Route } from './messages'

// Invoke the route's beforeLoad directly with a minimal stubbed context to prove the
// wiring (design §4.1 / §8): the guard reads the session + the runtime flag overrides,
// runs the admin-bypass rule, and redirects home when messaging is hidden. The decision
// itself is unit-tested in feature-visibility.test.ts; this asserts the route is wired
// to it correctly. Since #1322 the flag reads the ['feature-flags'] override map, so the
// stub branches on the query key: the session query vs. the overrides query.
function runGuard(
  role: string | undefined,
  overrides: FeatureFlagOverrides = {},
): Promise<unknown> {
  const session = role ? { user: { role } } : null
  const ensureQueryData = async (opts: { queryKey: readonly unknown[] }) =>
    opts.queryKey[0] === 'feature-flags' ? overrides : session
  const context = { queryClient: { ensureQueryData } }
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

  it('admits a renter once the messaging flag is on (build default)', async () => {
    vi.stubEnv('VITE_FEATURE_MESSAGING', 'true')
    await expect(runGuard('RENTER')).resolves.toBeUndefined()
  })

  it('admits a renter when a runtime override turns messaging on even though the build default is off', async () => {
    vi.stubEnv('VITE_FEATURE_MESSAGING', undefined)
    await expect(runGuard('RENTER', { MESSAGING: true })).resolves.toBeUndefined()
  })
})
