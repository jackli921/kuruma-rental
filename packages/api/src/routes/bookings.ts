import { VALID_BOOKING_TRANSITIONS } from '@kuruma/shared/db/schema'
import { calculateCancellationFee } from '@kuruma/shared/lib/cancellation-policy'
import { calculateBookingPrice } from '@kuruma/shared/lib/pricing'
import { checkRentalRules } from '@kuruma/shared/lib/rental-rules'
import { createBookingSchema } from '@kuruma/shared/validators/booking'
import { Hono } from 'hono'
import type { BookingRepository, VehicleRepository } from '../repositories/types'

export function createBookingRoutes(
  repo: BookingRepository,
  vehicleRepo?: VehicleRepository,
): Hono {
  const bookings = new Hono()

  bookings.get('/bookings', async (c) => {
    const statusFilter = c.req.query('status')
    const vehicleIdFilter = c.req.query('vehicleId')
    const renterIdFilter = c.req.query('renterId')
    const fromParam = c.req.query('from')
    const toParam = c.req.query('to')
    const expand = c.req.query('expand')

    if ((fromParam && !toParam) || (!fromParam && toParam)) {
      return c.json(
        { success: false, error: 'Both "from" and "to" are required for date range filtering' },
        400,
      )
    }

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
    if (fromParam && toParam) {
      const from = new Date(fromParam)
      const to = new Date(toParam)
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
        return c.json({ success: false, error: '"from" and "to" must be valid ISO dates' }, 400)
      }
      if (to <= from) {
        return c.json({ success: false, error: '"to" must be after "from"' }, 400)
      }
      filters.from = from
      filters.to = to
    }

    const results = await repo.findAll(Object.keys(filters).length > 0 ? filters : undefined)

    if (expand === 'vehicle' && vehicleRepo) {
      const vehicleIds = [...new Set(results.map((b) => b.vehicleId))]
      const vehicleMap = new Map<string, { name: string; photos: string[] }>()

      await Promise.all(
        vehicleIds.map(async (vid) => {
          const vehicle = await vehicleRepo.findById(vid)
          if (vehicle) {
            vehicleMap.set(vid, { name: vehicle.name, photos: vehicle.photos })
          }
        }),
      )

      const expanded = results.map((booking) => ({
        ...booking,
        vehicle: vehicleMap.get(booking.vehicleId),
      }))

      return c.json({ success: true, data: expanded })
    }

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

    const startAt = new Date(result.data.startAt)
    const endAt = new Date(result.data.endAt)
    const defaultBufferMs = 60 * 60 * 1000 // 60 minutes default
    const effectiveEndAt = new Date(endAt.getTime() + defaultBufferMs)

    // Issue #65: per-vehicle rental rules (min/max duration, advance booking
    // window). Looked up here because the rules live on the vehicle and the
    // server clock is the authoritative "now". We only enforce when the
    // vehicle is actually present in the repo — production bookings always
    // carry a real FK, so in practice this runs on every booking.
    //
    // Issue #74: the SAME vehicle lookup drives server-side pricing too.
    // `totalPrice` is never accepted from the client body — a renter who
    // sends {totalPrice: 1} on a 200k JPY booking would otherwise walk off
    // with a 1 JPY cancellation penalty.
    let totalPrice: number | null = null
    if (vehicleRepo) {
      const vehicle = await vehicleRepo.findById(result.data.vehicleId)
      if (vehicle) {
        const check = checkRentalRules(
          {
            minRentalHours: vehicle.minRentalHours,
            maxRentalHours: vehicle.maxRentalHours,
            advanceBookingHours: vehicle.advanceBookingHours,
          },
          startAt,
          endAt,
          new Date(),
        )
        if (!check.ok) {
          return c.json(
            {
              success: false,
              error: 'Booking violates a rental rule on this vehicle',
              code: check.code,
              details: { required: check.required, actual: check.actual },
            },
            400,
          )
        }

        const pricing = calculateBookingPrice(
          { dailyRateJpy: vehicle.dailyRateJpy, hourlyRateJpy: vehicle.hourlyRateJpy },
          startAt,
          endAt,
        )
        if (!pricing.ok) {
          return c.json(
            {
              success: false,
              error:
                pricing.code === 'NO_RATES_SET'
                  ? 'Vehicle has no daily or hourly rate configured'
                  : 'Invalid booking duration',
              code: pricing.code,
            },
            400,
          )
        }
        totalPrice = pricing.totalPriceJpy
      }
    }

    try {
      const booking = await repo.create({
        renterId,
        vehicleId: result.data.vehicleId,
        startAt,
        endAt,
        effectiveEndAt,
        status: 'CONFIRMED',
        source: result.data.source,
        externalId: result.data.externalId ?? null,
        notes: result.data.notes ?? null,
        totalPrice,
        cancellationFee: null,
        cancelledAt: null,
      })

      return c.json({ success: true, data: booking }, 201)
    } catch (err) {
      // Postgres exclusion_violation (23P01) — bookings_no_overlap constraint.
      // The DB (and the in-memory repo's mirror check) reject overlapping bookings
      // for the same vehicle. Surface as 409 Conflict instead of a bare 500.
      if (
        err &&
        typeof err === 'object' &&
        'code' in err &&
        (err as { code: unknown }).code === '23P01'
      ) {
        return c.json(
          { success: false, error: 'Vehicle is already booked for the requested time range' },
          409,
        )
      }
      throw err
    }
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

    if (booking.status !== 'CONFIRMED') {
      return c.json(
        {
          success: false,
          error: `Cannot cancel booking with status ${booking.status}. Only CONFIRMED bookings can be cancelled.`,
        },
        409,
      )
    }

    const now = new Date()
    const cancellation = calculateCancellationFee(booking.startAt, now, booking.totalPrice ?? 0)

    const updated = await repo.cancel(booking.id, cancellation.feeAmount, now)
    return c.json({ success: true, data: updated, cancellation })
  })

  return bookings
}
