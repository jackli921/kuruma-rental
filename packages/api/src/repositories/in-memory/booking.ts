import type { OperatorBookingCounts } from '@kuruma/shared/types/operator-summary'
import { type CallerContext, ForbiddenError } from '../../middleware/auth'
import { BOOKING_CODE_CONSTRAINT, IDEMPOTENCY_CONSTRAINT, PG_ERROR } from '../../pg-errors'
import type { Booking } from '../../stores'
import { bookingReadScope } from '../../tenancy'
import type { AdminBookingFilters, BookingFilters, BookingRepository } from '../types'

export const BLOCKING_STATUSES: ReadonlySet<Booking['status']> = new Set(['CONFIRMED', 'ACTIVE'])

// Mirror postgres-js's PostgresError shape: the violated constraint is exposed
// as `constraint_name` (NOT `constraint`), which is what `pgConstraintName`
// reads. Faithful mirroring lets the service's retry/replay branch behave
// identically against the in-memory and Drizzle repos.
function uniqueViolation(
  constraintName: string,
): Error & { code: string; constraint_name: string } {
  return Object.assign(new Error(`duplicate key violates unique constraint "${constraintName}"`), {
    code: PG_ERROR.UNIQUE_VIOLATION,
    constraint_name: constraintName,
  })
}

// Same faithful-mirroring policy as uniqueViolation: postgres-js exposes the
// violated EXCLUDE constraint as `constraint_name`, so a service that disambiguates
// 23P01 by name behaves identically against either repo (#1106).
const BOOKINGS_NO_OVERLAP_CONSTRAINT = 'bookings_no_overlap'

function exclusionViolation(): Error & { code: string; constraint_name: string } {
  return Object.assign(
    new Error(
      `conflicting key value violates exclusion constraint "${BOOKINGS_NO_OVERLAP_CONSTRAINT}"`,
    ),
    {
      code: PG_ERROR.EXCLUSION_VIOLATION,
      constraint_name: BOOKINGS_NO_OVERLAP_CONSTRAINT,
    },
  )
}

export function getConflictingBookings(
  bookings: Booking[],
  vehicleId: string,
  from: Date,
  to: Date,
): Booking[] {
  return bookings.filter((booking) => {
    // #392: the exclusion keys on the ASSIGNED vehicle (NOT NULL post-slice-6).
    if (booking.assignedVehicleId !== vehicleId) return false
    if (!BLOCKING_STATUSES.has(booking.status)) return false
    // effectiveEndAt already includes the turnaround window (location-derived).
    return booking.startAt < to && booking.effectiveEndAt > from
  })
}

export class InMemoryBookingRepository implements BookingRepository {
  private readonly store: Map<string, Booking>

  constructor(store?: Map<string, Booking>) {
    this.store = store ?? new Map()
  }

  // Read scope (#392, proposal §6.2; PARTNER channel scope #1119): the admin
  // tier sees all, a PARTNER sees only its sourced bookings, an operator sees
  // only its tenant's, a renter sees only their own. Exhaustive on the union so a
  // new scope kind can't silently fall through to reading every tenant's rows.
  private scopedValues(ctx: CallerContext): Booking[] {
    const scope = bookingReadScope(ctx)
    if (scope.kind === 'none') return []
    const all = [...this.store.values()]
    if (scope.kind === 'operator') return all.filter((b) => b.operatorId === scope.operatorId)
    if (scope.kind === 'renter') return all.filter((b) => b.renterId === scope.renterId)
    if (scope.kind === 'partner') return all.filter((b) => b.source === scope.source)
    if (scope.kind === 'all') return all
    scope satisfies never
    return []
  }

  async listRenterIdsForOperator(operatorId: string): Promise<string[]> {
    const ids = new Set<string>()
    for (const b of this.store.values()) {
      if (b.operatorId === operatorId) ids.add(b.renterId)
    }
    return [...ids]
  }

  private isVisible(ctx: CallerContext, booking: Booking): boolean {
    const scope = bookingReadScope(ctx)
    if (scope.kind === 'none') return false
    if (scope.kind === 'operator') return booking.operatorId === scope.operatorId
    if (scope.kind === 'renter') return booking.renterId === scope.renterId
    if (scope.kind === 'partner') return booking.source === scope.source
    if (scope.kind === 'all') return true
    scope satisfies never
    return false
  }

  async findAll(ctx: CallerContext, filters?: BookingFilters): Promise<Booking[]> {
    let results = this.scopedValues(ctx)

    if (filters?.status) {
      results = results.filter((b) => b.status === filters.status)
    }
    if (filters?.vehicleId) {
      // Filters by the assigned vehicle (the fulfilling car).
      results = results.filter((b) => b.assignedVehicleId === filters.vehicleId)
    }
    if (filters?.renterId) {
      results = results.filter((b) => b.renterId === filters.renterId)
    }
    if (filters?.from && filters?.to) {
      const from = filters.from
      const to = filters.to
      results = results.filter((b) => b.startAt < to && b.effectiveEndAt > from)
    }
    if (filters?.needsAssignment === true) {
      results = results.filter(
        (b) =>
          b.fulfillmentMode === 'CLASS_COMBO' &&
          b.assignedVehicleId === null &&
          (b.status === 'CONFIRMED' || b.status === 'ACTIVE'),
      )
    }

    // Sort by createdAt DESC, id DESC (matches Drizzle ORDER BY)
    results.sort((a, b) => {
      const timeDiff = b.createdAt.getTime() - a.createdAt.getTime()
      if (timeDiff !== 0) return timeDiff
      return b.id < a.id ? -1 : 1
    })

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

    if (filters?.limit) {
      results = results.slice(0, filters.limit)
    }

    return results
  }

  // #1092: cross-operator oversight read. UNSCOPED on purpose — the
  // platform-admin service gates the caller before this runs. Mirrors the
  // Drizzle impl's ordering (createdAt DESC, id DESC) and cursor semantics.
  async findForAdmin(filters: AdminBookingFilters): Promise<Booking[]> {
    let results = [...this.store.values()]

    if (filters.operatorId) {
      results = results.filter((b) => b.operatorId === filters.operatorId)
    }
    if (filters.bookingCode) {
      const needle = filters.bookingCode.toLowerCase()
      results = results.filter((b) => b.bookingCode.toLowerCase().includes(needle))
    }
    if (filters.status) {
      results = results.filter((b) => b.status === filters.status)
    }
    if (filters.renterIds) {
      const ids = new Set(filters.renterIds)
      results = results.filter((b) => ids.has(b.renterId))
    }
    if (filters.from && filters.to) {
      const from = filters.from
      const to = filters.to
      results = results.filter((b) => b.startAt < to && b.effectiveEndAt > from)
    }

    results.sort((a, b) => {
      const timeDiff = b.createdAt.getTime() - a.createdAt.getTime()
      if (timeDiff !== 0) return timeDiff
      return b.id < a.id ? -1 : 1
    })

    if (filters.cursor) {
      const sep = filters.cursor.indexOf('_')
      const cursorTime = new Date(filters.cursor.slice(0, sep))
      const cursorId = filters.cursor.slice(sep + 1)
      results = results.filter((b) => {
        if (b.createdAt.getTime() < cursorTime.getTime()) return true
        if (b.createdAt.getTime() === cursorTime.getTime() && b.id < cursorId) return true
        return false
      })
    }

    if (filters.limit) {
      results = results.slice(0, filters.limit)
    }

    return results
  }

  async findById(ctx: CallerContext, id: string): Promise<Booking | undefined> {
    const booking = this.store.get(id)
    if (!booking) return undefined
    return this.isVisible(ctx, booking) ? booking : undefined
  }

  async findByIdempotencyKey(ctx: CallerContext, key: string): Promise<Booking | undefined> {
    for (const booking of this.store.values()) {
      if (booking.idempotencyKey === key) {
        return this.isVisible(ctx, booking) ? booking : undefined
      }
    }
    return undefined
  }

  // #1087: platform-overview total booking count across all operators (unscoped).
  async count(): Promise<number> {
    return this.store.size
  }

  // #1120 admin operator summary: mirrors the operator-overview booking semantics
  // for one admin-named operator — total excludes CANCELLED; upcoming is a
  // CONFIRMED/ACTIVE booking whose pickup is still in the future.
  async countBookingsForOperator(operatorId: string, now: Date): Promise<OperatorBookingCounts> {
    let total = 0
    let upcoming = 0
    for (const b of this.store.values()) {
      if (b.operatorId !== operatorId) continue
      if (b.status === 'CANCELLED') continue
      total++
      if (BLOCKING_STATUSES.has(b.status) && b.startAt.getTime() >= now.getTime()) upcoming++
    }
    return { total, upcoming }
  }

  async countActiveForVehicles(vehicleIds: string[]): Promise<number> {
    if (vehicleIds.length === 0) return 0
    const ids = new Set(vehicleIds)
    let count = 0
    for (const booking of this.store.values()) {
      // #464: a CLASS_COMBO float (null assignedVehicleId) occupies no specific car.
      if (
        booking.assignedVehicleId !== null &&
        ids.has(booking.assignedVehicleId) &&
        BLOCKING_STATUSES.has(booking.status)
      )
        count++
    }
    return count
  }

  async countActiveForLocation(locationId: string): Promise<number> {
    let count = 0
    for (const booking of this.store.values()) {
      const referencesLocation =
        booking.pickupLocationId === locationId || booking.dropoffLocationId === locationId
      if (referencesLocation && BLOCKING_STATUSES.has(booking.status)) count++
    }
    return count
  }

  async create(
    ctx: CallerContext,
    data: Omit<Booking, 'id' | 'createdAt' | 'updatedAt' | 'cancellationFeeSettlement'>,
  ): Promise<Booking> {
    const scope = bookingReadScope(ctx)
    if (scope.kind === 'none') throw new ForbiddenError('operator scope required')
    if (scope.kind === 'renter' && data.renterId !== scope.renterId) {
      throw new ForbiddenError('Cannot create booking for another user')
    }
    if (scope.kind === 'operator' && data.operatorId !== scope.operatorId) {
      throw new ForbiddenError('Cannot create booking for another operator')
    }

    // Mirror the DB `bookings_no_overlap` exclusion on the ASSIGNED vehicle:
    // `EXCLUDE USING gist ("assignedVehicleId" WITH =, tstzrange &&)`. Postgres
    // never conflicts NULL keys, so a CLASS_COMBO float (null vehicle, #464)
    // occupies no specific car and is invisible to the exclusion. Guard on a
    // non-null vehicle first — `null !== null` is false, so without this an
    // overlapping pair of floats would falsely clash (#1105 / #1117).
    if (data.assignedVehicleId !== null && BLOCKING_STATUSES.has(data.status)) {
      for (const existing of this.store.values()) {
        if (existing.assignedVehicleId !== data.assignedVehicleId) continue
        if (!BLOCKING_STATUSES.has(existing.status)) continue
        const overlaps =
          data.startAt < existing.effectiveEndAt && existing.startAt < data.effectiveEndAt
        if (overlaps) {
          throw exclusionViolation()
        }
      }
    }

    for (const existing of this.store.values()) {
      // bookingCode is UNIQUE NOT NULL — the service retries on this clash (§5.4).
      if (existing.bookingCode === data.bookingCode) throw uniqueViolation(BOOKING_CODE_CONSTRAINT)
      if (data.idempotencyKey && existing.idempotencyKey === data.idempotencyKey) {
        throw uniqueViolation(IDEMPOTENCY_CONSTRAINT)
      }
    }

    const now = new Date()
    // Mirror the DB column default (#868 3a): a fresh booking carries no fee yet,
    // so its settlement starts ADVISORY. cancel() leaves this untouched (#851 flips it).
    const booking: Booking = {
      ...data,
      cancellationFeeSettlement: 'ADVISORY',
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
    if (!this.isVisible(ctx, existing)) return undefined

    const updated: Booking = { ...existing, status: transition.to, updatedAt: new Date() }
    this.store.set(updated.id, updated)
    return updated
  }

  async cancel(
    ctx: CallerContext,
    id: string,
    opts: {
      from: Booking['status']
      fee: number
      cancelledAt: Date
      settlement?: Booking['cancellationFeeSettlement']
    },
  ): Promise<Booking | undefined> {
    const existing = this.store.get(id)
    if (!existing || existing.status !== opts.from) return undefined
    if (!this.isVisible(ctx, existing)) return undefined

    const cancelled: Booking = {
      ...existing,
      status: 'CANCELLED',
      cancellationFee: opts.fee,
      // #851: written atomically with the cancel; defaults to the legacy 'ADVISORY'.
      cancellationFeeSettlement: opts.settlement ?? 'ADVISORY',
      cancelledAt: opts.cancelledAt,
      updatedAt: new Date(),
    }
    this.store.set(cancelled.id, cancelled)
    return cancelled
  }

  async markCancellationSettlement(
    ctx: CallerContext,
    id: string,
    transition: {
      from: Booking['cancellationFeeSettlement']
      to: Booking['cancellationFeeSettlement']
    },
  ): Promise<Booking | undefined> {
    const existing = this.store.get(id)
    // Guarded: only advance when the current value still matches `from` (idempotent).
    if (!existing || existing.cancellationFeeSettlement !== transition.from) return undefined
    if (!this.isVisible(ctx, existing)) return undefined

    const updated: Booking = {
      ...existing,
      cancellationFeeSettlement: transition.to,
      updatedAt: new Date(),
    }
    this.store.set(updated.id, updated)
    return updated
  }

  async reassignVehicle(
    ctx: CallerContext,
    id: string,
    data: { assignedVehicleId: string; totalPrice: number | null; effectiveEndAt: Date },
  ): Promise<Booking | undefined> {
    const existing = this.store.get(id)
    if (!existing || !this.isVisible(ctx, existing)) return undefined

    // Re-check the exclusion constraint for the NEW assigned vehicle over the
    // booking's window, skipping the booking itself — mirrors the DB
    // bookings_no_overlap re-check on UPDATE assignedVehicleId (§5.5).
    if (BLOCKING_STATUSES.has(existing.status)) {
      for (const other of this.store.values()) {
        if (other.id === id) continue
        if (other.assignedVehicleId !== data.assignedVehicleId) continue
        if (!BLOCKING_STATUSES.has(other.status)) continue
        const overlaps =
          existing.startAt < other.effectiveEndAt && other.startAt < data.effectiveEndAt
        if (overlaps) {
          throw exclusionViolation()
        }
      }
    }

    const updated: Booking = {
      ...existing,
      assignedVehicleId: data.assignedVehicleId,
      totalPrice: data.totalPrice,
      effectiveEndAt: data.effectiveEndAt,
      updatedAt: new Date(),
    }
    this.store.set(id, updated)
    return updated
  }
}
