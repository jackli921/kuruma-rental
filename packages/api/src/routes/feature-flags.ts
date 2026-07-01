import { isFeatureFlagKey } from '@kuruma/shared/feature-flags/registry'
import { setFeatureFlagSchema } from '@kuruma/shared/validators/feature-flags'
import { Hono } from 'hono'
import { requirePlatformAdmin, requireUser, toCallerContext } from '../middleware/auth'
import type { FeatureFlagsService } from '../services/feature-flags'
import { fail, ok, parseBody } from './helpers'

/**
 * Runtime feature-flag control plane (epic: runtime feature flags).
 *
 * The GET is public: the web needs flags before login and the values are not
 * secret — they already ship in the bundle as build-time defaults. It returns a
 * SPARSE override map; the web merges it over its own defaults
 * (effective = override ?? build default ?? false).
 *
 * The PATCH lives under `/admin/*`, so it inherits the app-level requireAuth +
 * requirePlatformMember floor; the handler adds the PLATFORM_ADMIN write gate
 * (mirrors admin-operators). Still visibility-only, never an authz boundary.
 */
export function createFeatureFlagsRoutes(service: FeatureFlagsService) {
  const app = new Hono()

  return app
    .get('/feature-flags', async (c) => {
      return ok(c, { overrides: await service.getOverrides() })
    })
    .patch('/admin/feature-flags/:key', async (c) => {
      const ctx = toCallerContext(requireUser(c))
      requirePlatformAdmin(ctx)

      const key = c.req.param('key')
      if (!isFeatureFlagKey(key)) return fail(c, 'Unknown feature flag', 400)

      const parsed = await parseBody(c, setFeatureFlagSchema)
      if (!parsed.ok) return parsed.response

      await service.setOverride(ctx, key, parsed.data.enabled)
      return ok(c, { key, enabled: parsed.data.enabled })
    })
}
