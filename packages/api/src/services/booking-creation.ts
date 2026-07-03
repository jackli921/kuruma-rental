import type { AddOnSnapshot, InsuranceSnapshot } from '@kuruma/shared/db/schema'
import { isRoadLegal, jstDateString } from '@kuruma/shared/lib/compliance'
import { calculateBookingPrice } from '@kuruma/shared/lib/pricing'
import { checkRentalRules } from '@kuruma/shared/lib/rental-rules'
import { generateBookingCode } from '../lib/booking-code'
import { type CallerContext, SYSTEM_CONTEXT } from '../middleware/auth'
import { BOOKING_CODE_CONSTRAINT, PG_ERROR, pgConstraintName, pgErrorCode } from '../pg-errors'
import type { BookingRepository, RunInTransaction, TransactionRepos } from '../repositories/types'
import type { Location, Vehicle } from '../stores'
import {
  assertBookingInventoryWithinOperator,
  bookingInventoryDenialResult,
  bookingReadScope,
} from '../tenancy'
import { resolveBookingActor } from './booking-actor'
import { rejectIfOperatorDeactivated } from './booking-creation-operator-guard'
import type { BookingPostCommitDispatcher } from './booking-post-commit-dispatcher'
import { MS_PER_MINUTE, composeBookingTotal, rentalDays } from './booking-pricing-helpers'
import type {
  BookingVerificationGate,
  CreateBookingInput,
  CreateBookingRequest,
  CreateBookingResult,
} from './booking-types'

// Location-only turnaround fallback when the dropoff location has no value set
// (§5.3, proposal §9 item 20). The legacy 60-min vehicle buffer is GONE — a
// 60-min result is a regression the turnaround test pins against.
const DEFAULT_TURNAROUND_MINUTES = 2880 // 48h
// A booking_code collision is ~2^-40 per attempt; a few retries is plenty.
const MAX_BOOKING_CODE_ATTEMPTS = 3
// #613: version of the liability-disclaimer (免责声明) wording a renter agreed to,
// stamped onto the booking. Bump when the localized terms text changes materially
// (the renter-facing copy lives in web i18n; this is the server-authoritative tag).
export const DISCLAIMER_TERMS_VERSION = '2026-06-13'

/**
 * Creation side of the booking domain (#713 split of the BookingService
 * god-class). Owns `create` (idempotency + verification gate + bounded
 * collision-retry) and the private `submitInTx` decision-and-record. All repos
 * are injected; the composition root shares the same instances across the
 * query/creation/lifecycle services.
 */
export class BookingCreationService {
  constructor(
    private readonly bookingRepo: BookingRepository,
    private readonly runInTransaction: RunInTransaction,
    // Single post-commit seam (#393, TODO #300): ensureThread + notifications,
    // each caught-and-logged. Replaces the inline ensureThread calls.
    // Optional is a TEST-ONLY seam: prod always wires it (createApp/index.ts);
    // omitting it silently disables ALL post-commit effects (threads + emails).
    private readonly postCommit?: BookingPostCommitDispatcher,
    // Injectable so the collision-retry path is deterministically testable.
    private readonly generateCode: () => string = generateBookingCode,
    // #459: optional document-verification gate, wired only when the
    // REQUIRE_DOCUMENT_VERIFICATION flag is on (see index.ts composition root).
    private readonly verificationGate?: BookingVerificationGate,
  ) {}

  async create(
    ctx: CallerContext,
    rawInput: CreateBookingRequest,
    now: Date = new Date(),
    // #1260: the operator a bypass admin acts as (?operatorId=), binding both the
    // customer scope (below) and the inventory (submitInTx). Operators ignore it.
    actingOperatorId?: string,
  ): Promise<CreateBookingResult> {
    // #1108 (audit M4): resolve the actor (renter / source / walk-in) from the
    // caller's role HERE — the route forwards raw input and no longer rewrites it.
    // The normalized command carries the resolved trio; every read past this
    // point (renter scope authz, verification gate, submitInTx) sees it. A renter
    // who supplied a walkInCustomer has it dropped (only manual bookers may
    // register one), so strip it before re-attaching the resolved value.
    const actor = resolveBookingActor(ctx, rawInput)
    const { walkInCustomer: _rawWalkIn, ...rawRest } = rawInput
    const input: CreateBookingInput = actor.walkInCustomer
      ? {
          ...rawRest,
          renterId: actor.renterId,
          source: actor.source,
          walkInCustomer: actor.walkInCustomer,
        }
      : { ...rawRest, renterId: actor.renterId, source: actor.source }

    // Resolve the booking's renter (#314, #589):
    //  - WALK-IN (1c): a fresh customer minted INSIDE the tx (#875) — the walk-in
    //    IS the authorization, so it skips the customer scope check (its inventory
    //    is still bound in submitInTx). renterId stays null; submitInTx mints it,
    //    so a failed booking rolls it back and an idempotent replay never mints one.
    //  - EXISTING renter (1b): scope-first membership (assertRenterWithinScope).
    //  - SELF: renterId === ctx.userId (renter self-serve).
    let renterId: string | null = null
    if (!input.walkInCustomer) {
      renterId = input.renterId
      if (renterId !== ctx.userId) {
        const denial = await this.assertRenterWithinScope(ctx, renterId, actingOperatorId)
        if (denial) return denial
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
    // #589 1c: a walk-in is an operator-initiated manual booking — like other
    // manual bookings it captures verification operationally at pickup, not via the
    // renter document gate (the freshly-created customer has no documents on file).
    if (this.verificationGate && !input.walkInCustomer) {
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
          this.submitInTx(ctx, input, renterId, now, repos, actingOperatorId),
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

  // #1260: bind "book on behalf of an EXISTING renter" to an operator's customer
  // set — membership (a prior booking with it) IS the authorization + existence
  // check, so an out-of-scope id is a uniform 403 with no user-table probe
  // (#396/#475). A tenant operator uses its own tenant (a stray actingOperatorId is
  // ignored); a bypass admin (`all`, PLATFORM_ADMIN via the picker) must name the
  // operator it acts as (422) and may attach only its customers. Keyed on
  // bookingReadScope so only the true bypass tier is `all` (renters/partners never
  // reach here — resolveBookingActor forces their renterId to self); `none` (an
  // operator missing its operatorId) falls through to the empty-set 403 (fail closed).
  private async assertRenterWithinScope(
    ctx: CallerContext,
    renterId: string,
    actingOperatorId: string | undefined,
  ): Promise<Extract<CreateBookingResult, { ok: false }> | null> {
    const scope = bookingReadScope(ctx)
    const customerOperatorId =
      scope.kind === 'operator'
        ? scope.operatorId
        : scope.kind === 'all'
          ? actingOperatorId
          : undefined
    if (scope.kind === 'all' && !customerOperatorId) {
      return {
        ok: false,
        status: 422,
        error: 'operatorId is required: specify the operator to act as',
        code: 'OPERATOR_REQUIRED',
      }
    }
    const customers = customerOperatorId
      ? await this.bookingRepo.listRenterIdsForOperator(customerOperatorId)
      : []
    if (!customers.includes(renterId)) {
      return { ok: false, status: 403, error: 'Cannot book for a renter outside your customers' }
    }
    return null
  }

  // Single seam for `effectiveEndAt`: both submit paths derive it from the DROPOFF
  // turnaround and MUST equal the DB trigger compute_effective_end_at() (migration
  // 0069, maint review 2026-06-24 #11) — else API response and persisted row drift
  // until reload. The trigger-vs-helper parity test pins it.
  private async resolveDropoffEffectiveEnd(
    repos: TransactionRepos,
    operatorId: string,
    pickup: Location,
    dropoffLocationId: string,
    endAt: Date,
  ): Promise<
    | { ok: true; dropoff: Location; effectiveEndAt: Date }
    | { ok: false; status: 400; error: string }
  > {
    const dropoff =
      dropoffLocationId === pickup.id
        ? pickup
        : await repos.locationRepo.findById(SYSTEM_CONTEXT, dropoffLocationId)
    if (!dropoff || dropoff.operatorId !== operatorId) {
      return { ok: false, status: 400, error: 'Dropoff location is not available' }
    }
    const turnaroundMinutes = dropoff.defaultTurnaroundMinutes ?? DEFAULT_TURNAROUND_MINUTES
    const effectiveEndAt = new Date(endAt.getTime() + turnaroundMinutes * MS_PER_MINUTE)
    return { ok: true, dropoff, effectiveEndAt }
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
    // Non-walk-in: the existing renter / self, resolved + authorized in `create`.
    // Walk-in (#875): null — the fresh renter is minted below, inside this tx, just
    // before the booking insert (after every validation `return`, which would commit).
    renterId: string | null,
    now: Date,
    repos: TransactionRepos,
    // #1260: the operator a bypass admin is acting as; the booking's inventory is
    // bound to it below. Undefined for tenant operators (already tenant-clamped).
    actingOperatorId: string | undefined,
  ): Promise<CreateBookingResult> {
    if (input.fulfillmentMode === 'CLASS_COMBO') {
      return this.submitComboInTx(ctx, input, renterId, now, repos, actingOperatorId)
    }
    const vehicle = await repos.vehicleRepo.findById(SYSTEM_CONTEXT, input.requestedVehicleId)
    if (!vehicle) {
      return { ok: false, status: 400, error: 'Vehicle not found' }
    }
    const operatorId = vehicle.operatorId
    // #1260/#1417: bind BEFORE the vehicle-state gates below. The read is SYSTEM_CONTEXT
    // (unscoped), so a foreign car is reachable by raw id; binding first refuses a cross-
    // tenant caller uniformly and stops it probing B's status/class/shaken-expiry via the
    // 400s that follow. Bypass `all` names its operator (404 no-oracle); a tenant operator
    // is own-fleet only (foreign -> 403); renters pass through (marketplace).
    const inventoryDenial = assertBookingInventoryWithinOperator(ctx, operatorId, actingOperatorId)
    if (inventoryDenial) return bookingInventoryDenialResult(inventoryDenial, 'Vehicle not found')
    if (vehicle.status !== 'AVAILABLE') {
      return { ok: false, status: 400, error: 'Vehicle is not available' }
    }
    if (!vehicle.classId) {
      return { ok: false, status: 400, error: 'Vehicle has no class' }
    }
    // §5.3 (#916): block a reservation whose rental runs past the car's shaken
    // or insurance expiry — covers the future-booking legal case the today-only
    // availability gate misses. Same JST clock as every other gate: a return ON
    // the expiry date is allowed (isRoadLegal uses `expiry >= asOf`); AFTER it is
    // rejected. Applies to all create paths (renter, operator manual, walk-in).
    if (!isRoadLegal(vehicle, jstDateString(input.endAt))) {
      return {
        ok: false,
        status: 400,
        error: "Vehicle's shaken or insurance expires before the booking ends",
        code: 'VEHICLE_DOCS_EXPIRE_BEFORE_RETURN',
      }
    }
    const operatorBlock = await rejectIfOperatorDeactivated(repos, operatorId)
    if (operatorBlock) return operatorBlock
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

    // The car lives at its own storefront, so pickup must match it — else a forged
    // body could pair it with another of the operator's locations (same-tenant check
    // still passes) and lie about where the car physically is (#392).
    if (vehicle.pickupLocationId !== input.pickupLocationId) {
      return { ok: false, status: 400, error: 'Pickup location does not match the vehicle' }
    }

    const pickup = await repos.locationRepo.findById(SYSTEM_CONTEXT, input.pickupLocationId)
    if (!pickup || pickup.operatorId !== operatorId) {
      return { ok: false, status: 400, error: 'Pickup location is not available' }
    }
    const eff = await this.resolveDropoffEffectiveEnd(
      repos,
      operatorId,
      pickup,
      input.dropoffLocationId,
      input.endAt,
    )
    if (!eff.ok) return eff
    const { effectiveEndAt } = eff

    // #464: a SPECIFIC booking also consumes a class unit. A CLASS_COMBO float
    // (null assignedVehicleId) is invisible to the per-vehicle exclusion
    // constraint (booking.ts), so without this gate a SPECIFIC create could grab
    // the last car a float already reserved. Same advisory lock + demand/capacity
    // gate as the combo path; the exclusion constraint stays the per-car backstop.
    const releaseLock = await repos.availabilityRepo.lockComboCapacity(
      operatorId,
      classId,
      input.pickupLocationId,
    )
    try {
      return await this.submitSpecificInTxLocked(
        ctx,
        input,
        renterId,
        now,
        repos,
        vehicle,
        operatorId,
        classId,
        assignedVehicleId,
        effectiveEndAt,
      )
    } finally {
      releaseLock()
    }
  }

  private async submitSpecificInTxLocked(
    ctx: CallerContext,
    input: CreateBookingInput & { fulfillmentMode: 'SPECIFIC' },
    renterId: string | null,
    now: Date,
    repos: TransactionRepos,
    vehicle: Vehicle,
    operatorId: string,
    classId: string,
    assignedVehicleId: string,
    effectiveEndAt: Date,
  ): Promise<CreateBookingResult> {
    // #1101: reject a booking that lands on a scheduled block (maintenance /
    // out-of-service / manual hold) on the assigned car. Compared against
    // [startAt, effectiveEndAt) — the SAME turnaround-inclusive window as the
    // booking exclusion — so a block can't be slipped into a car's dropoff tail
    // (must-fix #1). Booking-vs-block is a service-level NOT EXISTS because a
    // single GiST EXCLUDE can't span bookings + vehicle_blocks; the residual
    // schedule-during-checkout race is tiny + operator-recoverable at this scale
    // (documented PR follow-up). CLASS_COMBO has no car at book time, so this
    // guard is SPECIFIC-only at book time; the operator assign/substitute path
    // runs the same block check (#1152).
    const overlappingBlocks = await repos.vehicleBlockRepo.findOverlapping(
      assignedVehicleId,
      input.startAt,
      effectiveEndAt,
    )
    if (overlappingBlocks.length > 0) {
      return {
        ok: false,
        status: 409,
        error: 'Vehicle is blocked (maintenance or hold) for the requested time range',
        code: 'VEHICLE_BLOCKED',
      }
    }

    // Demand counts SPECIFIC occupancy + floats on the (op, class, loc) triple;
    // capacity is the road-legal supply at the requested return. demand >= capacity
    // means every unit is already claimed → reject before insert. (The exclusion
    // constraint below still rejects a double-booked specific car while capacity
    // remains — e.g. a multi-car class where only this car is taken.)
    const demand = await repos.availabilityRepo.countClassDemand(
      operatorId,
      classId,
      input.pickupLocationId,
      input.startAt,
      effectiveEndAt,
    )
    const capacity = await repos.availabilityRepo.countClassCapacity(
      operatorId,
      classId,
      input.pickupLocationId,
      input.startAt,
      effectiveEndAt,
      input.endAt,
    )
    if (demand >= capacity) {
      return {
        ok: false,
        status: 409,
        error: 'No cars left in this class at this location for the requested window',
        code: 'CLASS_COMBO_SOLD_OUT',
      }
    }

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
    // #1109 (audit M1): the snapshot+insert tail is shared with CLASS_COMBO.
    // Pricing (above) is mode-specific (per-car rate vs class rate plan); the
    // rest — insurance/fee/add-on snapshot, total composition, renter mint,
    // booking insert, BOOKING_CREATED event — is identical and lives in one
    // seam. The booking.test.ts SPECIFIC vs CLASS_COMBO parity test pins it.
    return this.snapshotAndInsert(ctx, repos, {
      input,
      operatorId,
      classId,
      basePriceJpy: pricing.totalPriceJpy,
      fulfillmentMode: 'SPECIFIC',
      assignedVehicleId,
      requestedVehicleId: input.requestedVehicleId,
      effectiveEndAt,
      renterId,
      now,
    })
  }

  // #464 2d.3: CLASS_COMBO submit — the renter books a class at a pickup
  // location, no car selected at book time. The operator assigns a concrete
  // vehicle on/before pickup (substitute path). Priced off the active class
  // rate plan, NOT per-car (proposal §5.1). Demand/capacity are checked in-tx
  // so a concurrent SPECIFIC submit on the same (op, class, loc) can't slip a
  // car under the gate; slice 2d.4 adds the advisory lock that fully
  // serializes the demand → capacity → insert window.
  private async submitComboInTx(
    ctx: CallerContext,
    input: CreateBookingInput & { fulfillmentMode: 'CLASS_COMBO' },
    renterId: string | null,
    now: Date,
    repos: TransactionRepos,
    // #1260: the operator a bypass admin is acting as (bind the combo's inventory).
    actingOperatorId: string | undefined,
  ): Promise<CreateBookingResult> {
    // The pickup location anchors the booking's operator + the (op, class, loc)
    // triple every other read keys off (a forged classId from another tenant
    // gets rejected at the class-belongs-to-operator gate below).
    const pickup = await repos.locationRepo.findById(SYSTEM_CONTEXT, input.pickupLocationId)
    if (!pickup) {
      return { ok: false, status: 400, error: 'Pickup location is not available' }
    }
    const operatorId = pickup.operatorId
    // #1260/#1417: bind the combo's pickup/inventory operator (mirrors the SPECIFIC
    // path) — bypass `all` names its operator (404 no-oracle), a tenant operator is
    // own-fleet only (foreign pickup -> 403), renters pass through (marketplace).
    const inventoryDenial = assertBookingInventoryWithinOperator(ctx, operatorId, actingOperatorId)
    if (inventoryDenial)
      return bookingInventoryDenialResult(inventoryDenial, 'Pickup location is not available')
    const operatorBlock = await rejectIfOperatorDeactivated(repos, operatorId)
    if (operatorBlock) return operatorBlock
    const classId = input.classId

    const klass = await repos.vehicleClassRepo.findById(SYSTEM_CONTEXT, classId)
    if (!klass || klass.operatorId !== operatorId) {
      return { ok: false, status: 400, error: 'Vehicle class is not available' }
    }

    // #464: a combo has no per-vehicle rules (no car at book time), but the
    // universal past-start floor (#954) still applies. checkRentalRules with all
    // class rules null fires only RENTAL_RULE_START_IN_PAST — ignoring min/max/
    // advance — so a start already gone is rejected on this path too.
    const ruleCheck = checkRentalRules(
      { minRentalHours: null, maxRentalHours: null, advanceBookingHours: null },
      input.startAt,
      input.endAt,
      now,
    )
    if (!ruleCheck.ok) {
      return {
        ok: false,
        status: 400,
        error: 'Booking violates a rental rule',
        code: ruleCheck.code,
        details: { required: ruleCheck.required, actual: ruleCheck.actual },
      }
    }

    const eff = await this.resolveDropoffEffectiveEnd(
      repos,
      operatorId,
      pickup,
      input.dropoffLocationId,
      input.endAt,
    )
    if (!eff.ok) return eff
    const { effectiveEndAt } = eff

    // #464 2d.4: serialize concurrent CLASS_COMBO submits on this triple.
    // Drizzle's pg_advisory_xact_lock auto-releases at tx end (the returned
    // release is a no-op); InMemory's promise-chain release fires in the
    // finally so the next waiter advances. Held around demand → capacity →
    // insert so a parallel submit can't read demand BEFORE our insert lands.
    const releaseLock = await repos.availabilityRepo.lockComboCapacity(
      operatorId,
      classId,
      input.pickupLocationId,
    )
    try {
      return await this.submitComboInTxLocked(
        ctx,
        input,
        renterId,
        now,
        repos,
        operatorId,
        classId,
        effectiveEndAt,
      )
    } finally {
      releaseLock()
    }
  }

  private async submitComboInTxLocked(
    ctx: CallerContext,
    input: CreateBookingInput & { fulfillmentMode: 'CLASS_COMBO' },
    renterId: string | null,
    now: Date,
    repos: TransactionRepos,
    operatorId: string,
    classId: string,
    effectiveEndAt: Date,
  ): Promise<CreateBookingResult> {
    // Demand counts BOTH consumers of the class fleet (SPECIFIC bookings on
    // any car in the triple PLUS floating combos) — countClassDemand keys on
    // (operator, class, location), not on assignedVehicleId. Capacity is the
    // road-legal supply at the requested return.
    const demand = await repos.availabilityRepo.countClassDemand(
      operatorId,
      classId,
      input.pickupLocationId,
      input.startAt,
      effectiveEndAt,
    )
    const capacity = await repos.availabilityRepo.countClassCapacity(
      operatorId,
      classId,
      input.pickupLocationId,
      input.startAt,
      effectiveEndAt,
      input.endAt,
    )
    if (demand >= capacity) {
      return {
        ok: false,
        status: 409,
        error: 'No cars left in this class at this location for the requested window',
        code: 'CLASS_COMBO_SOLD_OUT',
      }
    }

    // Priced off the operator's active rate plan for this (class, location).
    // No plan / inactive plan ⇒ the operator hasn't published a combo deal yet.
    const ratePlan = await repos.classRatePlanRepo.findActiveRate(
      operatorId,
      classId,
      input.pickupLocationId,
    )
    if (!ratePlan) {
      return {
        ok: false,
        status: 400,
        error: 'No active class rate plan for this combo',
        code: 'NO_COMBO_RATE_SET',
      }
    }
    const basePrice = ratePlan.dayRateJpy * rentalDays(input.startAt, input.endAt)

    // CLASS_COMBO floats: neither vehicle id is set at book time. The operator
    // stamps assignedVehicleId on/before pickup via the substitute path
    // (#464 slice 3). The rest of the snapshot+insert is shared with SPECIFIC.
    return this.snapshotAndInsert(ctx, repos, {
      input,
      operatorId,
      classId,
      basePriceJpy: basePrice,
      fulfillmentMode: 'CLASS_COMBO',
      assignedVehicleId: null,
      requestedVehicleId: null,
      effectiveEndAt,
      renterId,
      now,
    })
  }

  // #1109 (audit M1): the snapshot+insert tail shared by SPECIFIC and
  // CLASS_COMBO. Both modes resolve insurance / fees / add-ons against the same
  // operator-scoped reads, compose the same total, mint the walk-in renter
  // (#875) past the last validation `return`, then INSERT-then-EVENT-append in
  // tx order so a constraint failure rolls back atomically (no orphan event).
  // The mode-specific bits — basePriceJpy and the three discriminator fields
  // (fulfillmentMode, assignedVehicleId, requestedVehicleId) — are passed in.
  // Parity is pinned by booking.test.ts (SPECIFIC vs CLASS_COMBO snapshot equality).
  private async snapshotAndInsert(
    ctx: CallerContext,
    repos: TransactionRepos,
    args: {
      input: CreateBookingInput
      operatorId: string
      classId: string
      basePriceJpy: number
      fulfillmentMode: 'SPECIFIC' | 'CLASS_COMBO'
      assignedVehicleId: string | null
      requestedVehicleId: string | null
      effectiveEndAt: Date
      // Non-walk-in: the existing renter / self resolved in `create`. Walk-in
      // (#875): null — the fresh renter is minted below, inside this tx, past
      // every validation `return`.
      renterId: string | null
      now: Date
    },
  ): Promise<CreateBookingResult> {
    const {
      input,
      operatorId,
      classId,
      basePriceJpy,
      fulfillmentMode,
      assignedVehicleId,
      requestedVehicleId,
      effectiveEndAt,
      renterId,
      now,
    } = args

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

    // Selected paid add-ons (#460): each flat priceJpy is snapshotted here and
    // folded into the total below via composeBookingTotal. One ACTIVE-only,
    // this-operator read validates membership + tenant + active in a single
    // query (a foreign/archived id is simply absent -> 400). De-dup so a
    // repeated id is charged once (quantity is out of MVP).
    const addOnSnapshot: AddOnSnapshot[] = []
    if (input.addOnIds.length > 0) {
      const available = await repos.addOnRepo.findActiveByOperator(operatorId)
      const availableById = new Map(available.map((a) => [a.id, a]))
      for (const addOnId of new Set(input.addOnIds)) {
        const addOn = availableById.get(addOnId)
        if (!addOn) return { ok: false, status: 400, error: 'Add-on is not available' }
        addOnSnapshot.push({ addOnId: addOn.id, name: addOn.name, priceJpy: addOn.priceJpy })
      }
    }

    // One composition for create AND substitute() — never hand-summed twice (#862).
    const totalPrice = composeBookingTotal({
      baseJpy: basePriceJpy,
      insurancePerDayJpy: insuranceSnapshot?.dailyPriceJpy ?? 0,
      days: rentalDays(input.startAt, input.endAt),
      addOns: addOnSnapshot,
    })

    const bookingCode = this.generateCode()

    // #875: mint the walk-in renter HERE — past every validation `return` above
    // (a return COMMITS the tx, so an earlier insert would orphan on a 400),
    // and right before the booking insert whose 409 / booking_code-collision
    // THROW rolls this back with it. Atomic: a failed attempt leaves no orphan
    // customer.
    const bookingRenterId = input.walkInCustomer
      ? (await repos.userRepo.createWalkInRenter(input.walkInCustomer)).id
      : renterId
    if (bookingRenterId === null) {
      // Invariant: a non-walk-in booking always resolves renterId in `create`.
      throw new Error('booking submit: renterId unresolved (non-walk-in)')
    }

    // Insert FIRST: the exclusion / unique constraints fire here, BEFORE the
    // event append, so a rolled-back insert leaves no orphan event (atomicity).
    const booking = await repos.bookingRepo.create(ctx, {
      operatorId,
      renterId: bookingRenterId,
      classId,
      requestedVehicleId,
      assignedVehicleId,
      pickupLocationId: input.pickupLocationId,
      dropoffLocationId: input.dropoffLocationId,
      startAt: input.startAt,
      endAt: input.endAt,
      effectiveEndAt,
      status: 'CONFIRMED',
      source: input.source,
      // #463: server-derived discriminator (SPECIFIC at MVP, CLASS_COMBO #464).
      fulfillmentMode,
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
        type: 'BOOKING_CREATED',
        requestedVehicleId,
        assignedVehicleId,
        classId,
        fulfillmentMode, // #463: mirror the booking's discriminator in the audit snapshot
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
}
