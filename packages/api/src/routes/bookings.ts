import { Hono } from 'hono'
import { createBookingSchema } from '@kuruma/shared/validators/booking'
import { VALID_BOOKING_TRANSITIONS } from '@kuruma/shared/db/schema'
import type { Booking } from '../stores'
import { getBookingStore } from '../stores'

// Re-export for backward compatibility with existing tests
export { resetBookingStore } from '../stores'

const bookings = new Hono()

bookings.get('/bookings', (c) => {
  const statusFilter = c.req.query('status')
  const vehicleIdFilter = c.req.query('vehicleId')

  let results = [...getBookingStore().values()]

  if (statusFilter) {
    results = results.filter((b) => b.status === statusFilter)
  }

  if (vehicleIdFilter) {
    results = results.filter((b) => b.vehicleId === vehicleIdFilter)
  }

  return c.json({ success: true, data: results })
})

bookings.get('/bookings/:id', (c) => {
  const booking = getBookingStore().get(c.req.param('id'))
  if (!booking) {
    return c.json({ success: false, error: 'Booking not found' }, 404)
  }
  return c.json({ success: true, data: booking })
})

bookings.post('/bookings', async (c) => {
  const body = await c.req.json()
  const result = createBookingSchema.safeParse(body)

  if (!result.success) {
    return c.json(
      { success: false, error: result.error.flatten().fieldErrors },
      400,
    )
  }

  const renterId = body.renterId as string | undefined
  if (!renterId) {
    return c.json(
      { success: false, error: { renterId: ['Renter ID is required'] } },
      400,
    )
  }

  const now = new Date()
  const booking: Booking = {
    id: crypto.randomUUID(),
    renterId,
    vehicleId: result.data.vehicleId,
    startAt: new Date(result.data.startAt),
    endAt: new Date(result.data.endAt),
    status: 'CONFIRMED',
    source: result.data.source,
    externalId: result.data.externalId ?? null,
    notes: result.data.notes ?? null,
    createdAt: now,
    updatedAt: now,
  }

  getBookingStore().set(booking.id, booking)
  return c.json({ success: true, data: booking }, 201)
})

bookings.patch('/bookings/:id/status', async (c) => {
  const booking = getBookingStore().get(c.req.param('id'))
  if (!booking) {
    return c.json({ success: false, error: 'Booking not found' }, 404)
  }

  const body = await c.req.json()
  const requestedStatus = body.status as string

  const allowedTransitions = VALID_BOOKING_TRANSITIONS[booking.status] ?? []
  if (!allowedTransitions.includes(requestedStatus)) {
    return c.json(
      {
        success: false,
        error: `Invalid status transition from ${booking.status} to ${requestedStatus}`,
      },
      400,
    )
  }

  const updated: Booking = {
    ...booking,
    status: requestedStatus as Booking['status'],
    updatedAt: new Date(),
  }

  getBookingStore().set(updated.id, updated)
  return c.json({ success: true, data: updated })
})

bookings.post('/bookings/:id/cancel', (c) => {
  const booking = getBookingStore().get(c.req.param('id'))
  if (!booking) {
    return c.json({ success: false, error: 'Booking not found' }, 404)
  }

  const allowedTransitions = VALID_BOOKING_TRANSITIONS[booking.status] ?? []
  if (!allowedTransitions.includes('CANCELLED')) {
    return c.json(
      {
        success: false,
        error: `Invalid status transition from ${booking.status} to CANCELLED`,
      },
      400,
    )
  }

  const updated: Booking = {
    ...booking,
    status: 'CANCELLED',
    updatedAt: new Date(),
  }

  getBookingStore().set(updated.id, updated)
  return c.json({ success: true, data: updated })
})

export default bookings
