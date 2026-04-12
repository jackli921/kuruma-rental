import { createBookingSchema } from '@kuruma/shared/validators/booking'
import { Hono } from 'hono'
import type { BookingService } from '../services/booking'
import { fail, ok, parseDateRange } from './helpers'

export function createBookingRoutes(service: BookingService): Hono {
  const bookings = new Hono()

  bookings.get('/bookings', async (c) => {
    const statusFilter = c.req.query('status')
    const vehicleIdFilter = c.req.query('vehicleId')
    const renterIdFilter = c.req.query('renterId')
    const expand = c.req.query('expand')

    const dateRange = parseDateRange(c, false)
    if (!dateRange.ok) return dateRange.response

    const filters: {
      status?: string
      vehicleId?: string
      renterId?: string
      from?: Date
      to?: Date
    } = {}
    if (statusFilter) filters.status = statusFilter
    if (vehicleIdFilter) filters.vehicleId = vehicleIdFilter
    if (renterIdFilter) filters.renterId = renterIdFilter
    if (dateRange.from && dateRange.to) {
      filters.from = dateRange.from
      filters.to = dateRange.to
    }

    const active = Object.keys(filters).length > 0 ? filters : undefined

    if (expand === 'vehicle') {
      const expanded = await service.findAllWithVehicles(active)
      return ok(c, expanded)
    }

    const results = await service.findAll(active)
    return ok(c, results)
  })

  bookings.get('/bookings/:id', async (c) => {
    const booking = await service.findById(c.req.param('id'))
    if (!booking) {
      return fail(c, 'Booking not found', 404)
    }
    return ok(c, booking)
  })

  bookings.post('/bookings', async (c) => {
    const body = await c.req.json()
    const result = createBookingSchema.safeParse(body)

    if (!result.success) {
      return fail(c, result.error.flatten().fieldErrors, 400)
    }

    const renterId = body.renterId as string | undefined
    if (!renterId) {
      return fail(c, { renterId: ['Renter ID is required'] }, 400)
    }

    const createResult = await service.create({
      vehicleId: result.data.vehicleId,
      renterId,
      startAt: new Date(result.data.startAt),
      endAt: new Date(result.data.endAt),
      source: result.data.source,
      externalId: result.data.externalId,
      notes: result.data.notes,
    })

    if (!createResult.ok) {
      return fail(c, createResult.error, createResult.status, {
        ...(createResult.code ? { code: createResult.code } : {}),
        ...(createResult.details ? { details: createResult.details } : {}),
      })
    }

    return ok(c, createResult.booking, 201)
  })

  bookings.patch('/bookings/:id/status', async (c) => {
    const body = await c.req.json()
    const requestedStatus = body.status as string

    const result = await service.updateStatus(c.req.param('id'), requestedStatus)
    if (!result.ok) {
      return fail(c, result.error, result.status)
    }

    return ok(c, result.booking)
  })

  bookings.post('/bookings/:id/cancel', async (c) => {
    const result = await service.cancel(c.req.param('id'))
    if (!result.ok) {
      return fail(c, result.error, result.status)
    }

    return ok(c, result.booking, 200, { cancellation: result.cancellation })
  })

  return bookings
}
