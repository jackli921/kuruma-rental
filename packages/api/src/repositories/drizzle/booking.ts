import { bookings } from '@kuruma/shared/db/schema'
import { type SQL, and, count, desc, eq, ilike, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import { type CallerContext, ForbiddenError } from '../../middleware/auth'
import type { Booking } from '../../stores'
import { bookingReadScope } from '../../tenancy'
import type { OperatorBookingCounts } from '@kuruma/shared/types/operator-summary'
import type { AdminBookingFilters, BookingFilters, BookingRepository } from '../types'
import { type Db, bookingColumns, toBooking } from './shared'

export class DrizzleBookingRepository implements BookingRepository {
  constructor(private readonly db: Db) {}

  // Read scope (#392, proposal §6.2; PARTNER channel scope #1119), mirroring the
  // in-memory repo: the admin tier sees all, a PARTNER sees only its sourced
  // bookings, an operator sees only its tenant, a renter sees only their own.
  // `null` = the `none` scope (operator missing operatorId) — read nothing.
  // Otherwise returns the conditions to AND into the query (empty = unscoped).
  // Exhaustive on the union so a new scope kind can't silently read every tenant.
  private scopeConditions(ctx: CallerContext): SQL[] | null {
    const scope = bookingReadScope(ctx)
    if (scope.kind === 'none') return null
    if (scope.kind === 'operator') return [eq(bookings.operatorId, scope.operatorId)]
    if (scope.kind === 'renter') return [eq(bookings.renterId, scope.renterId)]
    if (scope.kind === 'partner') return [eq(bookings.source, scope.source)]
    if (scope.kind === 'all') return []
    scope satisfies never
    return null
  }

  async listRenterIdsForOperator(operatorId: string): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ renterId: bookings.renterId })
      .from(bookings)
      .where(eq(bookings.operatorId, operatorId))
    return rows.map((r) => r.renterId)
  }

  // #1120 admin operator summary: total (non-CANCELLED) and upcoming
  // (CONFIRMED/ACTIVE, future startAt) booking counts for one operator, in one
  // query. Mirrors the in-memory and operator-overview semantics.
  async countBookingsForOperator(
    operatorId: string,
    now: Date,
  ): Promise<OperatorBookingCounts> {
    // Pass the cutoff as an ISO string (cast to timestamptz) rather than a raw
    // Date: a bare Date interpolated into a `sql` FILTER fragment is driver-
    // dependent to bind, so we mirror countComplianceForOperator's string params.
    const nowIso = now.toISOString()
    const [row] = await this.db
      .select({
        total: sql<number>`count(*) filter (where ${bookings.status} <> 'CANCELLED')`.mapWith(
          Number,
        ),
        upcoming:
          sql<number>`count(*) filter (where ${bookings.status} in ('CONFIRMED', 'ACTIVE') and ${bookings.startAt} >= ${nowIso}::timestamptz)`.mapWith(
            Number,
          ),
      })
      .from(bookings)
      .where(eq(bookings.operatorId, operatorId))
    return { total: row?.total ?? 0, upcoming: row?.upcoming ?? 0 }
  }

  async findAll(ctx: CallerContext, filters?: BookingFilters): Promise<Booking[]> {
    const scoped = this.scopeConditions(ctx)
    if (scoped === null) return []
    const conditions: SQL[] = [...scoped]

    // #1230 slice 5a: a picker admin (all-scope) may narrow to one operator.
    // Gated on the `all` branch (defense in depth) so a tenant/renter/partner
    // scope ignores a stray operatorId — a foreign id can never widen (H2).
    if (filters?.operatorId && bookingReadScope(ctx).kind === 'all') {
      conditions.push(eq(bookings.operatorId, filters.operatorId))
    }

    if (filters?.status) {
      conditions.push(eq(bookings.status, filters.status as Booking['status']))
    }
    if (filters?.vehicleId) {
      // Filters by the assigned vehicle (the fulfilling car).
      conditions.push(eq(bookings.assignedVehicleId, filters.vehicleId))
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
    if (filters?.needsAssignment === true) {
      conditions.push(
        and(
          eq(bookings.fulfillmentMode, 'CLASS_COMBO'),
          isNull(bookings.assignedVehicleId),
          inArray(bookings.status, ['CONFIRMED', 'ACTIVE']),
        )!,
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

  // #1092: cross-operator oversight read. UNSCOPED — the platform-admin service
  // gates the caller before this runs (mirrors the in-memory impl). bookingCode
  // is a case-insensitive substring match; renterIds is a pre-resolved customer
  // filter; an EMPTY renterIds array matches nothing (inArray over []).
  async findForAdmin(filters: AdminBookingFilters): Promise<Booking[]> {
    const conditions: SQL[] = []

    if (filters.operatorId) {
      conditions.push(eq(bookings.operatorId, filters.operatorId))
    }
    if (filters.bookingCode) {
      conditions.push(ilike(bookings.bookingCode, `%${filters.bookingCode}%`))
    }
    if (filters.status) {
      conditions.push(eq(bookings.status, filters.status as Booking['status']))
    }
    if (filters.renterIds) {
      conditions.push(inArray(bookings.renterId, filters.renterIds))
    }
    if (filters.from && filters.to) {
      const fromIso = filters.from.toISOString()
      const toIso = filters.to.toISOString()
      conditions.push(
        sql`tstzrange("startAt", "effectiveEndAt") && tstzrange(${fromIso}::timestamptz, ${toIso}::timestamptz)`,
      )
    }
    if (filters.cursor) {
      const sep = filters.cursor.indexOf('_')
      const cursorTime = filters.cursor.slice(0, sep)
      const cursorId = filters.cursor.slice(sep + 1)
      conditions.push(
        or(
          lt(bookings.createdAt, sql`${cursorTime}::timestamptz`),
          and(eq(bookings.createdAt, sql`${cursorTime}::timestamptz`), lt(bookings.id, cursorId)),
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
    if (filters.limit) {
      query = query.limit(filters.limit) as typeof query
    }

    const rows = await query
    return rows.map(toBooking)
  }

  async findById(ctx: CallerContext, id: string): Promise<Booking | undefined> {
    const scoped = this.scopeConditions(ctx)
    if (scoped === null) return undefined
    const [row] = await this.db
      .select(bookingColumns)
      .from(bookings)
      .where(and(eq(bookings.id, id), ...scoped))

    return row ? toBooking(row) : undefined
  }

  async findByIdempotencyKey(ctx: CallerContext, key: string): Promise<Booking | undefined> {
    const scoped = this.scopeConditions(ctx)
    if (scoped === null) return undefined
    const [row] = await this.db
      .select(bookingColumns)
      .from(bookings)
      .where(and(eq(bookings.idempotencyKey, key), ...scoped))

    return row ? toBooking(row) : undefined
  }

  // #1087 platform overview: COUNT(bookings) across all operators (unscoped).
  async count(): Promise<number> {
    const [row] = await this.db.select({ value: count() }).from(bookings)
    return row?.value ?? 0
  }

  async countActiveForVehicles(vehicleIds: string[]): Promise<number> {
    if (vehicleIds.length === 0) return 0
    const [row] = await this.db
      .select({ value: count() })
      .from(bookings)
      .where(
        and(
          inArray(bookings.assignedVehicleId, vehicleIds),
          inArray(bookings.status, ['CONFIRMED', 'ACTIVE'] as const),
        ),
      )
    return row?.value ?? 0
  }

  // #1196: reverse of the booking→block guard. Same `tstzrange && tstzrange`
  // overlap the bookings_no_overlap exclusion rides on, so the half-open,
  // turnaround-inclusive [startAt, effectiveEndAt) window matches the in-memory
  // adapter exactly. Unscoped — the vehicle is already tenant-resolved by the caller.
  async findActiveOverlappingForVehicle(
    vehicleId: string,
    from: Date,
    to: Date,
  ): Promise<Booking[]> {
    const fromIso = from.toISOString()
    const toIso = to.toISOString()
    const rows = await this.db
      .select(bookingColumns)
      .from(bookings)
      .where(
        and(
          eq(bookings.assignedVehicleId, vehicleId),
          inArray(bookings.status, ['CONFIRMED', 'ACTIVE'] as const),
          sql`tstzrange("startAt", "effectiveEndAt") && tstzrange(${fromIso}::timestamptz, ${toIso}::timestamptz)`,
        ),
      )
    return rows.map(toBooking)
  }

  async countActiveForLocation(locationId: string): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(bookings)
      .where(
        and(
          or(
            eq(bookings.pickupLocationId, locationId),
            eq(bookings.dropoffLocationId, locationId),
          ),
          inArray(bookings.status, ['CONFIRMED', 'ACTIVE'] as const),
        ),
      )
    return row?.value ?? 0
  }

  async create(
    ctx: CallerContext,
    // cancellationFeeSettlement omitted: the DB column default ('ADVISORY', #868
    // 3a) fills it on insert; .returning() carries it back through toBooking.
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

    // The DB seals the rest: the bookings_no_overlap exclusion (23P01) prevents
    // double-booking the assigned vehicle, and the bookingCode/idempotencyKey
    // unique constraints (23505) drive the service's retry/replay branches.
    const [inserted] = await this.db
      .insert(bookings)
      .values({
        operatorId: data.operatorId,
        renterId: data.renterId,
        classId: data.classId,
        requestedVehicleId: data.requestedVehicleId,
        assignedVehicleId: data.assignedVehicleId,
        pickupLocationId: data.pickupLocationId,
        dropoffLocationId: data.dropoffLocationId,
        startAt: data.startAt,
        endAt: data.endAt,
        effectiveEndAt: data.effectiveEndAt,
        status: data.status,
        source: data.source,
        fulfillmentMode: data.fulfillmentMode,
        bookingCode: data.bookingCode,
        insuranceOptionId: data.insuranceOptionId,
        insuranceSnapshot: data.insuranceSnapshot,
        feeSnapshot: data.feeSnapshot,
        addOnSnapshot: data.addOnSnapshot,
        externalId: data.externalId,
        notes: data.notes,
        totalPrice: data.totalPrice,
        cancellationFee: data.cancellationFee,
        cancelledAt: data.cancelledAt,
        idempotencyKey: data.idempotencyKey,
        disclaimerAcknowledgedAt: data.disclaimerAcknowledgedAt,
        disclaimerTermsVersion: data.disclaimerTermsVersion,
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
    const scoped = this.scopeConditions(ctx)
    if (scoped === null) return undefined
    const [updated] = await this.db
      .update(bookings)
      .set({ status: transition.to, updatedAt: sql`now()` })
      .where(and(eq(bookings.id, id), eq(bookings.status, transition.from), ...scoped))
      .returning()

    return updated ? toBooking(updated) : undefined
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
    const scoped = this.scopeConditions(ctx)
    if (scoped === null) return undefined
    const [cancelled] = await this.db
      .update(bookings)
      .set({
        status: 'CANCELLED',
        cancellationFee: opts.fee,
        // #851: settlement written atomically with the cancel; legacy default 'ADVISORY'.
        cancellationFeeSettlement: opts.settlement ?? 'ADVISORY',
        cancelledAt: opts.cancelledAt,
        updatedAt: sql`now()`,
      })
      .where(and(eq(bookings.id, id), eq(bookings.status, opts.from), ...scoped))
      .returning()

    return cancelled ? toBooking(cancelled) : undefined
  }

  async markCancellationSettlement(
    ctx: CallerContext,
    id: string,
    transition: {
      from: Booking['cancellationFeeSettlement']
      to: Booking['cancellationFeeSettlement']
    },
  ): Promise<Booking | undefined> {
    const scoped = this.scopeConditions(ctx)
    if (scoped === null) return undefined
    // Guarded conditional transition: the WHERE on the current settlement is the
    // atomic idempotency fence (a redelivery/parallel pull matches 0 rows → no-op).
    const [updated] = await this.db
      .update(bookings)
      .set({ cancellationFeeSettlement: transition.to, updatedAt: sql`now()` })
      .where(
        and(
          eq(bookings.id, id),
          eq(bookings.cancellationFeeSettlement, transition.from),
          ...scoped,
        ),
      )
      .returning()

    return updated ? toBooking(updated) : undefined
  }

  async reassignVehicle(
    ctx: CallerContext,
    id: string,
    data: { assignedVehicleId: string; totalPrice: number | null; effectiveEndAt: Date },
  ): Promise<Booking | undefined> {
    const scoped = this.scopeConditions(ctx)
    if (scoped === null) return undefined
    // The bookings_no_overlap exclusion re-checks the NEW assignedVehicleId over
    // [startAt, effectiveEndAt) on UPDATE; a conflicting range raises 23P01,
    // which the service maps to a 409 (mirrors the in-memory exclusion mirror).
    // requestedVehicleId is deliberately never touched.
    const [updated] = await this.db
      .update(bookings)
      .set({
        assignedVehicleId: data.assignedVehicleId,
        totalPrice: data.totalPrice,
        effectiveEndAt: data.effectiveEndAt,
        updatedAt: sql`now()`,
      })
      .where(and(eq(bookings.id, id), ...scoped))
      .returning()

    return updated ? toBooking(updated) : undefined
  }
}
