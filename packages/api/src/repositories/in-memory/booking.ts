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

  async findAll(filters?: BookingFilters): Promise<Booking[]> {
    let results = [...this.store.values()]

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

    return results
  }

  async findById(id: string): Promise<Booking | undefined> {
    return this.store.get(id)
  }

  async findByIdempotencyKey(key: string): Promise<Booking | undefined> {
    for (const booking of this.store.values()) {
      if (booking.idempotencyKey === key) return booking
    }
    return undefined
  }

  async create(data: Omit<Booking, 'id' | 'createdAt' | 'updatedAt'>): Promise<Booking> {
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
          err.code = '23P01'
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
    id: string,
    expectedStatus: Booking['status'],
    newStatus: Booking['status'],
  ): Promise<Booking | undefined> {
    const existing = this.store.get(id)
    if (!existing || existing.status !== expectedStatus) return undefined

    const updated: Booking = {
      ...existing,
      status: newStatus,
      updatedAt: new Date(),
    }
    this.store.set(updated.id, updated)
    return updated
  }

  async cancel(
    id: string,
    expectedStatus: Booking['status'],
    cancellationFee: number,
    cancelledAt: Date,
  ): Promise<Booking | undefined> {
    const existing = this.store.get(id)
    if (!existing || existing.status !== expectedStatus) return undefined

    const cancelled: Booking = {
      ...existing,
      status: 'CANCELLED',
      cancellationFee,
      cancelledAt,
      updatedAt: new Date(),
    }
    this.store.set(cancelled.id, cancelled)
    return cancelled
  }
}
