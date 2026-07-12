import { isRoadLegal, jstDateString } from '@kuruma/shared/lib/compliance'
import { calculateBookingPrice } from '@kuruma/shared/lib/pricing'
import { checkRentalRules } from '@kuruma/shared/lib/rental-rules'
import { generateBookingCode } from '../lib/booking-code'
import { type CallerContext, SYSTEM_CONTEXT } from '../middleware/auth'
import { BOOKING_CODE_CONSTRAINT, PG_ERROR, pgConstraintName, pgErrorCode } from '../pg-errors'
import type { BookingRepository, RunInTransaction, TransactionRepos } from '../repositories/types'
import type { Location, Vehicle } from '../stores'
import {
  assertBookingWriteWithinOperator,
  bookingReadScope,
  fleetWriteDenialResult,
} from '../tenancy'
import { resolveBookingActor } from './booking-actor'
import { rejectIfOperatorDeactivated } from './booking-creation-operator-guard'
import type { BookingPostCommitDispatcher } from './booking-post-commit-dispatcher'
import { MS_PER_MINUTE, rentalDays } from './booking-pricing-helpers'
import { type OperatorTermsTxContext, snapshotAndInsert } from './booking-snapshot-insert'
import type {
  BookingVerificationGate,
  CreateBookingInput,
  CreateBookingRequest,
  CreateBookingResult,
} from './booking-types'
import { type SigningKey, resolveSigningKey } from './consent-signing'

// Location-only turnaround fallback when the dropoff location has no value set
// (§5.3, proposal §9 item 20). The legacy 60-min vehicle buffer is GONE — a
// 60-min result is a regression the turnaround test pins against.
const DEFAULT_TURNAROUND_MINUTES = 2880 // 48h
// A booking_code collision is ~2^-40 per attempt; a few retries is plenty.
const MAX_BOOKING_CODE_ATTEMPTS = 3

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
    // #877 Slice B: the consent signing key + the OPERATOR_TERMS flag thunk. Both
    // default to the "off" behavior so the ~30 in-memory test wirings that omit them
    // (and the flag-off prod default) never touch the consent path: an unresolved
    // enabled thunk floors active=false, so consentRepo is never reached.
    private readonly getSigningKey: () => SigningKey | undefined = resolveSigningKey,
    private readonly isOperatorTermsEnabled: () => Promise<boolean> = async () => false,
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
    // #877 Slice B: decide OUTSIDE the tx whether this create must seal an
    // operator-terms acceptance, and resolve the signing KEY here — never couple
    // booking availability to the consent secret (H3). A missing key throws in
    // production (fail-fast at the route 500), not mid-transaction. The doc-resolve
    // + version-pin check + HMAC sign happen INSIDE submitInTx, after the booking
    // insert whose id the signature binds. Gate on ctx.role === 'RENTER' (self-serve
    // only) so operator/manual/walk-in/PARTNER creates skip it entirely.
    const operatorTerms: OperatorTermsTxContext = {
      active: ctx.role === 'RENTER' && (await this.isOperatorTermsEnabled()),
      signingKey: undefined,
    }
    if (operatorTerms.active) operatorTerms.signingKey = this.getSigningKey()

    let lastErr: unknown
    for (let attempt = 0; attempt < MAX_BOOKING_CODE_ATTEMPTS; attempt++) {
      try {
        const result = await this.runInTransaction((repos) =>
          this.submitInTx(ctx, input, renterId, now, repos, actingOperatorId, operatorTerms),
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

  // The atomic decision-and-record (FC/IS: the decision; ensureThread is the imperative
  // shell). The ANCHOR read (vehicle/pickup) is ctx-scoped (#1417) — it derives the tenant
  // AND clamps operators; downstream pricing/snapshot/insurance/fee reads stay SYSTEM_CONTEXT,
  // cross-checked against that operatorId (insurance/fee also reject RENTER callers). WRITES
  // use the caller's ctx (scope enforced at the repo).
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
    // #877 Slice B: whether + how to seal the operator-terms acceptance (see create).
    operatorTerms: OperatorTermsTxContext,
  ): Promise<CreateBookingResult> {
    if (input.fulfillmentMode === 'CLASS_COMBO') {
      return this.submitComboInTx(ctx, input, renterId, now, repos, actingOperatorId, operatorTerms)
    }
    // #1417: read the ANCHOR vehicle with the caller's own ctx, so operatorReadScope clamps
    // a tenant operator to its own fleet — a foreign car returns undefined -> the plain
    // 'Vehicle not found' below (no oracle). Marketplace tiers still resolve `all`, unchanged.
    const vehicle = await repos.vehicleRepo.findById(ctx, input.requestedVehicleId)
    if (!vehicle) {
      return { ok: false, status: 400, error: 'Vehicle not found' }
    }
    const operatorId = vehicle.operatorId
    // #1260: only the bypass `all` tier reads cross-operator inventory above, so bind just its
    // pick-an-operator claim, BEFORE the vehicle-state gates (a mismatched admin pick must not
    // probe them). Operators/renters/partners already pass — clamped or marketplace.
    const denial = assertBookingWriteWithinOperator(ctx, operatorId, actingOperatorId)
    if (denial) return fleetWriteDenialResult(denial, 'Vehicle not found')
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
        operatorTerms,
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
    operatorTerms: OperatorTermsTxContext,
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
    return snapshotAndInsert(ctx, repos, {
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
      operatorTerms,
      generateCode: this.generateCode,
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
    // #877 Slice B: whether + how to seal the operator-terms acceptance (see create).
    operatorTerms: OperatorTermsTxContext,
  ): Promise<CreateBookingResult> {
    // The pickup location anchors the booking's operator + the (op, class, loc)
    // triple every other read keys off (a forged classId from another tenant
    // gets rejected at the class-belongs-to-operator gate below).
    // #1417: read the ANCHOR pickup with the caller's own ctx (mirrors SPECIFIC's vehicle
    // read) — a tenant operator's foreign pickup returns undefined -> the plain 'not
    // available' below (no oracle). Marketplace tiers still resolve `all`, unchanged.
    const pickup = await repos.locationRepo.findById(ctx, input.pickupLocationId)
    if (!pickup) {
      return { ok: false, status: 400, error: 'Pickup location is not available' }
    }
    const operatorId = pickup.operatorId
    // #1260: bind only the bypass `all` tier's pick-an-operator claim (mirrors SPECIFIC).
    const denial = assertBookingWriteWithinOperator(ctx, operatorId, actingOperatorId)
    if (denial) return fleetWriteDenialResult(denial, 'Pickup location is not available')
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
        operatorTerms,
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
    operatorTerms: OperatorTermsTxContext,
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
    return snapshotAndInsert(ctx, repos, {
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
      operatorTerms,
      generateCode: this.generateCode,
    })
  }
}
