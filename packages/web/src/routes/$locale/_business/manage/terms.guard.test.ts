import type { FeatureFlagOverrides } from '@kuruma/shared/feature-flags/registry'
import { isRedirect } from '@tanstack/react-router'
import { describe, expect, it } from 'vitest'
import { Route } from './terms'

// The `_business` role check is the parent's job; this route adds the OPERATOR_TERMS
// visibility gate (dark until Slice B). beforeLoad reads only the runtime flag
// overrides (#1322) and redirects to the business dashboard when the flag is OFF, so a
// direct URL can't reach the unreleased surface. The stub branches on the query key so
// the overrides query returns the seeded overrides.
function runGuard(overrides: FeatureFlagOverrides = {}): Promise<unknown> {
  const ensureQueryData = async (opts: { queryKey: readonly unknown[] }) =>
    opts.queryKey[0] === 'feature-flags' ? overrides : undefined
  const context = { queryClient: { ensureQueryData } }
  return (Route.options.beforeLoad as (arg: unknown) => Promise<unknown>)({
    context,
    params: { locale: 'en' },
  })
}

describe('business rental-terms route guard (flag-gated)', () => {
  it('redirects to the business dashboard when OPERATOR_TERMS is off', async () => {
    try {
      await runGuard()
      expect.unreachable('guard should have redirected')
    } catch (error) {
      expect(isRedirect(error)).toBe(true)
      expect((error as { options?: { to?: string } }).options?.to).toBe('/$locale/dashboard')
    }
  })

  it('admits when a runtime override turns OPERATOR_TERMS on', async () => {
    await expect(runGuard({ OPERATOR_TERMS: true })).resolves.toBeUndefined()
  })
})
