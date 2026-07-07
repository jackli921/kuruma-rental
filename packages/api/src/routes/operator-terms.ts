import {
  platformAdminSaveOperatorTermsDraftSchema,
  saveOperatorTermsDraftSchema,
} from '@kuruma/shared/validators/consent-documents'
import { Hono } from 'hono'
import { FLEET_WRITE_ROLES, requireAuth, requireUser, toCallerContext } from '../middleware/auth'
import type { OperatorTermsService } from '../services/operator-terms'
import type { ResolveWriteOperatorId } from '../tenancy'
import { fail, ok, parseScopedCreate, resolveReadOperatorTarget } from './helpers'

export function createOperatorTermsRoutes(
  service: OperatorTermsService,
  resolveWriteOperatorId: ResolveWriteOperatorId,
) {
  const app = new Hono()

  // Operator-private authoring surface: auth gates every path; the FLEET_WRITE
  // role gate (below) rejects RENTER/PARTNER. An admin without a picked operator
  // sees an empty list; a write without one is 422 (global OperatorRequiredError).
  app.use('/operator-terms', requireAuth())
  app.use('/operator-terms/*', requireAuth())

  return app
    .get('/operator-terms', async (c) => {
      const user = requireUser(c)
      if (!FLEET_WRITE_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)
      const ctx = toCallerContext(user)
      // operator → own tenant; admin → ?operatorId= (or nothing to show); none → nothing.
      const operatorId = resolveReadOperatorTarget(ctx, c.req.query('operatorId'))
      if (!operatorId) return ok(c, [])
      const result = await service.list(operatorId)
      if (!result.ok) return fail(c, result.error, result.status)
      return ok(c, result.versions)
    })
    .post('/operator-terms', async (c) => {
      const user = requireUser(c)
      if (!FLEET_WRITE_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)
      const ctx = toCallerContext(user)
      const parsed = await parseScopedCreate(
        c,
        ctx,
        {
          operator: saveOperatorTermsDraftSchema,
          admin: platformAdminSaveOperatorTermsDraftSchema,
        },
        resolveWriteOperatorId,
      )
      if (!parsed.ok) return parsed.response
      const result = await service.saveDraft(parsed.operatorId, parsed.data, new Date())
      if (!result.ok) return fail(c, result.error, result.status)
      return ok(c, result.version, 201)
    })
    .post('/operator-terms/:version/publish', async (c) => {
      const user = requireUser(c)
      if (!FLEET_WRITE_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)
      const ctx = toCallerContext(user)
      // Throws OperatorRequiredError (→ 422 via setupGlobalHandlers) for an admin
      // with no ?operatorId=; an operator resolves to its own tenant.
      const operatorId = await resolveWriteOperatorId(ctx, c.req.query('operatorId'))
      const result = await service.publish(operatorId, c.req.param('version'), new Date())
      if (!result.ok) return fail(c, result.error, result.status)
      return ok(c, result.version)
    })
    .delete('/operator-terms/:version', async (c) => {
      const user = requireUser(c)
      if (!FLEET_WRITE_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)
      const ctx = toCallerContext(user)
      const operatorId = await resolveWriteOperatorId(ctx, c.req.query('operatorId'))
      const result = await service.archive(operatorId, c.req.param('version'), new Date())
      if (!result.ok) return fail(c, result.error, result.status)
      return ok(c, result.version)
    })
}
