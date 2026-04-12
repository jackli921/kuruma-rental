import { VALID_BOOKING_TRANSITIONS } from '@kuruma/shared/db/schema'
import { calculateCancellationFee } from '@kuruma/shared/lib/cancellation-policy'
import { calculateBookingPrice } from '@kuruma/shared/lib/pricing'
import { checkRentalRules } from '@kuruma/shared/lib/rental-rules'
import type { BookingFilters, BookingRepository, VehicleRepository } from '../repositories/types'
import type { Booking } from '../stores'

const DEFAULT_BUFFER_MS = 60 * 60 * 1000 // 60 minutes

export interface CreateBookingInput {
  vehicleId: string
  renterId: string
  startAt: Date
  endAt: Date
  source: Booking['source']
  externalId?: string | null
  notes?: string | null
  idempotencyKey?: string | null
}

export type CreateBookingResult =
  | { ok: true; booking: Booking; status?: 200 }
  | {
      ok: false
      status: 400 | 409
      error: string | Record<string, string[]>
      code?: string
      details?: { required: number; actual: number }
    }

export type StatusTransitionResult =
  | { ok: true; booking: Booking }
  | { ok: false; status: 400 | 404 | 409; error: string }

export type CancelResult =
  | {
      ok: true
      booking: Booking
      cancellation: ReturnType<typeof calculateCancellationFee>
    }
  | { ok: false; status: 404 | 409; error: string }

export class BookingService {
  constructor(
    private readonly bookingRepo: BookingRepository,
    private readonly vehicleRepo?: VehicleRepository,
  ) {}

  async findAll(filters?: BookingFilters): Promise<Booking[]> {
    return this.bookingRepo.findAll(filters)
  }

  async findAllPaginated(
    filters: BookingFilters,
  ): Promise<{ data: Booking[]; nextCursor: string | null }> {
    const limit = filters.limit ?? 20
    // Overfetch by 1 to detect if more pages exist
    const rows = await this.bookingRepo.findAll({ ...filters, limit: limit + 1 })
    const hasMore = rows.length > limit
    const data = hasMore ? rows.slice(0, limit) : rows
    const last = data[data.length - 1]
    const nextCursor = hasMore && last ? `${last.createdAt.toISOString()}_${last.id}` : null
    return { data, nextCursor }
  }

  async findAllWithVehiclesPaginated(filters: BookingFilters): Promise<{
    data: (Booking & { vehicle?: { name: string; photos: string[] } | undefined })[]
    nextCursor: string | null
  }> {
    const { data, nextCursor } = await this.findAllPaginated(filters)
    if (!this.vehicleRepo) return { data, nextCursor }

    const vehicleIds = [...new Set(data.map((b) => b.vehicleId))]
    const vehicleList = await this.vehicleRepo!.findByIds(vehicleIds)
    const vehicleMap = new Map(vehicleList.map((v) => [v.id, { name: v.name, photos: v.photos }]))

    return {
      data: data.map((booking) => ({
        ...booking,
        vehicle: vehicleMap.get(booking.vehicleId),
      })),
      nextCursor,
    }
  }

  async findById(id: string): Promise<Booking | undefined> {
    return this.bookingRepo.findById(id)
  }

  async create(input: CreateBookingInput): Promise<CreateBookingResult> {
    // Idempotency: if a key was provided, check for an existing booking first.
    if (input.idempotencyKey) {
      const existing = await this.bookingRepo.findByIdempotencyKey(input.idempotencyKey)
      if (existing) {
        return { ok: true, booking: existing, status: 200 }
      }
    }

    const effectiveEndAt = new Date(input.endAt.getTime() + DEFAULT_BUFFER_MS)

    // Issue #65: rental rules + Issue #74: server-side pricing.
    // Both depend on the vehicle lookup. totalPrice is never accepted
    // from the client — always computed server-side.
    let totalPrice: number | null = null
    if (this.vehicleRepo) {
      const vehicle = await this.vehicleRepo.findById(input.vehicleId)
      if (vehicle) {
        const check = checkRentalRules(
          {
            minRentalHours: vehicle.minRentalHours,
            maxRentalHours: vehicle.maxRentalHours,
            advanceBookingHours: vehicle.advanceBookingHours,
          },
          input.startAt,
          input.endAt,
          new Date(),
        )
        if (!check.ok) {
          return {
            ok: false,
            status: 400,
            error: 'Booking violates a rental rule on this vehicle',
            code: check.code,
            details: { required: check.required, actual: check.actual },
          }
        }

        const pricing = calculateBookingPrice(
          { dailyRateJpy: vehicle.dailyRateJpy, hourlyRateJpy: vehicle.hourlyRateJpy },
          input.startAt,
          input.endAt,
        )
        if (!pricing.ok) {
          return {
            ok: false,
            status: 400,
            error:
              pricing.code === 'NO_RATES_SET'
                ? 'Vehicle has no daily or hourly rate configured'
                : 'Invalid booking duration',
            code: pricing.code,
          }
        }
        totalPrice = pricing.totalPriceJpy
      }
    }

    try {
      const booking = await this.bookingRepo.create({
        renterId: input.renterId,
        vehicleId: input.vehicleId,
        startAt: input.startAt,
        endAt: input.endAt,
        effectiveEndAt,
        status: 'CONFIRMED',
        source: input.source,
        externalId: input.externalId ?? null,
        notes: input.notes ?? null,
        totalPrice,
        cancellationFee: null,
        cancelledAt: null,
        idempotencyKey: input.idempotencyKey ?? null,
      })

      return { ok: true, booking }
    } catch (err) {
      if (
        err &&
        typeof err === 'object' &&
        'code' in err &&
        (err as { code: unknown }).code === '23P01'
      ) {
        return {
          ok: false,
          status: 409,
          error: 'Vehicle is already booked for the requested time range',
        }
      }
      throw err
    }
  }

  async updateStatus(bookingId: string, newStatus: string): Promise<StatusTransitionResult> {
    const booking = await this.bookingRepo.findById(bookingId)
    if (!booking) {
      return { ok: false, status: 404, error: 'Booking not found' }
    }

    const allowedTransitions =
      VALID_BOOKING_TRANSITIONS[booking.status as keyof typeof VALID_BOOKING_TRANSITIONS] ?? []
    if (!allowedTransitions.includes(newStatus)) {
      return {
        ok: false,
        status: 400,
        error: `Invalid status transition from ${booking.status} to ${newStatus}`,
      }
    }

    const updated = await this.bookingRepo.updateStatus(booking.id, {
      from: booking.status,
      to: newStatus as Booking['status'],
    })
    if (!updated) {
      return {
        ok: false,
        status: 409,
        error: 'Booking status was modified by another request. Please retry.',
      }
    }
    return { ok: true, booking: updated }
  }

  async cancel(bookingId: string): Promise<CancelResult> {
    const booking = await this.bookingRepo.findById(bookingId)
    if (!booking) {
      return { ok: false, status: 404, error: 'Booking not found' }
    }

    if (booking.status !== 'CONFIRMED') {
      return {
        ok: false,
        status: 409,
        error: `Cannot cancel booking with status ${booking.status}. Only CONFIRMED bookings can be cancelled.`,
      }
    }

    const now = new Date()
    const cancellation = calculateCancellationFee(booking.startAt, now, booking.totalPrice ?? 0)

    const updated = await this.bookingRepo.cancel(booking.id, {
      from: booking.status,
      fee: cancellation.feeAmount,
      cancelledAt: now,
    })
    if (!updated) {
      return {
        ok: false,
        status: 409,
        error: 'Booking status was modified by another request. Please retry.',
      }
    }
    return { ok: true, booking: updated, cancellation }
  }
}
