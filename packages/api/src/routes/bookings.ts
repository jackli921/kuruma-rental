import {
  createBookingSchema,
  substituteVehicleSchema,
  updateBookingStatusSchema,
} from '@kuruma/shared/validators/booking'
import { Hono } from 'hono'
import {
  MANAGEMENT_READ_ROLES,
  STAFF_ROLES,
  isOperatorRole,
  requireUser,
  toCallerContext,
} from '../middleware/auth'
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
      // `expand` is a comma list (e.g. `vehicle,renter`); a single token still works.
      const expand = new Set(
        (c.req.query('expand') ?? '')
          .split(',')
          .map((token) => token.trim())
          .filter(Boolean),
      )
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

      if (expand.has('vehicle') && expand.has('renter')) {
        const result = await service.findAllWithVehiclesAndRentersPaginated(ctx, filters)
        return ok(c, result.data, 200, { nextCursor: result.nextCursor })
      }

      if (expand.has('vehicle')) {
        const result = await service.findAllWithVehiclesPaginated(ctx, filters)
        return ok(c, result.data, 200, { nextCursor: result.nextCursor })
      }

      if (expand.has('renter')) {
        const result = await service.findAllWithRentersPaginated(ctx, filters)
        return ok(c, result.data, 200, { nextCursor: result.nextCursor })
      }

      const result = await service.findAllPaginated(ctx, filters)
      return ok(c, result.data, 200, { nextCursor: result.nextCursor })
    })
    .get('/bookings/:id', async (c) => {
      const ctx = toCallerContext(requireUser(c))
      const id = c.req.param('id')

      // Mirror the list endpoint's `expand` parsing. A deep-linked trip-detail
      // page (#549) has no list-row data, so it requests `vehicle,renter` to
      // carry the assigned car + renter; the operator projection is preserved.
      const expand = new Set(
        (c.req.query('expand') ?? '')
          .split(',')
          .map((token) => token.trim())
          .filter(Boolean),
      )

      const booking =
        expand.has('vehicle') && expand.has('renter')
          ? await service.findByIdWithVehicleAndRenter(ctx, id)
          : await service.findById(ctx, id)
      if (!booking) {
        return fail(c, 'Booking not found', 404)
      }

      return ok(c, booking)
    })
    .get('/bookings/:id/events', async (c) => {
      const ctx = toCallerContext(requireUser(c))

      // §549: operator/management-only. The lifecycle log exposes actorId,
      // internal vehicle ids and the substitution reason; no renter UI consumes
      // a timeline today, so renters are rejected here (403) rather than served a
      // sanitized projection. Cross-tenant reads still 404 at the service.
      if (!MANAGEMENT_READ_ROLES.has(ctx.role)) {
        return fail(c, 'Only operators can view booking events', 403)
      }

      const events = await service.findEvents(ctx, c.req.param('id'))
      if (!events) {
        return fail(c, 'Booking not found', 404)
      }

      return ok(c, events)
    })
    .get('/bookings/:id/substitution-candidates', async (c) => {
      const ctx = toCallerContext(requireUser(c))

      // #616: feeds the operator-only substitute action, so it mirrors the
      // substitute route's gate — renters never swap a vehicle (403). The service
      // read is caller-scoped, so a cross-operator booking 404s (no leak).
      if (!isOperatorRole(ctx.role)) {
        return fail(c, 'Only operators can substitute a vehicle', 403)
      }

      const result = await service.substitutionCandidates(ctx, c.req.param('id'))
      if (!result.ok) {
        return fail(c, result.error, result.status)
      }

      return ok(c, result.candidates)
    })
    .post('/bookings', async (c) => {
      const ctx = toCallerContext(requireUser(c))

      const parsed = await parseBody(c, createBookingSchema)
      if (!parsed.ok) return parsed.response

      // Staff/admin can create bookings on behalf of a customer (manual bookings).
      // Non-staff always book as themselves and source is forced to DIRECT to
      // prevent advance-booking-hours bypass via source=MANUAL. OPERATOR_* are
      // deliberately NOT manual bookers: UserRepository is not tenant-scoped, so
      // letting an operator resolve an arbitrary renterId reopens the #396
      // cross-tenant user-enumeration vector (operator-user-isolation.test.ts).
      const isStaff = STAFF_ROLES.has(ctx.role)
      const renterId = isStaff && parsed.data.renterId ? parsed.data.renterId : ctx.userId
      const source = isStaff ? parsed.data.source : 'DIRECT'

      const createResult = await service.create(ctx, {
        requestedVehicleId: parsed.data.requestedVehicleId,
        pickupLocationId: parsed.data.pickupLocationId,
        dropoffLocationId: parsed.data.dropoffLocationId,
        insuranceOptionId: parsed.data.insuranceOptionId ?? null,
        addOnIds: parsed.data.addOnIds,
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
