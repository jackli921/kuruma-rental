import { bookings } from '@kuruma/shared/db/schema'
import { and, desc, eq, lt, or, sql } from 'drizzle-orm'
import { type CallerContext, PRIVILEGED_ROLES } from '../../middleware/auth'
import type { Booking } from '../../stores'
import type { BookingFilters, BookingRepository } from '../types'
import { type Db, bookingColumns, toBooking } from './shared'

export class DrizzleBookingRepository implements BookingRepository {
  constructor(private readonly db: Db) {}

  async findAll(ctx: CallerContext, filters?: BookingFilters): Promise<Booking[]> {
    const conditions = []

    // CallerContext scoping: non-privileged users only see own bookings
    if (!PRIVILEGED_ROLES.has(ctx.role)) {
      conditions.push(eq(bookings.renterId, ctx.userId))
    }

    if (filters?.status) {
      conditions.push(eq(bookings.status, filters.status as Booking['status']))
    }
    if (filters?.vehicleId) {
      conditions.push(eq(bookings.vehicleId, filters.vehicleId))
    }
    if (filters?.renterId) {
      conditions.push(eq(bookings.renterId, filters.renterId))
    }
    if (filters?.from && filters?.to) {
      const fromIso = filters.from.toISOString()
      const toIso = filters.to.toISOString()
      conditions.push(
        sql`tstzrange("startAt", "effectiveEndAt") && tstzrange(${fromIso}::timestamptz, ${toIso}::timestamptz)`,
      )
    }

    // Cursor-based pagination: skip past the cursor position
    if (filters?.cursor) {
      const sep = filters.cursor.indexOf('_')
      const cursorTime = filters.cursor.slice(0, sep)
      const cursorId = filters.cursor.slice(sep + 1)
      conditions.push(
        or(
          lt(bookings.createdAt, sql`${cursorTime}::timestamptz`),
          and(
            eq(bookings.createdAt, sql`${cursorTime}::timestamptz`),
            lt(bookings.id, cursorId),
          ),
        )!,
      )
    }

    let query = this.db
      .select(bookingColumns)
      .from(bookings)
      .orderBy(desc(bookings.createdAt), desc(bookings.id))

    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query
    }

    if (filters?.limit) {
      query = query.limit(filters.limit) as typeof query
    }

    const rows = await query
    return rows.map(toBooking)
  }

  async findById(ctx: CallerContext, id: string): Promise<Booking | undefined> {
    const conditions = [eq(bookings.id, id)]
    if (!PRIVILEGED_ROLES.has(ctx.role)) {
      conditions.push(eq(bookings.renterId, ctx.userId))
    }

    const [row] = await this.db
      .select(bookingColumns)
      .from(bookings)
      .where(and(...conditions))

    return row ? toBooking(row) : undefined
  }

  async findByIdempotencyKey(ctx: CallerContext, key: string): Promise<Booking | undefined> {
    const conditions = [eq(bookings.idempotencyKey, key)]
    if (!PRIVILEGED_ROLES.has(ctx.role)) {
      conditions.push(eq(bookings.renterId, ctx.userId))
    }

    const [row] = await this.db
      .select(bookingColumns)
      .from(bookings)
      .where(and(...conditions))

    return row ? toBooking(row) : undefined
  }

  async create(ctx: CallerContext, data: Omit<Booking, 'id' | 'createdAt' | 'updatedAt'>): Promise<Booking> {
    const [inserted] = await this.db
      .insert(bookings)
      .values({
        renterId: data.renterId,
        vehicleId: data.vehicleId,
        startAt: data.startAt,
        endAt: data.endAt,
        effectiveEndAt: data.effectiveEndAt,
        status: data.status,
        source: data.source,
        externalId: data.externalId,
        notes: data.notes,
        totalPrice: data.totalPrice,
        cancellationFee: data.cancellationFee,
        cancelledAt: data.cancelledAt,
        idempotencyKey: data.idempotencyKey,
      })
      .returning()

    if (!inserted) throw new Error('Failed to insert booking')
    return toBooking(inserted)
  }

  async updateStatus(
    ctx: CallerContext,
    id: string,
    transition: { from: Booking['status']; to: Booking['status'] },
  ): Promise<Booking | undefined> {
    const conditions = [eq(bookings.id, id), eq(bookings.status, transition.from)]
    if (!PRIVILEGED_ROLES.has(ctx.role)) {
      conditions.push(eq(bookings.renterId, ctx.userId))
    }

    const [updated] = await this.db
      .update(bookings)
      .set({ status: transition.to, updatedAt: sql`now()` })
      .where(and(...conditions))
      .returning()

    return updated ? toBooking(updated) : undefined
  }

  async cancel(
    ctx: CallerContext,
    id: string,
    opts: { from: Booking['status']; fee: number; cancelledAt: Date },
  ): Promise<Booking | undefined> {
    const conditions = [eq(bookings.id, id), eq(bookings.status, opts.from)]
    if (!PRIVILEGED_ROLES.has(ctx.role)) {
      conditions.push(eq(bookings.renterId, ctx.userId))
    }

    const [cancelled] = await this.db
      .update(bookings)
      .set({
        status: 'CANCELLED',
        cancellationFee: opts.fee,
        cancelledAt: opts.cancelledAt,
        updatedAt: sql`now()`,
      })
      .where(and(...conditions))
      .returning()

    return cancelled ? toBooking(cancelled) : undefined
  }
}
