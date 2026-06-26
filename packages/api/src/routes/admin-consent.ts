import { consentGovernanceFiltersSchema } from '@kuruma/shared/types/consent-governance'
import { Hono } from 'hono'
import { requireAuth, requirePlatformAdmin, requireUser, toCallerContext } from '../middleware/auth'
import type { ConsentGovernanceService } from '../services/consent-governance'
import { fail, ok } from './helpers'

/**
 * Platform-admin consent-acceptance governance browse (#1091, epic #1075 slice 5).
 * A NEW admin list endpoint — the existing `GET /consent/status` is self-scoped to
 * the caller and is NOT widened. `requireAuth` gates the path (401 unauth) and
 * `requirePlatformAdmin` narrows it to PLATFORM_ADMIN (403 otherwise); the service
 * re-asserts the same gate as defence-in-depth. Read-only: filter the append-only
 * ledger, never mutate it.
 */
export function createAdminConsentRoutes(service: ConsentGovernanceService) {
  const app = new Hono()
  app.use('/admin/consent/acceptances', requireAuth())

  return app.get('/admin/consent/acceptances', async (c) => {
    const ctx = toCallerContext(requireUser(c))
    requirePlatformAdmin(ctx)

    const parsed = consentGovernanceFiltersSchema.safeParse({
      userId: c.req.query('userId'),
      consentType: c.req.query('consentType'),
      version: c.req.query('version'),
      acceptedFrom: c.req.query('acceptedFrom'),
      acceptedTo: c.req.query('acceptedTo'),
    })
    if (!parsed.success) return fail(c, 'Invalid filters', 400)

    const data = await service.list(ctx, parsed.data)
    return ok(c, data)
  })
}
