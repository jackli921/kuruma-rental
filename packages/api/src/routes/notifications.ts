import { Hono } from 'hono'
import {
  MANAGEMENT_READ_ROLES,
  requireAuth,
  requireUser,
  toCallerContext,
} from '../middleware/auth'
import type { NotificationLogFilters } from '../services/filters'
import type { NotificationService } from '../services/notification'
import { fail, ok, parseCrossOperatorRead, parseId } from './helpers'

/**
 * Operator-portal surface for the outbound-notification ledger (#393): a scoped
 * list + a manual resend. notification_log is operator-private, so — like
 * operators.ts:17-18 — auth is gated IN-ROUTE (P1): the index.ts app-level
 * allow-list only covers known paths and would leave a new mount silently open.
 */
export function createNotificationRoutes(service: NotificationService) {
  const app = new Hono()

  app.use('/notifications', requireAuth())
  app.use('/notifications/*', requireAuth()) // requireUser() in each handler is the 401 backstop

  return app
    .get('/notifications', async (c) => {
      const user = requireUser(c)
      // Private ledger: reject RENTER/PARTNER here AND defence-in-depth at the repo.
      if (!MANAGEMENT_READ_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)

      const ctx = toCallerContext(user)
      const filters: NotificationLogFilters = {}
      const bookingId = c.req.query('bookingId')
      if (bookingId) filters.bookingId = bookingId

      return ok(c, await service.findAll(ctx, parseCrossOperatorRead(c), filters))
    })
    .post('/notifications/:id/resend', async (c) => {
      const user = requireUser(c)
      if (!MANAGEMENT_READ_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)

      const idResult = parseId(c)
      if (!idResult.ok) return idResult.response

      // A cross-operator id resolves to 404 (not 403) in the service — no
      // tenant-existence leak. The atomic claim makes a double-click send once.
      const result = await service.resend(toCallerContext(user), idResult.id)
      if (!result.ok) return fail(c, result.error, result.status)
      // `outcome` lets the portal distinguish a real re-send from a no-op
      // ("already in progress" / "already sent") instead of a blanket green (#485).
      return ok(c, { status: result.status, outcome: result.outcome })
    })
}
