import type { FeatureFlagOverrides } from '@kuruma/shared/feature-flags/registry'
import { isRedirect } from '@tanstack/react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Route } from './messages'

// The operator inbox mirrors the renter messages guard: the `_business` role check is
// the parent's job; this adds the post-MVP visibility gate. It reads the session + the
// runtime flag overrides (#1322) and redirects home when messaging is hidden, EXCEPT
// for the platform admin (owner preview via the admin bypass). The stub branches on the
// query key so the overrides query and the session query return the right shapes.
function runGuard(
  role: string | undefined,
  overrides: FeatureFlagOverrides = {},
): Promise<unknown> {
  const session = role ? { user: { role } } : null
  const ensureQueryData = async (opts: { queryKey: readonly unknown[] }) =>
    opts.queryKey[0] === 'feature-flags' ? overrides : session
  const context = { queryClient: { ensureQueryData } }
  return (Route.options.beforeLoad as (arg: unknown) => Promise<unknown>)({
    context,
    params: { locale: 'en' },
  })
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('business messages route guard (admin bypass)', () => {
  it('redirects an operator home when messaging is hidden in beta', async () => {
    try {
      await runGuard('OPERATOR_OWNER')
      expect.unreachable('guard should have redirected the operator')
    } catch (error) {
      expect(isRedirect(error)).toBe(true)
    }
  })

  it('admits the platform admin so the owner can preview the inbox on beta', async () => {
    await expect(runGuard('PLATFORM_ADMIN')).resolves.toBeUndefined()
  })

  it('admits an operator when a runtime override turns messaging on even though the build default is off', async () => {
    vi.stubEnv('VITE_FEATURE_MESSAGING', undefined)
    await expect(runGuard('OPERATOR_OWNER', { MESSAGING: true })).resolves.toBeUndefined()
  })
})
