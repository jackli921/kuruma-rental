import {
  createBookingSchema,
  substituteVehicleSchema,
  updateBookingStatusSchema,
} from '@kuruma/shared/validators/booking'
import { Hono } from 'hono'
import { STAFF_ROLES, isOperatorRole, requireUser, toCallerContext } from '../middleware/auth'
import type { BookingFilters } from '../repositories/types'
import type { BookingService } from '../services/booking'
import { fail, ok, parseBody, parseDateRange, parseLimit } from './helpers'

export function createBookingRoutes(service: BookingService) {
  return new Hono()
    .get('/bookings', async (c) => {
      const ctx = toCallerContext(requireUser(c))

      const statusFilter = c.req.query('status')
      const vehicleIdFilter = c.req.query('vehicleId')
      const renterIdFilter = c.req.query('renterId')
      const expand = c.req.query('expand')
      const cursor = c.req.query('cursor')

      const dateRange = parseDateRange(c, false)
      if (!dateRange.ok) return dateRange.response

      const pg = parseLimit(c, { defaultLimit: 20 })
      if (!pg.ok) return pg.response
      const { limit } = pg

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

      const parsed = await parseBody(c, createBookingSchema)
      if (!parsed.ok) return parsed.response

      // Staff/admin can create bookings on behalf of a customer (manual bookings).
      // Non-staff always book as themselves and source is forced to DIRECT
      // to prevent advance-booking-hours bypass via source=MANUAL.
      const isStaff = STAFF_ROLES.has(ctx.role)
      const renterId = isStaff && parsed.data.renterId ? parsed.data.renterId : ctx.userId
      const source = isStaff ? parsed.data.source : 'DIRECT'

      const createResult = await service.create(ctx, {
        requestedVehicleId: parsed.data.requestedVehicleId,
        pickupLocationId: parsed.data.pickupLocationId,
        dropoffLocationId: parsed.data.dropoffLocationId,
        insuranceOptionId: parsed.data.insuranceOptionId ?? null,
        renterId,
        startAt: new Date(parsed.data.startAt),
        endAt: new Date(parsed.data.endAt),
        source,
        externalId: parsed.data.externalId ?? null,
        notes: parsed.data.notes ?? null,
        idempotencyKey: parsed.data.idempotencyKey ?? null,
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

      const parsed = await parseBody(c, updateBookingStatusSchema)
      if (!parsed.ok) return parsed.response

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
    .post('/bookings/:id/substitute', async (c) => {
      const ctx = toCallerContext(requireUser(c))

      // §5.5: substitution is operator-only. Renters never reassign their own
      // vehicle (403). Cross-operator bookings 404 at the service (no leak).
      if (!isOperatorRole(ctx.role)) {
        return fail(c, 'Only operators can substitute a vehicle', 403)
      }

      const parsed = await parseBody(c, substituteVehicleSchema)
      if (!parsed.ok) return parsed.response

      const result = await service.substitute(
        ctx,
        c.req.param('id'),
        parsed.data.newVehicleId,
        parsed.data.reason ?? null,
      )
      if (!result.ok) {
        return fail(c, result.error, result.status)
      }

      return ok(c, result.booking)
    })
}
