import { BOOKING_STATUSES, type BookingStatus } from '@kuruma/shared/enums'
import { Hono } from 'hono'
import { requireAuth, requirePlatformAdmin, requireUser, toCallerContext } from '../middleware/auth'
import type { AdminBookingListInput, AdminBookingService } from '../services/admin-booking'
import { fail, ok, parseDateRange, parseLimit } from './helpers'

function isBookingStatus(value: string): value is BookingStatus {
  return (BOOKING_STATUSES as readonly string[]).includes(value)
}

/**
 * Platform-admin cross-operator booking oversight (#1092). Cross-tenant by
 * nature, so `requireAuth` gates the path and `requirePlatformAdmin` narrows it
 * to PLATFORM_ADMIN — OPERATOR_* / RENTER / PARTNER are all rejected (PARTNER is
 * excluded deliberately; the un-gated `GET /bookings` PARTNER exposure is #1119)
 * — and the service re-asserts the gate as defence-in-depth. Filters: operator,
 * bookingCode, customer (name/email), status, date range, cursor pagination.
 */
export function createAdminBookingRoutes(service: AdminBookingService) {
  const app = new Hono()
  app.use('/admin/bookings', requireAuth())

  return app.get('/admin/bookings', async (c) => {
    const ctx = toCallerContext(requireUser(c))
    requirePlatformAdmin(ctx)

    const status = c.req.query('status')
    if (status !== undefined && !isBookingStatus(status)) {
      return fail(c, `Invalid status — expected one of ${BOOKING_STATUSES.join(', ')}`, 400)
    }

    const dateRange = parseDateRange(c, false)
    if (!dateRange.ok) return dateRange.response

    const pg = parseLimit(c, { defaultLimit: 20 })
    if (!pg.ok) return pg.response

    const input: AdminBookingListInput = { limit: pg.limit }
    const operatorId = c.req.query('operatorId')
    const bookingCode = c.req.query('bookingCode')
    const customer = c.req.query('customer')
    const cursor = c.req.query('cursor')
    if (operatorId) input.operatorId = operatorId
    if (bookingCode) input.bookingCode = bookingCode
    if (customer) input.customer = customer
    if (status) input.status = status
    if (cursor) input.cursor = cursor
    if (dateRange.from && dateRange.to) {
      input.from = dateRange.from
      input.to = dateRange.to
    }

    const result = await service.list(ctx, input)
    return ok(c, result)
  })
}
