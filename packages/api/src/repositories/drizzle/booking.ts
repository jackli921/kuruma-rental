import { bookings } from '@kuruma/shared/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import type { Booking } from '../../stores'
import type { BookingFilters, BookingRepository } from '../types'
import { type Db, bookingColumns } from './shared'

export class DrizzleBookingRepository implements BookingRepository {
  constructor(private readonly db: Db) {}

  async findAll(filters?: BookingFilters): Promise<Booking[]> {
    const conditions = []

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

    const query = this.db.select(bookingColumns).from(bookings)

    const rows = conditions.length > 0 ? await query.where(and(...conditions)) : await query

    return rows as Booking[]
  }

  async findById(id: string): Promise<Booking | undefined> {
    const [row] = await this.db.select(bookingColumns).from(bookings).where(eq(bookings.id, id))

    return (row as Booking) ?? undefined
  }

  async findByIdempotencyKey(key: string): Promise<Booking | undefined> {
    const [row] = await this.db
      .select(bookingColumns)
      .from(bookings)
      .where(eq(bookings.idempotencyKey, key))

    return (row as Booking) ?? undefined
  }

  async create(data: Omit<Booking, 'id' | 'createdAt' | 'updatedAt'>): Promise<Booking> {
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

    return inserted as Booking
  }

  async updateStatus(
    id: string,
    expectedStatus: Booking['status'],
    newStatus: Booking['status'],
  ): Promise<Booking | undefined> {
    const [updated] = await this.db
      .update(bookings)
      .set({ status: newStatus, updatedAt: sql`now()` })
      .where(and(eq(bookings.id, id), eq(bookings.status, expectedStatus)))
      .returning()

    return (updated as Booking) ?? undefined
  }

  async cancel(
    id: string,
    expectedStatus: Booking['status'],
    cancellationFee: number,
    cancelledAt: Date,
  ): Promise<Booking | undefined> {
    const [cancelled] = await this.db
      .update(bookings)
      .set({
        status: 'CANCELLED',
        cancellationFee,
        cancelledAt,
        updatedAt: sql`now()`,
      })
      .where(and(eq(bookings.id, id), eq(bookings.status, expectedStatus)))
      .returning()

    return (cancelled as Booking) ?? undefined
  }
}
