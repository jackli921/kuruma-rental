import { Hono } from 'hono'
import {
  MANAGEMENT_READ_ROLES,
  requireAuth,
  requireUser,
  toCallerContext,
} from '../middleware/auth'
import type { AddOnTemplateService } from '../services/add-on-template'
import { fail, ok, parseLocale, resolveReadOperatorTarget } from './helpers'

/**
 * The platform-owned add-on TEMPLATE picker (catalog i18n, epic #385). An
 * operator picks a template when authoring an add-on, so the catalog is global
 * (no tenant scope) but management-gated: RENTER/PARTNER are rejected, mirroring
 * the operator-private `/add-ons` reads. Read-only — the catalog is curated at
 * the platform layer, not operator-writable here.
 *
 * P1-3: the list EXCLUDES templates the target operator already offers on an
 * ACTIVE add-on, so the picker can never surface a duplicate. The target is the
 * caller's own tenant (operator session) or `?operatorId` (bypass caller); an
 * unscoped bypass read gets the full platform list.
 */
export function createAddOnTemplateRoutes(service: AddOnTemplateService) {
  const app = new Hono()

  app.use('/add-on-templates', requireAuth())

  return app.get('/add-on-templates', async (c) => {
    const user = requireUser(c)
    if (!MANAGEMENT_READ_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)

    const locale = parseLocale(c)
    if (!locale.ok) return locale.response

    const targetOperatorId = resolveReadOperatorTarget(
      toCallerContext(user),
      c.req.query('operatorId'),
    )
    return ok(c, await service.listForPicker(locale.locale, targetOperatorId))
  })
}
