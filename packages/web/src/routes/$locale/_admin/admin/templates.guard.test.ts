import type { FeatureFlagOverrides } from '@kuruma/shared/feature-flags/registry'
import { isRedirect } from '@tanstack/react-router'
import { describe, expect, it } from 'vitest'
import { Route } from './templates'

// Invoke the route's beforeLoad directly with a minimal stubbed context to prove the
// wiring (design §4.4 / §6 / §8.3): the templates route follows the SHARED_CATALOG
// kill-switch (#1437). Unlike the messaging guard there is NO admin bypass — the flag
// is a platform-wide kill-switch (owner decision D3: when the shared catalog is off the
// admin surface is "fully hidden"), so a route mounted under `_admin` (already gated on
// platform-admin membership) still redirects away when the flag is off. SHARED_CATALOG is
// serverOnly + serverDefault ON, so the default admits and only an explicit override closes.
function runGuard(overrides: FeatureFlagOverrides = {}): Promise<unknown> {
  const ensureQueryData = async (opts: { queryKey: readonly unknown[] }) =>
    opts.queryKey[0] === 'feature-flags' ? overrides : undefined
  const context = { queryClient: { ensureQueryData } }
  // Minimal stub — the real beforeLoad arg carries more, but the guard only touches these.
  return (Route.options.beforeLoad as (arg: unknown) => Promise<unknown>)({
    context,
    params: { locale: 'en' },
  })
}

describe('templates route guard (SHARED_CATALOG kill-switch)', () => {
  it('redirects to the admin overview when the shared catalog is switched off', async () => {
    try {
      await runGuard({ SHARED_CATALOG: false })
      expect.unreachable('guard should have redirected when SHARED_CATALOG is off')
    } catch (error) {
      expect(isRedirect(error)).toBe(true)
      // Pin the target so a typo'd/relocated redirect can't pass green — the overview
      // lives inside `_admin`, so a turned-off admin lands somewhere they're authorized.
      // TanStack carries the redirect opts under `.options`, not on the error root.
      expect((error as { options?: { to?: string } }).options?.to).toBe('/$locale/admin')
    }
  })

  it('admits by default — SHARED_CATALOG is serverDefault ON, so no override still opens the route', async () => {
    await expect(runGuard()).resolves.toBeUndefined()
  })

  it('admits when a runtime override explicitly re-enables the shared catalog', async () => {
    await expect(runGuard({ SHARED_CATALOG: true })).resolves.toBeUndefined()
  })
})
