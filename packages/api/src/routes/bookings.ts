import { eq, and } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb } from '@kuruma/shared/db'
import { bookings as bookingsTable } from '@kuruma/shared/db/schema'
import { createBookingSchema } from '@kuruma/shared/validators/booking'
import { VALID_BOOKING_TRANSITIONS } from '@kuruma/shared/db/schema'

const bookings = new Hono()

bookings.get('/bookings', async (c) => {
  const db = getDb()
  const statusFilter = c.req.query('status')
  const vehicleIdFilter = c.req.query('vehicleId')

  const conditions = []

  if (statusFilter) {
    conditions.push(eq(bookingsTable.status, statusFilter as 'CONFIRMED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED'))
  }

  if (vehicleIdFilter) {
    conditions.push(eq(bookingsTable.vehicleId, vehicleIdFilter))
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined

  const rows = await db
    .select()
    .from(bookingsTable)
    .where(where)

  return c.json({ success: true, data: rows })
})

bookings.get('/bookings/:id', async (c) => {
  const db = getDb()
  const rows = await db
    .select()
    .from(bookingsTable)
    .where(eq(bookingsTable.id, c.req.param('id')))
  const booking = rows[0]
  if (!booking) {
    return c.json({ success: false, error: 'Booking not found' }, 404)
  }
  return c.json({ success: true, data: booking })
})

bookings.post('/bookings', async (c) => {
  const db = getDb()
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

  const rows = await db
    .insert(bookingsTable)
    .values({
      renterId,
      vehicleId: result.data.vehicleId,
      startAt: new Date(result.data.startAt),
      endAt: new Date(result.data.endAt),
      status: 'CONFIRMED',
      source: result.data.source,
      externalId: result.data.externalId ?? null,
      notes: result.data.notes ?? null,
    })
    .returning()

  return c.json({ success: true, data: rows[0] }, 201)
})

bookings.patch('/bookings/:id/status', async (c) => {
  const db = getDb()
  const rows = await db
    .select()
    .from(bookingsTable)
    .where(eq(bookingsTable.id, c.req.param('id')))
  const booking = rows[0]

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

  const updated = await db
    .update(bookingsTable)
    .set({ status: requestedStatus as 'CONFIRMED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED', updatedAt: new Date() })
    .where(eq(bookingsTable.id, booking.id))
    .returning()

  return c.json({ success: true, data: updated[0] })
})

bookings.post('/bookings/:id/cancel', async (c) => {
  const db = getDb()
  const rows = await db
    .select()
    .from(bookingsTable)
    .where(eq(bookingsTable.id, c.req.param('id')))
  const booking = rows[0]

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

  const updated = await db
    .update(bookingsTable)
    .set({ status: 'CANCELLED', updatedAt: new Date() })
    .where(eq(bookingsTable.id, booking.id))
    .returning()

  return c.json({ success: true, data: updated[0] })
})

export default bookings
