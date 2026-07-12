import {
  platformAdminSaveOperatorTermsDraftSchema,
  saveOperatorTermsDraftSchema,
} from '@kuruma/shared/validators/consent-documents'
import { Hono } from 'hono'
import { z } from 'zod'
import { requireAuth, requireUser, toCallerContext } from '../middleware/auth'
import type { OperatorTermsService } from '../services/operator-terms'
import type { ResolveWriteOperatorId } from '../tenancy'
import {
  fail,
  ok,
  parseScopedCreate,
  requireFleetWriteRole,
  resolveReadOperatorTarget,
} from './helpers'

// Consent copy is authored for these locales (mirror routes/consent.ts). An
// unknown/missing `?locale=` resolves to `en` rather than flowing an unvalidated
// string into the resolver (which falls back to en anyway, but validate at the seam).
const presentationLocaleSchema = z.enum(['en', 'ja', 'zh']).catch('en')

export function createOperatorTermsRoutes(
  service: OperatorTermsService,
  resolveWriteOperatorId: ResolveWriteOperatorId,
  // #877 Slice B: server-side OPERATOR_TERMS gate. The renter read below 404s when
  // OFF, in lockstep with the booking write path (booking-creation.ts). Injected as
  // `() => featureFlagsService.isEnabled('OPERATOR_TERMS')` at the composition root.
  isOperatorTermsEnabled: () => Promise<boolean>,
) {
  const app = new Hono()

  // Auth gates every path. The authoring routes below add a FLEET_WRITE role gate
  // (rejects RENTER/PARTNER); the one exception is GET /operator-terms/published,
  // the renter-readable route the checkout modal fetches — auth-only, no role gate.
  //
  // Dark-flag scope (#877 Slice B): the renter read is gated by the server-side
  // OPERATOR_TERMS flag (`isOperatorTermsEnabled`, 404 when off) so it goes live in
  // lockstep with the booking write path (booking-creation.ts server-gates the same
  // flag). The AUTHORING routes stay ungated: they are auth + FLEET_WRITE only
  // (operators/admins), and the rows they create are INERT to renters until this
  // read + the write path light up together — so an early direct-API write surfaces
  // nothing. (Slice A's #1499 note is superseded: the flag now has a server reader.)
  app.use('/operator-terms', requireAuth())
  app.use('/operator-terms/*', requireAuth())

  return (
    app
      .get('/operator-terms', async (c) => {
        const user = requireUser(c)
        const denied = requireFleetWriteRole(c, user)
        if (denied) return denied
        const ctx = toCallerContext(user)
        // operator → own tenant; admin → ?operatorId= (or nothing to show); none → nothing.
        const operatorId = resolveReadOperatorTarget(ctx, c.req.query('operatorId'))
        if (!operatorId) return ok(c, [])
        const result = await service.list(operatorId)
        if (!result.ok) return fail(c, result.error, result.status)
        return ok(c, result.versions)
      })
      // #877 Slice B: renter-safe read for the checkout modal — auth-only (any signed-in
      // caller), NO requireFleetWriteRole. Returns the operator's latest published+
      // effective terms in `?locale=` (en fallback). 404 when the flag is OFF (dark, no
      // oracle) or the operator has no published terms. Resolves via the SAME service
      // path the booking tx uses, so display and enforcement cannot drift.
      .get('/operator-terms/published', async (c) => {
        if (!(await isOperatorTermsEnabled())) return fail(c, 'Not found', 404)
        const operatorId = c.req.query('operatorId')
        if (!operatorId) return fail(c, 'operatorId is required', 400)
        const locale = presentationLocaleSchema.parse(c.req.query('locale'))
        const result = await service.getPublished(operatorId, locale, new Date())
        if (!result.ok) return fail(c, result.error, result.status)
        return ok(c, result.doc)
      })
      .post('/operator-terms', async (c) => {
        const user = requireUser(c)
        const denied = requireFleetWriteRole(c, user)
        if (denied) return denied
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
        const denied = requireFleetWriteRole(c, user)
        if (denied) return denied
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
        const denied = requireFleetWriteRole(c, user)
        if (denied) return denied
        const ctx = toCallerContext(user)
        const operatorId = await resolveWriteOperatorId(ctx, c.req.query('operatorId'))
        const result = await service.archive(operatorId, c.req.param('version'), new Date())
        if (!result.ok) return fail(c, result.error, result.status)
        return ok(c, result.version)
      })
  )
}
