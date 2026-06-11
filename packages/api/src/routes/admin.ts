import { createOperatorSchema } from '@kuruma/shared/validators/operator'
import { createProviderInviteSchema } from '@kuruma/shared/validators/provider-invite'
import { Hono } from 'hono'
import { requireUser, toCallerContext } from '../middleware/auth'
import type { OperatorService } from '../services/operator'
import type { ProviderInviteService } from '../services/provider-invite'
import { fail, ok, parseBody } from './helpers'

export function createAdminRoutes(
  operatorService: OperatorService,
  providerInviteService: ProviderInviteService,
) {
  const app = new Hono()

  // Platform-admin only. Operator bootstrap is a platform-governance action;
  // legacy STAFF/ADMIN do not qualify (proposal §9 item 23). Mounted behind
  // the app-level requireAuth, so unauthenticated requests are 401'd first.
  app.use('/admin/*', requirePlatformAdmin)

  return (
    app
      .post('/admin/operators', async (c) => {
        const parsed = await parseBody(c, createOperatorSchema)
        if (!parsed.ok) return parsed.response

        const ctx = toCallerContext(requireUser(c))
        const operator = await operatorService.create(ctx, parsed.data)
        return ok(c, operator, 201)
      })
      // #521 §7: mint an invite-backed operator grant. The plaintext token is
      // returned once here and only its sha256 hash is stored — never logged.
      .post('/admin/provider-invites', async (c) => {
        const parsed = await parseBody(c, createProviderInviteSchema)
        if (!parsed.ok) return parsed.response

        const created = await providerInviteService.createInvite(parsed.data, requireUser(c).id)
        return ok(c, created, 201)
      })
  )
}

async function requirePlatformAdmin(
  c: Parameters<Parameters<Hono['use']>[1]>[0],
  next: () => Promise<void>,
) {
  const user = requireUser(c)
  if (user.role !== 'PLATFORM_ADMIN') {
    return fail(c, 'Forbidden', 403)
  }
  return next()
}
