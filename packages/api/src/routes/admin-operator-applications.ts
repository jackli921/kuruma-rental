import { OPERATOR_APPLICATION_STATUSES } from '@kuruma/shared/enums'
import type { OperatorApplicationStatus } from '@kuruma/shared/enums'
import { Hono } from 'hono'
import { z } from 'zod'
import { requirePlatformAdmin, requireUser, toCallerContext } from '../middleware/auth'
import type { OperatorApplicationService } from '../services/operator-application'
import { fail, ok, parseBody, parseId } from './helpers'

// Type guard over the closed status set: a query param is an untrusted string, so
// narrow it to the enum before it reaches the service (guard over an `as` cast).
function isOperatorApplicationStatus(value: string): value is OperatorApplicationStatus {
  return (OPERATOR_APPLICATION_STATUSES as readonly string[]).includes(value)
}

/**
 * Platform-admin governance surface for operator onboarding applications (#1277).
 *
 * A dedicated `/admin/operator-applications` surface — deliberately separate from
 * the public `/operator-applications` submission endpoint. Cross-tenant by nature,
 * gated by two layers: the app-level `/admin/*` requireAuth 401s anon callers, and
 * each handler's `requirePlatformAdmin` narrows to PLATFORM_ADMIN (OPERATOR_* /
 * RENTER / PARTNER → 403).
 *
 * Rejection records the reviewerUserId + rejectionReason on the application row and
 * emits an audit event; the service throws NotFoundError for a missing or
 * non-PENDING id which the global onError maps to 404.
 *
 * Approval provisions the operator + OPERATOR_OWNER invite and returns the one-time
 * invite link for the admin to forward to the applicant. Returns 404 for an unknown
 * id and 409 when the application is already reviewed or the contact email is in use.
 */
export function createAdminOperatorApplicationRoutes(service: OperatorApplicationService) {
  const app = new Hono()

  return app
    .get('/admin/operator-applications', async (c) => {
      const ctx = toCallerContext(requireUser(c))
      requirePlatformAdmin(ctx)

      const statusParam = c.req.query('status')
      if (statusParam !== undefined && !isOperatorApplicationStatus(statusParam)) {
        // Reject unknown status up front: a bad filter should be a clean 400, not a
        // silent empty result set indistinguishable from "no matching rows".
        return fail(c, 'invalid status', 400)
      }
      const rows = await service.list(statusParam)
      return ok(c, rows)
    })
    .post('/admin/operator-applications/:id/reject', async (c) => {
      const ctx = toCallerContext(requireUser(c))
      requirePlatformAdmin(ctx)

      const idr = parseId(c)
      if (!idr.ok) return idr.response

      const parsed = await parseBody(
        c,
        // Cap mirrors the public form's `message` bound (shared validator) so the
        // admin reason can't write unbounded text into the `text` column.
        z.object({ rejectionReason: z.string().trim().min(1).max(2000) }),
      )
      if (!parsed.ok) return parsed.response

      // NotFoundError (missing or non-PENDING id) propagates to the global onError → 404.
      const row = await service.reject(idr.id, requireUser(c).id, parsed.data.rejectionReason)
      return ok(c, row)
    })
    .post('/admin/operator-applications/:id/approve', async (c) => {
      const ctx = toCallerContext(requireUser(c))
      requirePlatformAdmin(ctx)

      const idr = parseId(c)
      if (!idr.ok) return idr.response
      // NotFoundError (unknown id) → 404. ConflictError (already reviewed / C1 email-in-use /
      // concurrent race) → 409. No request body: approval takes no reviewer input.
      const result = await service.approve(idr.id, requireUser(c).id)
      return ok(c, {
        operatorId: result.operatorId,
        inviteUrl: result.inviteUrl,
        expiresAt: result.expiresAt,
      })
    })
}
