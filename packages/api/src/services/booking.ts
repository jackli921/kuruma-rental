import type { AddOnSnapshot, InsuranceSnapshot } from '@kuruma/shared/db/schema'
import { type BookingStatus, VALID_BOOKING_TRANSITIONS } from '@kuruma/shared/db/schema'
import { calculateCancellationFee } from '@kuruma/shared/lib/cancellation-policy'
import { calculateBookingPrice } from '@kuruma/shared/lib/pricing'
import { checkRentalRules } from '@kuruma/shared/lib/rental-rules'
import { generateBookingCode } from '../lib/booking-code'
import { type CallerContext, SYSTEM_CONTEXT } from '../middleware/auth'
import { BOOKING_CODE_CONSTRAINT, PG_ERROR, pgConstraintName, pgErrorCode } from '../pg-errors'
import type {
  BookingEventRepository,
  BookingFilters,
  BookingRepository,
  OperatorRepository,
  RunInTransaction,
  TransactionRepos,
  UserRepository,
  VehicleClassRepository,
  VehicleRepository,
} from '../repositories/types'
import type { Booking, BookingEvent } from '../stores'
import type { BookingPostCommitDispatcher } from './booking-post-commit-dispatcher'
import type {
  BookingVerificationGate,
  CancelResult,
  CreateBookingInput,
  CreateBookingResult,
  StatusTransitionResult,
  SubstituteResult,
  SubstitutionCandidatesResult,
} from './booking-results'

// Re-exported so existing importers of these service-layer types keep their
// `from '.../services/booking'` path after the #616 split into booking-results.ts.
export type { CreateBookingInput, BookingVerificationGate } from './booking-results'

/** Renter-safe operator projection attached to a single booking read (§4h). */
export type BookingWithOperator = Booking & {
  operator?: { name: string; preAuthHandoffUrl: string | null }
}

const MS_PER_MINUTE = 60 * 1000
const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE
// Location-only turnaround fallback when a pickup location has no value set
// (§5.3, proposal §9 item 20). The legacy 60-min vehicle buffer is GONE — a
// 60-min result is a regression the turnaround test pins against.
const DEFAULT_TURNAROUND_MINUTES = 2880 // 48h
// A booking_code collision is ~2^-40 per attempt; a few retries is plenty.
const MAX_BOOKING_CODE_ATTEMPTS = 3
// #613: version of the liability-disclaimer (免责声明) wording a renter agreed to,
// stamped onto the booking. Bump when the localized terms text changes materially
// (the renter-facing copy lives in web i18n; this is the server-authoritative tag).
export const DISCLAIMER_TERMS_VERSION = '2026-06-13'

// One page covers an operator's fleet (~40-50 cars; the vehicles read caps at 100).
const SUBSTITUTION_CANDIDATE_LIMIT = 100

/**
 * Opt-in messaging hook. When supplied, every confirmed booking also creates
 * a thread with `[renter, staffUserId]` as participants. Failure to create
 * the thread never rolls back the booking (it runs AFTER commit).
 */
export class BookingService {
  constructor(
    private readonly bookingRepo: BookingRepository,
    private readonly runInTransaction: RunInTransaction,
    private readonly vehicleRepo?: VehicleRepository,
    private readonly userRepo?: UserRepository,
    private readonly vehicleClassRepo?: VehicleClassRepository,
    // Single post-commit seam (#393, TODO #300): ensureThread + notifications,
    // each caught-and-logged. Replaces the inline ensureThread calls.
    private readonly postCommit?: BookingPostCommitDispatcher,
    // §4h: reads the renter-safe operator projection for findById. Unscoped repo
    // read — the booking is already tenant-checked, and only name + handoff URL
    // are exposed, so no cross-tenant leak.
    private readonly operatorRepo?: OperatorRepository,
    // #549: read side of the append-only lifecycle log, surfaced to the operator
    // trip-detail timeline via findEvents. Distinct from the transactional
    // bookingEventRepo used for appends inside runInTransaction.
    private readonly bookingEventRepo?: BookingEventRepository,
    // Injectable so the collision-retry path is deterministically testable.
    private readonly generateCode: () => string = generateBookingCode,
    // #459: optional document-verification gate, wired only when the
    // REQUIRE_DOCUMENT_VERIFICATION flag is on (see index.ts composition root).
    private readonly verificationGate?: BookingVerificationGate,
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

    // The fulfilling car is the assigned vehicle (#392 — vehicleId is gone).
    const vehicleIds = [...new Set(data.map((b) => b.assignedVehicleId))]
    const vehicleList = await this.vehicleRepo.findByIds(ctx, vehicleIds)
    const vehicleMap = new Map(vehicleList.map((v) => [v.id, { name: v.name, photos: v.photos }]))

    return {
      data: data.map((booking) => ({
        ...booking,
        vehicle: vehicleMap.get(booking.assignedVehicleId),
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

  async findAllWithVehiclesAndRentersPaginated(
    ctx: CallerContext,
    filters: BookingFilters,
  ): Promise<{
    data: (Booking & {
      vehicle?: { name: string; photos: string[] } | undefined
      renter?:
        | { id: string; name: string | null; email: string | null; language: string }
        | undefined
    })[]
    nextCursor: string | null
  }> {
    const { data, nextCursor } = await this.findAllPaginated(ctx, filters)

    const vehicleIds = [...new Set(data.map((b) => b.assignedVehicleId))]
    const vehicleList = this.vehicleRepo ? await this.vehicleRepo.findByIds(ctx, vehicleIds) : []
    const vehicleMap = new Map(vehicleList.map((v) => [v.id, { name: v.name, photos: v.photos }]))

    const renterIds = [...new Set(data.map((b) => b.renterId))]
    const userList = this.userRepo ? await this.userRepo.findByIds(renterIds) : []
    const renterMap = new Map(
      userList.map((u) => [u.id, { id: u.id, name: u.name, email: u.email, language: u.language }]),
    )

    return {
      data: data.map((booking) => ({
        ...booking,
        vehicle: vehicleMap.get(booking.assignedVehicleId),
        renter: renterMap.get(booking.renterId),
      })),
      nextCursor,
    }
  }

  async findById(ctx: CallerContext, id: string): Promise<BookingWithOperator | undefined> {
    const booking = await this.bookingRepo.findById(ctx, id)
    if (!booking || !this.operatorRepo) return booking
    // The renter already owns this booking (scope enforced above); exposing their
    // operator's public handoff URL + name leaks nothing cross-tenant (§4h).
    const operator = await this.operatorRepo.findById(booking.operatorId)
    if (!operator) return booking
    return {
      ...booking,
      operator: { name: operator.name, preAuthHandoffUrl: operator.preAuthHandoffUrl },
    }
  }

  /**
   * #549: single-read enrichment for the deep-linked trip-detail page. ENRICHES
   * the findById result (booking + renter-safe operator projection, §4h) with
   * the assigned vehicle + renter — it never replaces the operator block. Mirrors
   * the list endpoint's `expand=vehicle,renter` projection shape.
   */
  async findByIdWithVehicleAndRenter(
    ctx: CallerContext,
    id: string,
  ): Promise<
    | (BookingWithOperator & {
        vehicle?: { name: string; photos: string[] } | undefined
        renter?:
          | { id: string; name: string | null; email: string | null; language: string }
          | undefined
      })
    | undefined
  > {
    const booking = await this.findById(ctx, id)
    if (!booking) return booking

    const [vehicle] = this.vehicleRepo
      ? await this.vehicleRepo.findByIds(ctx, [booking.assignedVehicleId])
      : []
    const [renter] = this.userRepo ? await this.userRepo.findByIds([booking.renterId]) : []

    return {
      ...booking,
      vehicle: vehicle ? { name: vehicle.name, photos: vehicle.photos } : undefined,
      renter: renter
        ? { id: renter.id, name: renter.name, email: renter.email, language: renter.language }
        : undefined,
    }
  }

  /**
   * #549: the operator trip-detail timeline. Authorize via findById first — its
   * tenant read-scope means operator A reading operator B's booking gets
   * `undefined` (→ 404, no leak), not just an empty list. Returns the events in
   * the repository's deterministic order (createdAt asc, id tiebreaker).
   */
  async findEvents(ctx: CallerContext, id: string): Promise<BookingEvent[] | undefined> {
    const booking = await this.findById(ctx, id)
    if (!booking) return undefined
    if (!this.bookingEventRepo) return []
    return this.bookingEventRepo.findByBookingId(ctx, id)
  }

  async create(
    ctx: CallerContext,
    input: CreateBookingInput,
    now: Date = new Date(),
  ): Promise<CreateBookingResult> {
    // Staff/admin override path: validate the target renterId exists and is a
    // RENTER — prevents bookings attached to other staff/admin accounts and
    // surfaces FK failures as a friendly 400 rather than a generic 500.
    if (input.renterId !== ctx.userId && this.userRepo) {
      const [renter] = await this.userRepo.findByIds([input.renterId])
      if (!renter) {
        return { ok: false, status: 400, error: 'Renter not found' }
      }
      if ((renter.role ?? 'RENTER') !== 'RENTER') {
        return { ok: false, status: 400, error: 'Target user is not a renter' }
      }
    }

    // Idempotency: if a key was provided, replay an existing booking first.
    if (input.idempotencyKey) {
      const existing = await this.bookingRepo.findByIdempotencyKey(ctx, input.idempotencyKey)
      if (existing) {
        await this.postCommit?.run(ctx, existing)
        return { ok: true, booking: existing, status: 200 }
      }
    }

    // Document-verification gate (#459). When wired (REQUIRE_DOCUMENT_VERIFICATION
    // on), an unverified renter is blocked here — before any booking work. Runs
    // AFTER idempotency replay so a previously-accepted booking stays replayable
    // even if the renter's document later expires.
    if (this.verificationGate) {
      const gate = await this.verificationGate(ctx, input)
      if (!gate.ok) return gate
    }

    // The whole submit is ONE transaction (proposal §4): resolve + price +
    // snapshot + insert booking + append BOOKING_CREATED, atomically. The
    // booking_code is generated inside the tx, so a UNIQUE clash re-runs the
    // entire atomic insert cleanly (§5.4) — bounded retry around the tx.
    let lastErr: unknown
    for (let attempt = 0; attempt < MAX_BOOKING_CODE_ATTEMPTS; attempt++) {
      try {
        const result = await this.runInTransaction((repos) =>
          this.submitInTx(ctx, input, now, repos),
        )
        if (!result.ok) return result // domain validation failure — never retried
        // Post-commit side effects (#335 thread + #393 notifications) — never in
        // the tx; awaited, caught-and-logged in the dispatcher (booking authoritative).
        await this.postCommit?.run(ctx, result.booking)
        return { ok: true, booking: result.booking }
      } catch (err) {
        const code = pgErrorCode(err)
        if (
          code === PG_ERROR.UNIQUE_VIOLATION &&
          pgConstraintName(err) === BOOKING_CODE_CONSTRAINT
        ) {
          lastErr = err // regenerate + retry the whole atomic insert
          continue
        }
        if (code === PG_ERROR.EXCLUSION_VIOLATION) {
          return {
            ok: false,
            status: 409,
            error: 'Vehicle is already booked for the requested time range',
          }
        }
        // Idempotency-key race: a concurrent replay won — return its booking.
        if (code === PG_ERROR.UNIQUE_VIOLATION && input.idempotencyKey) {
          const existing = await this.bookingRepo.findByIdempotencyKey(ctx, input.idempotencyKey)
          if (existing) {
            await this.postCommit?.run(ctx, existing)
            return { ok: true, booking: existing, status: 200 }
          }
        }
        throw err
      }
    }
    // Exhausted the bounded retries — surface as a 500 at the route boundary.
    throw lastErr
  }

  // The atomic decision-and-record (FC/IS: the decision; ensureThread is the
  // imperative shell). Resolution reads run as SYSTEM_CONTEXT — these are
  // internal pricing/snapshot reads, and insurance/fee reads reject RENTER
  // callers by design; the booking's tenant is derived from the vehicle, not
  // the caller. The booking + event WRITES use the caller's ctx (renter-own /
  // operator scope is enforced at the repo).
  private async submitInTx(
    ctx: CallerContext,
    input: CreateBookingInput,
    now: Date,
    repos: TransactionRepos,
  ): Promise<CreateBookingResult> {
    const vehicle = await repos.vehicleRepo.findById(SYSTEM_CONTEXT, input.requestedVehicleId)
    if (!vehicle) {
      return { ok: false, status: 400, error: 'Vehicle not found' }
    }
    if (vehicle.status !== 'AVAILABLE') {
      return { ok: false, status: 400, error: 'Vehicle is not available' }
    }
    if (!vehicle.classId) {
      return { ok: false, status: 400, error: 'Vehicle has no class' }
    }
    const operatorId = vehicle.operatorId
    const classId = vehicle.classId
    const assignedVehicleId = vehicle.id // server-derived = requested at submit

    const ruleCheck = checkRentalRules(
      {
        minRentalHours: vehicle.minRentalHours,
        maxRentalHours: vehicle.maxRentalHours,
        advanceBookingHours: input.source === 'MANUAL' ? null : vehicle.advanceBookingHours,
      },
      input.startAt,
      input.endAt,
      now,
    )
    if (!ruleCheck.ok) {
      return {
        ok: false,
        status: 400,
        error: 'Booking violates a rental rule on this vehicle',
        code: ruleCheck.code,
        details: { required: ruleCheck.required, actual: ruleCheck.actual },
      }
    }

    // The car physically lives at its own storefront, so a booking can only pick
    // it up there. Without this, a forged body could pair a vehicle with another
    // of the operator's locations — the operator check below passes (same tenant)
    // but the stamped pickup/turnaround would lie about where the car is (#392).
    if (vehicle.pickupLocationId !== input.pickupLocationId) {
      return { ok: false, status: 400, error: 'Pickup location does not match the vehicle' }
    }

    // Turnaround is location-only (§5.3): pickup location's default, 48h fallback.
    const pickup = await repos.locationRepo.findById(SYSTEM_CONTEXT, input.pickupLocationId)
    if (!pickup || pickup.operatorId !== operatorId) {
      return { ok: false, status: 400, error: 'Pickup location is not available' }
    }
    if (input.dropoffLocationId !== input.pickupLocationId) {
      const dropoff = await repos.locationRepo.findById(SYSTEM_CONTEXT, input.dropoffLocationId)
      if (!dropoff || dropoff.operatorId !== operatorId) {
        return { ok: false, status: 400, error: 'Dropoff location is not available' }
      }
    }
    const turnaroundMinutes = pickup.defaultTurnaroundMinutes ?? DEFAULT_TURNAROUND_MINUTES
    const effectiveEndAt = new Date(input.endAt.getTime() + turnaroundMinutes * MS_PER_MINUTE)

    // Price off the ASSIGNED vehicle's rates — never class-level (#406), never
    // client-supplied (#74), non-null on every submit (#429 backfill guard).
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
            ? 'No daily or hourly rate configured'
            : 'Invalid booking duration',
        code: pricing.code,
      }
    }
    let totalPrice = pricing.totalPriceJpy

    // Selected insurance: snapshot the chosen ACTIVE option from THIS operator.
    let insuranceOptionId: string | null = null
    let insuranceSnapshot: InsuranceSnapshot | null = null
    if (input.insuranceOptionId) {
      const opt = await repos.insuranceOptionRepo.findById(SYSTEM_CONTEXT, input.insuranceOptionId)
      if (!opt || opt.operatorId !== operatorId || opt.status !== 'ACTIVE') {
        return { ok: false, status: 400, error: 'Insurance option is not available' }
      }
      insuranceOptionId = opt.id
      insuranceSnapshot = {
        insuranceOptionId: opt.id,
        name: opt.name,
        dailyPriceJpy: opt.dailyPriceJpy,
        deductibleJpy: opt.deductibleJpy,
      }
      totalPrice += opt.dailyPriceJpy * rentalDays(input.startAt, input.endAt)
    }

    // Fee snapshot: this operator's ACTIVE fees that are operator-wide or match
    // the booking's class. Locks the rate at booking time (§6.2, informational).
    const fees = await repos.feeScheduleRepo.findAll(SYSTEM_CONTEXT, {
      operatorId,
      status: 'ACTIVE',
    })
    const feeSnapshot = fees
      .filter((f) => f.vehicleClassId === null || f.vehicleClassId === classId)
      .map((f) => ({
        feeType: f.feeType,
        unit: f.unit,
        amountJpy: f.amountJpy,
        vehicleClassId: f.vehicleClassId,
      }))

    // Selected paid add-ons (#460): each flat priceJpy is added to totalPrice and
    // snapshotted. One ACTIVE-only, this-operator read validates membership +
    // tenant + active in a single query (a foreign/archived id is simply absent
    // -> 400). De-dup so a repeated id is charged once (quantity is out of MVP).
    const addOnSnapshot: AddOnSnapshot[] = []
    if (input.addOnIds.length > 0) {
      const available = await repos.addOnRepo.findActiveByOperator(operatorId)
      const availableById = new Map(available.map((a) => [a.id, a]))
      for (const addOnId of new Set(input.addOnIds)) {
        const addOn = availableById.get(addOnId)
        if (!addOn) return { ok: false, status: 400, error: 'Add-on is not available' }
        addOnSnapshot.push({ addOnId: addOn.id, name: addOn.name, priceJpy: addOn.priceJpy })
        totalPrice += addOn.priceJpy
      }
    }

    const bookingCode = this.generateCode()

    // Insert FIRST: the exclusion / unique constraints fire here, BEFORE the
    // event append, so a rolled-back insert leaves no orphan event (atomicity).
    const booking = await repos.bookingRepo.create(ctx, {
      operatorId,
      renterId: input.renterId,
      classId,
      requestedVehicleId: input.requestedVehicleId,
      assignedVehicleId,
      pickupLocationId: input.pickupLocationId,
      dropoffLocationId: input.dropoffLocationId,
      startAt: input.startAt,
      endAt: input.endAt,
      effectiveEndAt,
      status: 'CONFIRMED',
      source: input.source,
      // #463: server-derived. Every pre-demo submit is SPECIFIC; CLASS_COMBO is #464.
      fulfillmentMode: 'SPECIFIC',
      bookingCode,
      insuranceOptionId,
      insuranceSnapshot,
      feeSnapshot,
      addOnSnapshot,
      externalId: input.externalId ?? null,
      notes: input.notes ?? null,
      totalPrice,
      cancellationFee: null,
      cancelledAt: null,
      idempotencyKey: input.idempotencyKey ?? null,
      // #613: stamp the liability-disclaimer consent server-side (never trust a
      // client timestamp). Set only when the renter accepted; null for staff/
      // manual bookings (the route exempts non-renter callers from the gate).
      disclaimerAcknowledgedAt: input.disclaimerAccepted ? now : null,
      disclaimerTermsVersion: input.disclaimerAccepted ? DISCLAIMER_TERMS_VERSION : null,
    })

    await repos.bookingEventRepo.append(ctx, {
      bookingId: booking.id,
      type: 'BOOKING_CREATED',
      // The actor is who PERFORMED the booking (the authed caller), not the
      // subject: a staff/manual booking records the staff member, not the
      // customer. The renter lives in the booking row + payload. Mirrors
      // VEHICLE_SUBSTITUTED, which also uses ctx.userId.
      actorId: ctx.userId,
      payload: {
        requestedVehicleId: input.requestedVehicleId,
        assignedVehicleId,
        classId,
        fulfillmentMode: 'SPECIFIC', // #463: mirror the booking's discriminator in the audit snapshot
        startAt: input.startAt.toISOString(),
        endAt: input.endAt.toISOString(),
        totalPrice,
        insuranceSnapshot,
        feeSnapshot,
        addOnSnapshot,
      },
    })

    return { ok: true, booking }
  }

  /**
   * Operator vehicle substitution (#392, §5.5). One transaction: load the
   * booking scoped to the caller (cross-operator -> 404, no leak), validate the
   * replacement is the same operator + same pickup location + same ACRISS class,
   * re-snapshot totalPrice off the new vehicle (#429, preserving locked
   * insurance), reassign (the exclusion constraint re-checks the new vehicle
   * atomically -> 409 if it's already booked), and append VEHICLE_SUBSTITUTED.
   * requestedVehicleId is never mutated — the audit trail keeps what the renter
   * originally selected. The route gates this to OPERATOR_* callers (#392 §7).
   */
  async substitute(
    ctx: CallerContext,
    bookingId: string,
    newVehicleId: string,
    reason: string | null = null,
  ): Promise<SubstituteResult> {
    try {
      return await this.runInTransaction(async (repos) => {
        const booking = await repos.bookingRepo.findById(ctx, bookingId)
        if (!booking) {
          return { ok: false, status: 404, error: 'Booking not found' }
        }
        if (booking.status !== 'CONFIRMED' && booking.status !== 'ACTIVE') {
          return { ok: false, status: 409, error: `Cannot substitute a ${booking.status} booking` }
        }

        const replacement = await repos.vehicleRepo.findById(SYSTEM_CONTEXT, newVehicleId)
        // Cross-operator (or missing) -> 404, no existence leak (mirrors slice 4).
        if (!replacement || replacement.operatorId !== booking.operatorId) {
          return { ok: false, status: 404, error: 'Replacement vehicle not found' }
        }
        if (replacement.status !== 'AVAILABLE') {
          return { ok: false, status: 400, error: 'Replacement vehicle is not available' }
        }
        if ((replacement.pickupLocationId ?? null) !== booking.pickupLocationId) {
          return {
            ok: false,
            status: 400,
            error: 'Replacement vehicle serves a different pickup location',
          }
        }
        if (
          !replacement.classId ||
          !(await this.sameAcrissClass(booking.classId, replacement.classId))
        ) {
          return { ok: false, status: 400, error: 'Replacement vehicle is a different class' }
        }

        // Re-snapshot price from the new vehicle's rates (#429), preserving any
        // selected-insurance daily price already locked on the booking.
        const pricing = calculateBookingPrice(
          { dailyRateJpy: replacement.dailyRateJpy, hourlyRateJpy: replacement.hourlyRateJpy },
          booking.startAt,
          booking.endAt,
        )
        if (!pricing.ok) {
          return {
            ok: false,
            status: 400,
            error: 'Replacement vehicle has no usable rate',
          }
        }
        const insurancePerDay = booking.insuranceSnapshot?.dailyPriceJpy ?? 0
        const totalPrice =
          pricing.totalPriceJpy + insurancePerDay * rentalDays(booking.startAt, booking.endAt)

        // Turnaround is location-only and the pickup location is unchanged, so
        // effectiveEndAt is preserved; the repo re-runs the exclusion check for
        // the NEW assigned vehicle over that window atomically.
        const updated = await repos.bookingRepo.reassignVehicle(ctx, booking.id, {
          assignedVehicleId: replacement.id,
          totalPrice,
          effectiveEndAt: booking.effectiveEndAt,
        })
        if (!updated) {
          return { ok: false, status: 404, error: 'Booking not found' }
        }

        await repos.bookingEventRepo.append(ctx, {
          bookingId: booking.id,
          type: 'VEHICLE_SUBSTITUTED',
          actorId: ctx.userId,
          payload: {
            fromVehicleId: booking.assignedVehicleId,
            toVehicleId: replacement.id,
            reason,
          },
        })
        return { ok: true, booking: updated }
      })
    } catch (err) {
      if (pgErrorCode(err) === PG_ERROR.EXCLUSION_VIOLATION) {
        return {
          ok: false,
          status: 409,
          error: 'Replacement vehicle is already booked for this time range',
        }
      }
      throw err
    }
  }

  // Substitution requires the same ACRISS class (§5.5, no rank order in MVP).
  // Both classes must resolve to the same NON-NULL code — an unmapped class
  // (null acriss) can never be a substitution target.
  private async sameAcrissClass(bookingClassId: string, newClassId: string): Promise<boolean> {
    if (!this.vehicleClassRepo) {
      throw new Error('BookingService missing vehicleClassRepo; check DI wiring')
    }
    const [bookingClass, newClass] = await Promise.all([
      this.vehicleClassRepo.findById(SYSTEM_CONTEXT, bookingClassId),
      this.vehicleClassRepo.findById(SYSTEM_CONTEXT, newClassId),
    ])
    return !!bookingClass?.acrissCode && bookingClass.acrissCode === newClass?.acrissCode
  }

  /**
   * #616: the eligible replacement vehicles for the operator's substitute action —
   * SAME store + SAME ACRISS class + AVAILABLE, minus the currently-assigned car.
   * The eligibility rule mirrors substitute() so the picker never offers a vehicle
   * the write would reject; it lives here (not the client) because the rule keys
   * off the class ACRISS code, which the vehicle list response does not carry. The
   * booking read is caller-scoped, so a cross-tenant id resolves to 404.
   */
  async substitutionCandidates(
    ctx: CallerContext,
    bookingId: string,
  ): Promise<SubstitutionCandidatesResult> {
    if (!this.vehicleRepo || !this.vehicleClassRepo) {
      throw new Error('BookingService missing vehicle repos; check DI wiring')
    }
    const booking = await this.bookingRepo.findById(ctx, bookingId)
    if (!booking) {
      return { ok: false, status: 404, error: 'Booking not found' }
    }

    // An unmapped (null-ACRISS) booking class has no substitute target, matching
    // sameAcrissClass()'s non-null requirement.
    const bookingClass = await this.vehicleClassRepo.findById(SYSTEM_CONTEXT, booking.classId)
    const acrissCode = bookingClass?.acrissCode
    if (!acrissCode) {
      return { ok: true, candidates: [] }
    }

    // The operator's own classes sharing that ACRISS code — multiple classIds may
    // map to one code (schema allows a non-unique acrissCode), so collect the set.
    const classes = await this.vehicleClassRepo.findAll(ctx)
    const sameAcrissClassIds = new Set(
      classes.filter((cls) => cls.acrissCode === acrissCode).map((cls) => cls.id),
    )

    const { data } = await this.vehicleRepo.findAll(ctx, {
      status: 'AVAILABLE',
      limit: SUBSTITUTION_CANDIDATE_LIMIT,
    })
    const candidates = data
      .filter(
        (v) =>
          v.id !== booking.assignedVehicleId &&
          (v.pickupLocationId ?? null) === booking.pickupLocationId &&
          !!v.classId &&
          sameAcrissClassIds.has(v.classId),
      )
      .map((v) => ({ id: v.id, name: v.name }))
    return { ok: true, candidates }
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

    // Projection update + STATUS_CHANGED append in one tx so booking_events stays
    // the source of truth (§3.1) and never drifts from the status column.
    const updated = await this.runInTransaction(async (repos) => {
      const next = await repos.bookingRepo.updateStatus(ctx, booking.id, {
        from: booking.status,
        to: newStatus as Booking['status'],
      })
      if (!next) return undefined
      await repos.bookingEventRepo.append(ctx, {
        bookingId: booking.id,
        type: 'STATUS_CHANGED',
        actorId: ctx.userId,
        payload: { from: booking.status, to: newStatus as Booking['status'] },
      })
      return next
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

    // Projection cancel + BOOKING_CANCELLED append in one tx so the event log
    // records every lifecycle transition, not just create/substitute (§3.1).
    const updated = await this.runInTransaction(async (repos) => {
      const next = await repos.bookingRepo.cancel(ctx, booking.id, {
        from: booking.status,
        fee: cancellation.feeAmount,
        cancelledAt: now,
      })
      if (!next) return undefined
      await repos.bookingEventRepo.append(ctx, {
        bookingId: booking.id,
        type: 'BOOKING_CANCELLED',
        actorId: ctx.userId,
        payload: { cancellationFee: cancellation.feeAmount, cancelledAt: now.toISOString() },
      })
      return next
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

// Insurance is priced per rental day (ceil), min 1 — matches the daily-rate
// rounding the base price uses for whole-day rentals.
function rentalDays(startAt: Date, endAt: Date): number {
  return Math.max(1, Math.ceil((endAt.getTime() - startAt.getTime()) / MS_PER_DAY))
}
