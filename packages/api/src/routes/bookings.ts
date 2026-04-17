import { createBookingSchema, updateBookingStatusSchema } from '@kuruma/shared/validators/booking'
import { Hono } from 'hono'
import { STAFF_ROLES, requireUser, toCallerContext } from '../middleware/auth'
import type { BookingFilters } from '../repositories/types'
import type { BookingService } from '../services/booking'
import { fail, ok, parseDateRange } from './helpers'

export function createBookingRoutes(service: BookingService) {
  return new Hono()
    .get('/bookings', async (c) => {
      const ctx = toCallerContext(requireUser(c))

      const statusFilter = c.req.query('status')
      const vehicleIdFilter = c.req.query('vehicleId')
      const renterIdFilter = c.req.query('renterId')
      const expand = c.req.query('expand')
      const limitParam = c.req.query('limit')
      const cursor = c.req.query('cursor')

      const dateRange = parseDateRange(c, false)
      if (!dateRange.ok) return dateRange.response

      // Validate limit: 1-100, default 20
      const limit = limitParam ? Number.parseInt(limitParam, 10) : 20
      if (Number.isNaN(limit) || limit < 1 || limit > 100) {
        return fail(c, 'limit must be between 1 and 100', 400)
      }

      const filters: BookingFilters = { limit }
      if (cursor) filters.cursor = cursor
      if (statusFilter) filters.status = statusFilter
      if (vehicleIdFilter) filters.vehicleId = vehicleIdFilter
      if (renterIdFilter) filters.renterId = renterIdFilter
      if (dateRange.from && dateRange.to) {
        filters.from = dateRange.from
        filters.to = dateRange.to
      }

      // Ownership scoping is handled by CallerContext in the repository layer.
      // No manual filtering needed here.

      if (expand === 'vehicle') {
        const result = await service.findAllWithVehiclesPaginated(ctx, filters)
        return ok(c, result.data, 200, { nextCursor: result.nextCursor })
      }

      if (expand === 'renter') {
        const result = await service.findAllWithRentersPaginated(ctx, filters)
        return ok(c, result.data, 200, { nextCursor: result.nextCursor })
      }

      const result = await service.findAllPaginated(ctx, filters)
      return ok(c, result.data, 200, { nextCursor: result.nextCursor })
    })
    .get('/bookings/:id', async (c) => {
      const ctx = toCallerContext(requireUser(c))

      const booking = await service.findById(ctx, c.req.param('id'))
      if (!booking) {
        return fail(c, 'Booking not found', 404)
      }

      return ok(c, booking)
    })
    .post('/bookings', async (c) => {
      const ctx = toCallerContext(requireUser(c))

      const body = await c.req.json()
      const result = createBookingSchema.safeParse(body)

      if (!result.success) {
        return fail(c, result.error.flatten().fieldErrors, 400)
      }

      // Staff/admin can create bookings on behalf of a customer (manual bookings).
      // Non-staff always book as themselves and source is forced to DIRECT
      // to prevent advance-booking-hours bypass via source=MANUAL.
      const isStaff = STAFF_ROLES.has(ctx.role)
      const renterId = isStaff && result.data.renterId ? result.data.renterId : ctx.userId
      const source = isStaff ? result.data.source : 'DIRECT'

      const createResult = await service.create(ctx, {
        vehicleId: result.data.vehicleId,
        renterId,
        startAt: new Date(result.data.startAt),
        endAt: new Date(result.data.endAt),
        source,
        externalId: result.data.externalId ?? null,
        notes: result.data.notes ?? null,
        idempotencyKey: result.data.idempotencyKey ?? null,
      })

      if (!createResult.ok) {
        return fail(c, createResult.error, createResult.status, {
          ...(createResult.code ? { code: createResult.code } : {}),
          ...(createResult.details ? { details: createResult.details } : {}),
        })
      }

      return ok(c, createResult.booking, createResult.status ?? 201)
    })
    .patch('/bookings/:id/status', async (c) => {
      const ctx = toCallerContext(requireUser(c))

      const body = await c.req.json()
      const parsed = updateBookingStatusSchema.safeParse(body)
      if (!parsed.success) {
        return fail(c, parsed.error.flatten().fieldErrors, 400)
      }

      const result = await service.updateStatus(ctx, c.req.param('id'), parsed.data.status)
      if (!result.ok) {
        return fail(c, result.error, result.status)
      }

      return ok(c, result.booking)
    })
    .post('/bookings/:id/cancel', async (c) => {
      const ctx = toCallerContext(requireUser(c))

      const result = await service.cancel(ctx, c.req.param('id'))
      if (!result.ok) {
        return fail(c, result.error, result.status)
      }

      return ok(c, result.booking, 200, { cancellation: result.cancellation })
    })
}
