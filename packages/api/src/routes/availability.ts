import { eq, and, or } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb } from '@kuruma/shared/db'
import {
  bookings as bookingsTable,
  vehicles as vehiclesTable,
} from '@kuruma/shared/db/schema'

type BookingRow = typeof bookingsTable.$inferSelect

const BLOCKING_STATUSES = ['CONFIRMED', 'ACTIVE'] as const

function parseTimeRange(c: {
  req: { query: (key: string) => string | undefined }
}): { from: Date; to: Date } | { error: string } {
  const fromParam = c.req.query('from')
  const toParam = c.req.query('to')

  if (!fromParam || !toParam) {
    return { error: 'Both "from" and "to" query parameters are required' }
  }

  const from = new Date(fromParam)
  const to = new Date(toParam)

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return { error: '"from" and "to" must be valid ISO datetime strings' }
  }

  if (to <= from) {
    return { error: '"to" must be after "from"' }
  }

  return { from, to }
}

/**
 * Find bookings that conflict with the requested time range for a given vehicle.
 * A booking conflicts when: booking starts before requested end AND
 * booking end + buffer is after requested start.
 *
 * Buffer calculation is per-vehicle, so we fetch blocking bookings from DB
 * then filter in JS.
 */
function getConflictingBookings(
  allBookings: BookingRow[],
  vehicleId: string,
  bufferMinutes: number,
  from: Date,
  to: Date,
): BookingRow[] {
  return allBookings.filter((booking) => {
    if (booking.vehicleId !== vehicleId) return false
    if (!BLOCKING_STATUSES.includes(booking.status as typeof BLOCKING_STATUSES[number])) return false

    const bookingEndWithBuffer = new Date(
      booking.endAt.getTime() + bufferMinutes * 60 * 1000,
    )

    // Overlap: booking starts before requested end AND booking end (+ buffer) is after requested start
    return booking.startAt < to && bookingEndWithBuffer > from
  })
}

const availability = new Hono()

availability.get('/availability', async (c) => {
  const parsed = parseTimeRange(c)

  if ('error' in parsed) {
    return c.json({ success: false, error: parsed.error }, 400)
  }

  const { from, to } = parsed
  const db = getDb()

  // Fetch all AVAILABLE vehicles
  const allVehicles = await db
    .select()
    .from(vehiclesTable)
    .where(eq(vehiclesTable.status, 'AVAILABLE'))

  // Fetch all blocking bookings (CONFIRMED or ACTIVE) for any vehicle
  const blockingBookings = await db
    .select()
    .from(bookingsTable)
    .where(
      or(
        eq(bookingsTable.status, 'CONFIRMED'),
        eq(bookingsTable.status, 'ACTIVE'),
      ),
    )

  // Filter vehicles that have no conflicting bookings
  const available = allVehicles.filter((vehicle) => {
    const conflicts = getConflictingBookings(
      blockingBookings,
      vehicle.id,
      vehicle.bufferMinutes,
      from,
      to,
    )
    return conflicts.length === 0
  })

  return c.json({ success: true, data: available })
})

availability.get('/availability/:vehicleId', async (c) => {
  const vehicleId = c.req.param('vehicleId')
  const db = getDb()

  const vehicleRows = await db
    .select()
    .from(vehiclesTable)
    .where(eq(vehiclesTable.id, vehicleId))
  const vehicle = vehicleRows[0]

  if (!vehicle) {
    return c.json({ success: false, error: 'Vehicle not found' }, 404)
  }

  const parsed = parseTimeRange(c)

  if ('error' in parsed) {
    return c.json({ success: false, error: parsed.error }, 400)
  }

  const { from, to } = parsed

  // Fetch blocking bookings for this vehicle
  const bookingsForVehicle = await db
    .select()
    .from(bookingsTable)
    .where(
      and(
        eq(bookingsTable.vehicleId, vehicleId),
        or(
          eq(bookingsTable.status, 'CONFIRMED'),
          eq(bookingsTable.status, 'ACTIVE'),
        ),
      ),
    )

  const conflicts = getConflictingBookings(
    bookingsForVehicle,
    vehicle.id,
    vehicle.bufferMinutes,
    from,
    to,
  )

  if (conflicts.length === 0) {
    return c.json({ success: true, data: { available: true, vehicle } })
  }

  return c.json({
    success: true,
    data: { available: false, vehicle, conflicts },
  })
})

export default availability
