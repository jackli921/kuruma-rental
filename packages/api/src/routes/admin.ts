import { createOperatorSchema } from '@kuruma/shared/validators/operator'
import { createProviderInviteSchema } from '@kuruma/shared/validators/provider-invite'
import { Hono } from 'hono'
import { requirePlatformAdmin, requireUser, toCallerContext } from '../middleware/auth'
import type { ConsentEvidenceService } from '../services/consent-evidence'
import type { OperatorService } from '../services/operator'
import { OperatorNotFoundError, type ProviderInviteService } from '../services/provider-invite'
import { fail, ok, parseBody, parseId } from './helpers'

export function createAdminRoutes(
  operatorService: OperatorService,
  providerInviteService: ProviderInviteService,
  consentEvidenceService: ConsentEvidenceService,
) {
  // Platform-admin only. Operator bootstrap is a platform-governance action;
  // legacy STAFF/ADMIN do not qualify (proposal §9 item 23). Each handler calls
  // the canonical `requirePlatformAdmin` from auth/guards.ts (single source of
  // truth — no local re-impl) after `requireUser`; the global error handler
  // maps the thrown ForbiddenError to 403.
  const app = new Hono()

  return (
    app
      .post('/admin/operators', async (c) => {
        const ctx = toCallerContext(requireUser(c))
        requirePlatformAdmin(ctx)

        const parsed = await parseBody(c, createOperatorSchema)
        if (!parsed.ok) return parsed.response

        const operator = await operatorService.create(ctx, parsed.data)
        return ok(c, operator, 201)
      })
      // #521 §7: mint an invite-backed operator grant. The plaintext token is
      // returned once here and only its sha256 hash is stored — never logged.
      .post('/admin/provider-invites', async (c) => {
        const ctx = toCallerContext(requireUser(c))
        requirePlatformAdmin(ctx)

        const parsed = await parseBody(c, createProviderInviteSchema)
        if (!parsed.ok) return parsed.response

        try {
          const created = await providerInviteService.createInvite(parsed.data, requireUser(c).id)
          return ok(c, created, 201)
        } catch (e) {
          if (e instanceof OperatorNotFoundError) return fail(c, 'Operator not found', 404)
          throw e
        }
      })
      // #877 Task 8: platform-admin consent evidence export for legal/audit review.
      .get('/admin/consent/acceptances/:id/evidence', async (c) => {
        const ctx = toCallerContext(requireUser(c))
        requirePlatformAdmin(ctx)

        // Validate the uuid at the boundary so a malformed id is a clean 400 —
        // the service tolerates an unknown id (returns undefined → 404) and can't
        // otherwise distinguish bad input from missing row.
        const idResult = parseId(c)
        if (!idResult.ok) return idResult.response

        const evidence = await consentEvidenceService.getConsentEvidence(idResult.id)
        if (!evidence) return fail(c, 'ACCEPTANCE_NOT_FOUND', 404)
        return ok(c, evidence)
      })
  )
}
