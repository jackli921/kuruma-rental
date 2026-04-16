import { type CallerContext, PRIVILEGED_ROLES } from '../../middleware/auth'
import { PG_ERROR } from '../../pg-errors'
import type { Booking } from '../../stores'
import type { BookingFilters, BookingRepository } from '../types'

export const BLOCKING_STATUSES: ReadonlySet<Booking['status']> = new Set(['CONFIRMED', 'ACTIVE'])

export function getConflictingBookings(
  bookings: Booking[],
  vehicleId: string,
  _bufferMinutes: number,
  from: Date,
  to: Date,
): Booking[] {
  return bookings.filter((booking) => {
    if (booking.vehicleId !== vehicleId) return false
    if (!BLOCKING_STATUSES.has(booking.status)) return false

    // Use effectiveEndAt (which includes buffer) instead of computing at runtime
    const effectiveEnd = booking.effectiveEndAt

    // Overlap: booking starts before requested end AND effective end is after requested start
    return booking.startAt < to && effectiveEnd > from
  })
}

export class InMemoryBookingRepository implements BookingRepository {
  private readonly store: Map<string, Booking>

  constructor(store?: Map<string, Booking>) {
    this.store = store ?? new Map()
  }

  private scopedValues(ctx: CallerContext): Booking[] {
    const all = [...this.store.values()]
    if (PRIVILEGED_ROLES.has(ctx.role)) return all
    return all.filter((b) => b.renterId === ctx.userId)
  }

  async findAll(ctx: CallerContext, filters?: BookingFilters): Promise<Booking[]> {
    let results = this.scopedValues(ctx)

    if (filters?.status) {
      results = results.filter((b) => b.status === filters.status)
    }
    if (filters?.vehicleId) {
      results = results.filter((b) => b.vehicleId === filters.vehicleId)
    }
    if (filters?.renterId) {
      results = results.filter((b) => b.renterId === filters.renterId)
    }
    if (filters?.from && filters?.to) {
      const from = filters.from
      const to = filters.to
      results = results.filter((b) => b.startAt < to && b.effectiveEndAt > from)
    }

    // Sort by createdAt DESC, id DESC (matches Drizzle ORDER BY)
    results.sort((a, b) => {
      const timeDiff = b.createdAt.getTime() - a.createdAt.getTime()
      if (timeDiff !== 0) return timeDiff
      return b.id < a.id ? -1 : 1
    })

    // Cursor: skip past the cursor position
    if (filters?.cursor) {
      const sep = filters.cursor.indexOf('_')
      const cursorTime = new Date(filters.cursor.slice(0, sep))
      const cursorId = filters.cursor.slice(sep + 1)
      results = results.filter((b) => {
        if (b.createdAt.getTime() < cursorTime.getTime()) return true
        if (b.createdAt.getTime() === cursorTime.getTime() && b.id < cursorId) return true
        return false
      })
    }

    // Apply limit
    if (filters?.limit) {
      results = results.slice(0, filters.limit)
    }

    return results
  }

  async findById(ctx: CallerContext, id: string): Promise<Booking | undefined> {
    const booking = this.store.get(id)
    if (!booking) return undefined
    if (!PRIVILEGED_ROLES.has(ctx.role) && booking.renterId !== ctx.userId) return undefined
    return booking
  }

  async findByIdempotencyKey(ctx: CallerContext, key: string): Promise<Booking | undefined> {
    for (const booking of this.store.values()) {
      if (booking.idempotencyKey === key) {
        if (!PRIVILEGED_ROLES.has(ctx.role) && booking.renterId !== ctx.userId) return undefined
        return booking
      }
    }
    return undefined
  }

  async create(
    _ctx: CallerContext,
    data: Omit<Booking, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<Booking> {
    // Mirror the DB-level `bookings_no_overlap` exclusion constraint so in-memory
    // tests exercise the same conflict behavior as real Postgres.
    if (BLOCKING_STATUSES.has(data.status)) {
      for (const existing of this.store.values()) {
        if (existing.vehicleId !== data.vehicleId) continue
        if (!BLOCKING_STATUSES.has(existing.status)) continue
        const overlaps =
          data.startAt < existing.effectiveEndAt && existing.startAt < data.effectiveEndAt
        if (overlaps) {
          const err = new Error('bookings_no_overlap violation') as Error & { code: string }
          err.code = PG_ERROR.EXCLUSION_VIOLATION
          throw err
        }
      }
    }

    // Mirror the DB-level partial unique index on idempotencyKey
    if (data.idempotencyKey) {
      for (const existing of this.store.values()) {
        if (existing.idempotencyKey === data.idempotencyKey) {
          const err = new Error('unique_idempotency_key violation') as Error & { code: string }
          err.code = PG_ERROR.UNIQUE_VIOLATION
          throw err
        }
      }
    }

    const now = new Date()
    const booking: Booking = {
      ...data,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    }
    this.store.set(booking.id, booking)
    return booking
  }

  async updateStatus(
    ctx: CallerContext,
    id: string,
    transition: { from: Booking['status']; to: Booking['status'] },
  ): Promise<Booking | undefined> {
    const existing = this.store.get(id)
    if (!existing || existing.status !== transition.from) return undefined
    if (!PRIVILEGED_ROLES.has(ctx.role) && existing.renterId !== ctx.userId) return undefined

    const updated: Booking = {
      ...existing,
      status: transition.to,
      updatedAt: new Date(),
    }
    this.store.set(updated.id, updated)
    return updated
  }

  async cancel(
    ctx: CallerContext,
    id: string,
    opts: { from: Booking['status']; fee: number; cancelledAt: Date },
  ): Promise<Booking | undefined> {
    const existing = this.store.get(id)
    if (!existing || existing.status !== opts.from) return undefined
    if (!PRIVILEGED_ROLES.has(ctx.role) && existing.renterId !== ctx.userId) return undefined

    const cancelled: Booking = {
      ...existing,
      status: 'CANCELLED',
      cancellationFee: opts.fee,
      cancelledAt: opts.cancelledAt,
      updatedAt: new Date(),
    }
    this.store.set(cancelled.id, cancelled)
    return cancelled
  }
}
