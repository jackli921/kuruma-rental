import { createBookingSchema, updateBookingStatusSchema } from '@kuruma/shared/validators/booking'
import { Hono } from 'hono'
import { PRIVILEGED_ROLES, requireUser } from '../middleware/auth'
import type { BookingFilters } from '../repositories/types'
import type { BookingService } from '../services/booking'
import { fail, ok, parseDateRange } from './helpers'

export function createBookingRoutes(service: BookingService) {
  return new Hono()
    .get('/bookings', async (c) => {
      const user = requireUser(c)

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

      // Ownership: non-privileged users can only see their own bookings
      if (!PRIVILEGED_ROLES.has(user.role)) {
        filters.renterId = user.id
      }

      if (expand === 'vehicle') {
        const result = await service.findAllWithVehiclesPaginated(filters)
        return ok(c, result.data, 200, { nextCursor: result.nextCursor })
      }

      const result = await service.findAllPaginated(filters)
      return ok(c, result.data, 200, { nextCursor: result.nextCursor })
    })
    .get('/bookings/:id', async (c) => {
      const user = requireUser(c)

      const booking = await service.findById(c.req.param('id'))
      if (!booking) {
        return fail(c, 'Booking not found', 404)
      }

      // Ownership: non-privileged users can only view their own bookings (404 to avoid info leak)
      if (!PRIVILEGED_ROLES.has(user.role) && booking.renterId !== user.id) {
        return fail(c, 'Booking not found', 404)
      }

      return ok(c, booking)
    })
    .post('/bookings', async (c) => {
      const user = requireUser(c)

      const body = await c.req.json()
      const result = createBookingSchema.safeParse(body)

      if (!result.success) {
        return fail(c, result.error.flatten().fieldErrors, 400)
      }

      // Actor derivation: renterId comes from JWT, never from body
      const createResult = await service.create({
        vehicleId: result.data.vehicleId,
        renterId: user.id,
        startAt: new Date(result.data.startAt),
        endAt: new Date(result.data.endAt),
        source: result.data.source,
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
      const user = requireUser(c)

      const booking = await service.findById(c.req.param('id'))
      if (!booking) {
        return fail(c, 'Booking not found', 404)
      }

      // Ownership: allow privileged roles or the booking owner (404 to avoid info leak)
      if (!PRIVILEGED_ROLES.has(user.role) && booking.renterId !== user.id) {
        return fail(c, 'Booking not found', 404)
      }

      const body = await c.req.json()
      const parsed = updateBookingStatusSchema.safeParse(body)
      if (!parsed.success) {
        return fail(c, parsed.error.flatten().fieldErrors, 400)
      }

      const result = await service.updateStatus(c.req.param('id'), parsed.data.status)
      if (!result.ok) {
        return fail(c, result.error, result.status)
      }

      return ok(c, result.booking)
    })
    .post('/bookings/:id/cancel', async (c) => {
      const user = requireUser(c)

      const booking = await service.findById(c.req.param('id'))
      if (!booking) {
        return fail(c, 'Booking not found', 404)
      }

      // Ownership: non-privileged users can only cancel their own bookings (404 to avoid info leak)
      if (!PRIVILEGED_ROLES.has(user.role) && booking.renterId !== user.id) {
        return fail(c, 'Booking not found', 404)
      }

      const result = await service.cancel(c.req.param('id'))
      if (!result.ok) {
        return fail(c, result.error, result.status)
      }

      return ok(c, result.booking, 200, { cancellation: result.cancellation })
    })
}
