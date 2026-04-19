import { type BookingStatus, VALID_BOOKING_TRANSITIONS } from '@kuruma/shared/db/schema'
import { calculateCancellationFee } from '@kuruma/shared/lib/cancellation-policy'
import { calculateBookingPrice } from '@kuruma/shared/lib/pricing'
import { checkRentalRules } from '@kuruma/shared/lib/rental-rules'
import type { CallerContext } from '../middleware/auth'
import { PG_ERROR, pgErrorCode } from '../pg-errors'
import type {
  BookingFilters,
  BookingRepository,
  UserRepository,
  VehicleClassRepository,
  VehicleRepository,
} from '../repositories/types'
import type { Booking, Vehicle, VehicleClass } from '../stores'

const DEFAULT_BUFFER_MINUTES = 60
const MS_PER_MINUTE = 60 * 1000

export interface CreateBookingInput {
  // Issue #308: renters book a class; vehicle is optional (owner assigns later).
  classId: string
  vehicleId?: string | null
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
    private readonly userRepo?: UserRepository,
    private readonly vehicleClassRepo?: VehicleClassRepository,
  ) {}

  async findAll(ctx: CallerContext, filters?: BookingFilters): Promise<Booking[]> {
    return this.bookingRepo.findAll(ctx, filters)
  }

  async findAllPaginated(
    ctx: CallerContext,
    filters: BookingFilters,
  ): Promise<{ data: Booking[]; nextCursor: string | null }> {
    const limit = filters.limit ?? 20
    // Overfetch by 1 to detect if more pages exist
    const rows = await this.bookingRepo.findAll(ctx, { ...filters, limit: limit + 1 })
    const hasMore = rows.length > limit
    const data = hasMore ? rows.slice(0, limit) : rows
    const last = data[data.length - 1]
    const nextCursor = hasMore && last ? `${last.createdAt.toISOString()}_${last.id}` : null
    return { data, nextCursor }
  }

  async findAllWithVehiclesPaginated(
    ctx: CallerContext,
    filters: BookingFilters,
  ): Promise<{
    data: (Booking & { vehicle?: { name: string; photos: string[] } | undefined })[]
    nextCursor: string | null
  }> {
    const { data, nextCursor } = await this.findAllPaginated(ctx, filters)
    if (!this.vehicleRepo) return { data, nextCursor }

    const vehicleIds = [...new Set(data.flatMap((b) => (b.vehicleId ? [b.vehicleId] : [])))]
    const vehicleList = await this.vehicleRepo.findByIds(ctx, vehicleIds)
    const vehicleMap = new Map(vehicleList.map((v) => [v.id, { name: v.name, photos: v.photos }]))

    return {
      data: data.map((booking) => ({
        ...booking,
        vehicle: booking.vehicleId ? vehicleMap.get(booking.vehicleId) : undefined,
      })),
      nextCursor,
    }
  }

  async findAllWithRentersPaginated(
    ctx: CallerContext,
    filters: BookingFilters,
  ): Promise<{
    data: (Booking & {
      renter?:
        | { id: string; name: string | null; email: string | null; language: string }
        | undefined
    })[]
    nextCursor: string | null
  }> {
    const { data, nextCursor } = await this.findAllPaginated(ctx, filters)
    if (!this.userRepo) return { data, nextCursor }

    const renterIds = [...new Set(data.map((b) => b.renterId))]
    const userList = await this.userRepo.findByIds(renterIds)
    const userMap = new Map(
      userList.map((u) => [u.id, { id: u.id, name: u.name, email: u.email, language: u.language }]),
    )

    return {
      data: data.map((booking) => ({
        ...booking,
        renter: userMap.get(booking.renterId),
      })),
      nextCursor,
    }
  }

  async findById(ctx: CallerContext, id: string): Promise<Booking | undefined> {
    return this.bookingRepo.findById(ctx, id)
  }

  async create(
    ctx: CallerContext,
    input: CreateBookingInput,
    now: Date = new Date(),
  ): Promise<CreateBookingResult> {
    // Staff/admin override path: validate that the target renterId exists and
    // is a RENTER — prevents bookings attached to other staff/admin accounts
    // and surfaces FK failures as a friendly 400 rather than a generic 500.
    if (input.renterId !== ctx.userId && this.userRepo) {
      const [renter] = await this.userRepo.findByIds([input.renterId])
      if (!renter) {
        return { ok: false, status: 400, error: 'Renter not found' }
      }
      if ((renter.role ?? 'RENTER') !== 'RENTER') {
        return { ok: false, status: 400, error: 'Target user is not a renter' }
      }
    }

    // Idempotency: if a key was provided, check for an existing booking first.
    if (input.idempotencyKey) {
      const existing = await this.bookingRepo.findByIdempotencyKey(ctx, input.idempotencyKey)
      if (existing) {
        return { ok: true, booking: existing, status: 200 }
      }
    }

    // Issue #308: resolve the class (required) + optional pre-assigned vehicle.
    // Pricing falls back to the class rate when no specific vehicle is attached.
    // Issue #65: rental rules + Issue #74: server-side pricing — never
    // accepted from the client.
    const resolution = await this.resolveClassAndVehicle(ctx, input, now)
    if (!resolution.ok) return resolution

    const { bufferMinutes, totalPrice } = resolution
    const effectiveEndAt = new Date(input.endAt.getTime() + bufferMinutes * MS_PER_MINUTE)

    try {
      const booking = await this.bookingRepo.create(ctx, {
        renterId: input.renterId,
        classId: input.classId,
        vehicleId: input.vehicleId ?? null,
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
      const code = pgErrorCode(err)

      // Overlap exclusion constraint
      if (code === PG_ERROR.EXCLUSION_VIOLATION) {
        return {
          ok: false,
          status: 409,
          error: 'Vehicle is already booked for the requested time range',
        }
      }

      // Idempotency key unique constraint race: re-fetch and return existing
      if (code === PG_ERROR.UNIQUE_VIOLATION && input.idempotencyKey) {
        const existing = await this.bookingRepo.findByIdempotencyKey(ctx, input.idempotencyKey)
        if (existing) {
          return { ok: true, booking: existing, status: 200 }
        }
      }

      throw err
    }
  }

  async updateStatus(
    ctx: CallerContext,
    bookingId: string,
    newStatus: BookingStatus,
  ): Promise<StatusTransitionResult> {
    const booking = await this.bookingRepo.findById(ctx, bookingId)
    if (!booking) {
      return { ok: false, status: 404, error: 'Booking not found' }
    }

    const allowedTransitions = VALID_BOOKING_TRANSITIONS[booking.status] ?? []
    if (!allowedTransitions.includes(newStatus)) {
      return {
        ok: false,
        status: 400,
        error: `Invalid status transition from ${booking.status} to ${newStatus}`,
      }
    }

    const updated = await this.bookingRepo.updateStatus(ctx, booking.id, {
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

  async cancel(
    ctx: CallerContext,
    bookingId: string,
    now: Date = new Date(),
  ): Promise<CancelResult> {
    const booking = await this.bookingRepo.findById(ctx, bookingId)
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

    const cancellation = calculateCancellationFee(booking.startAt, now, booking.totalPrice ?? 0)

    const updated = await this.bookingRepo.cancel(ctx, booking.id, {
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

  // Resolves the booking's class (required by #308) and optional vehicle.
  // When a vehicle is provided, it must belong to the chosen class — mixing
  // them would let a renter book a Compact and receive an SUV. Pricing and
  // buffer come from the vehicle when assigned, otherwise from the class.
  private async resolveClassAndVehicle(
    ctx: CallerContext,
    input: CreateBookingInput,
    now: Date,
  ): Promise<
    | (CreateBookingResult & { ok: false })
    | { ok: true; bufferMinutes: number; totalPrice: number | null }
  > {
    const vehicleClass = await this.lookupClass(input.classId)
    if (!vehicleClass) {
      return { ok: false, status: 400, error: 'Vehicle class not found' }
    }
    if (vehicleClass.status === 'ARCHIVED') {
      return { ok: false, status: 400, error: 'Vehicle class is archived' }
    }

    const vehicle = input.vehicleId ? await this.lookupVehicle(ctx, input.vehicleId) : null
    if (input.vehicleId && !vehicle) {
      return { ok: false, status: 400, error: 'Vehicle not found' }
    }
    if (vehicle && vehicle.classId !== input.classId) {
      return {
        ok: false,
        status: 400,
        error: 'Vehicle does not belong to the selected class',
      }
    }

    // Rental rules + advance-booking use vehicle overrides when present,
    // otherwise fall back to class-level (currently unused — class doesn't
    // carry rental rules yet).
    if (vehicle) {
      const check = checkRentalRules(
        {
          minRentalHours: vehicle.minRentalHours,
          maxRentalHours: vehicle.maxRentalHours,
          advanceBookingHours: input.source === 'MANUAL' ? null : vehicle.advanceBookingHours,
        },
        input.startAt,
        input.endAt,
        now,
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
    }

    // Pricing source: vehicle overrides are optional. A null rate on the
    // vehicle falls back to the class rate. That way a single vehicle
    // without special pricing inherits from its class without duplication.
    const dailyRateJpy = vehicle?.dailyRateJpy ?? vehicleClass.dailyRateJpy
    const hourlyRateJpy = vehicle?.hourlyRateJpy ?? vehicleClass.hourlyRateJpy
    const pricing = calculateBookingPrice(
      { dailyRateJpy, hourlyRateJpy },
      input.startAt,
      input.endAt,
    )
    if (!pricing.ok) {
      return {
        ok: false,
        status: 400,
        error:
          pricing.code === 'NO_RATES_SET'
            ? 'No daily or hourly rate configured'
            : 'Invalid booking duration',
        code: pricing.code,
      }
    }

    const bufferMinutes = vehicle?.bufferMinutes ?? DEFAULT_BUFFER_MINUTES
    return { ok: true, bufferMinutes, totalPrice: pricing.totalPriceJpy }
  }

  // Explicit "missing repo" guard — silent `return null` would masquerade
  // as "class not found" and make every booking fail with a confusing 400.
  // The composition root always wires these repos; a test double that
  // forgets to is a bug in the fixture, not a runtime edge case.
  private async lookupClass(id: string): Promise<VehicleClass | null> {
    if (!this.vehicleClassRepo) {
      throw new Error('BookingService missing vehicleClassRepo; check DI wiring')
    }
    return (await this.vehicleClassRepo.findById(id)) ?? null
  }

  private async lookupVehicle(ctx: CallerContext, id: string): Promise<Vehicle | null> {
    if (!this.vehicleRepo) {
      throw new Error('BookingService missing vehicleRepo; check DI wiring')
    }
    return (await this.vehicleRepo.findById(ctx, id)) ?? null
  }
}
