import { Hono } from 'hono'
import { getVehicleStore, getBookingStore } from '../stores'
import type { Booking } from '../stores'

const BLOCKING_STATUSES: ReadonlySet<Booking['status']> = new Set([
  'CONFIRMED',
  'ACTIVE',
])

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

function getConflictingBookings(
  vehicleId: string,
  bufferMinutes: number,
  from: Date,
  to: Date,
): Booking[] {
  const bookings = [...getBookingStore().values()]

  return bookings.filter((booking) => {
    if (booking.vehicleId !== vehicleId) return false
    if (!BLOCKING_STATUSES.has(booking.status)) return false

    const bookingEndWithBuffer = new Date(
      booking.endAt.getTime() + bufferMinutes * 60 * 1000,
    )

    // Overlap: booking starts before requested end AND booking end (+ buffer) is after requested start
    return booking.startAt < to && bookingEndWithBuffer > from
  })
}

const availability = new Hono()

availability.get('/availability', (c) => {
  const parsed = parseTimeRange(c)

  if ('error' in parsed) {
    return c.json({ success: false, error: parsed.error }, 400)
  }

  const { from, to } = parsed
  const vehicles = [...getVehicleStore().values()]

  const available = vehicles.filter((vehicle) => {
    if (vehicle.status !== 'AVAILABLE') return false

    const conflicts = getConflictingBookings(
      vehicle.id,
      vehicle.bufferMinutes,
      from,
      to,
    )

    return conflicts.length === 0
  })

  return c.json({ success: true, data: available })
})

availability.get('/availability/:vehicleId', (c) => {
  const vehicleId = c.req.param('vehicleId')
  const vehicle = getVehicleStore().get(vehicleId)

  if (!vehicle) {
    return c.json({ success: false, error: 'Vehicle not found' }, 404)
  }

  const parsed = parseTimeRange(c)

  if ('error' in parsed) {
    return c.json({ success: false, error: parsed.error }, 400)
  }

  const { from, to } = parsed

  const conflicts = getConflictingBookings(
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
