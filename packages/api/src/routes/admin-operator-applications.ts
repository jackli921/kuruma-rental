import { OPERATOR_APPLICATION_STATUSES } from '@kuruma/shared/enums'
import type { OperatorApplicationStatus } from '@kuruma/shared/enums'
import { Hono } from 'hono'
import { z } from 'zod'
import { requirePlatformAdmin, requireUser, toCallerContext } from '../middleware/auth'
import type { OperatorApplicationService } from '../services/operator-application'
import { fail, ok, parseBody } from './helpers'

// Type guard over the closed status set: a query param is an untrusted string, so
// narrow it to the enum before it reaches the service (guard over an `as` cast).
function isOperatorApplicationStatus(value: string): value is OperatorApplicationStatus {
  return (OPERATOR_APPLICATION_STATUSES as readonly string[]).includes(value)
}

/**
 * Platform-admin governance surface for operator onboarding applications (#1277).
 *
 * A dedicated `/admin/operator-applications` surface — deliberately separate from
 * the public `/operator-applications` submission endpoint. Cross-tenant by nature:
 * the app-level `/admin/*` requireAuth 401s anon callers, `requirePlatformAdmin`
 * narrows to PLATFORM_ADMIN (OPERATOR_* / RENTER / PARTNER → 403), and the service
 * re-asserts the gate as defence-in-depth.
 *
 * Rejection records the reviewerUserId + rejectionReason on the application row and
 * emits an audit event; the service throws NotFoundError for a missing or
 * non-PENDING id which the global onError maps to 404.
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

      const parsed = await parseBody(c, z.object({ rejectionReason: z.string().trim().min(1) }))
      if (!parsed.ok) return parsed.response

      // NotFoundError (missing or non-PENDING id) propagates to the global onError → 404.
      const row = await service.reject(
        c.req.param('id'),
        requireUser(c).id,
        parsed.data.rejectionReason,
      )
      return ok(c, row)
    })
}
