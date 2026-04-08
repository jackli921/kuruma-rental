import { VALID_BOOKING_TRANSITIONS } from '@kuruma/shared/db/schema'
import { createBookingSchema } from '@kuruma/shared/validators/booking'
import { Hono } from 'hono'
import type { BookingRepository } from '../repositories/types'

export function createBookingRoutes(repo: BookingRepository): Hono {
  const bookings = new Hono()

  bookings.get('/bookings', async (c) => {
    const statusFilter = c.req.query('status')
    const vehicleIdFilter = c.req.query('vehicleId')

    const filters: { status?: string; vehicleId?: string } = {}
    if (statusFilter) filters.status = statusFilter
    if (vehicleIdFilter) filters.vehicleId = vehicleIdFilter

    const results = await repo.findAll(Object.keys(filters).length > 0 ? filters : undefined)

    return c.json({ success: true, data: results })
  })

  bookings.get('/bookings/:id', async (c) => {
    const booking = await repo.findById(c.req.param('id'))
    if (!booking) {
      return c.json({ success: false, error: 'Booking not found' }, 404)
    }
    return c.json({ success: true, data: booking })
  })

  bookings.post('/bookings', async (c) => {
    const body = await c.req.json()
    const result = createBookingSchema.safeParse(body)

    if (!result.success) {
      return c.json({ success: false, error: result.error.flatten().fieldErrors }, 400)
    }

    const renterId = body.renterId as string | undefined
    if (!renterId) {
      return c.json({ success: false, error: { renterId: ['Renter ID is required'] } }, 400)
    }

    const endAt = new Date(result.data.endAt)
    const defaultBufferMs = 60 * 60 * 1000 // 60 minutes default
    const effectiveEndAt = new Date(endAt.getTime() + defaultBufferMs)

    const booking = await repo.create({
      renterId,
      vehicleId: result.data.vehicleId,
      startAt: new Date(result.data.startAt),
      endAt,
      effectiveEndAt,
      status: 'CONFIRMED',
      source: result.data.source,
      externalId: result.data.externalId ?? null,
      notes: result.data.notes ?? null,
    })

    return c.json({ success: true, data: booking }, 201)
  })

  bookings.patch('/bookings/:id/status', async (c) => {
    const booking = await repo.findById(c.req.param('id'))
    if (!booking) {
      return c.json({ success: false, error: 'Booking not found' }, 404)
    }

    const body = await c.req.json()
    const requestedStatus = body.status as string

    const allowedTransitions =
      VALID_BOOKING_TRANSITIONS[booking.status as keyof typeof VALID_BOOKING_TRANSITIONS] ?? []
    if (!allowedTransitions.includes(requestedStatus)) {
      return c.json(
        {
          success: false,
          error: `Invalid status transition from ${booking.status} to ${requestedStatus}`,
        },
        400,
      )
    }

    const updated = await repo.updateStatus(booking.id, requestedStatus)
    return c.json({ success: true, data: updated })
  })

  bookings.post('/bookings/:id/cancel', async (c) => {
    const booking = await repo.findById(c.req.param('id'))
    if (!booking) {
      return c.json({ success: false, error: 'Booking not found' }, 404)
    }

    const allowedTransitions =
      VALID_BOOKING_TRANSITIONS[booking.status as keyof typeof VALID_BOOKING_TRANSITIONS] ?? []
    if (!allowedTransitions.includes('CANCELLED')) {
      return c.json(
        {
          success: false,
          error: `Invalid status transition from ${booking.status} to CANCELLED`,
        },
        400,
      )
    }

    const updated = await repo.updateStatus(booking.id, 'CANCELLED')
    return c.json({ success: true, data: updated })
  })

  return bookings
}
