import {
  type BookingStatus,
  type CancellationReason,
  VALID_BOOKING_TRANSITIONS,
} from '@kuruma/shared/db/schema'
import { calculateCancellationFee } from '@kuruma/shared/lib/cancellation-policy'
import { isRoadLegal, jstDateString } from '@kuruma/shared/lib/compliance'
import { calculateBookingPrice } from '@kuruma/shared/lib/pricing'
import { type CallerContext, SYSTEM_CONTEXT } from '../middleware/auth'
import { PG_ERROR, pgErrorCode } from '../pg-errors'
import type {
  BookingRepository,
  RunInTransaction,
  VehicleClassRepository,
  VehicleRepository,
} from '../repositories/types'
import type { Booking, Vehicle } from '../stores'
import type { BookingPostCommitDispatcher } from './booking-post-commit-dispatcher'
import { composeBookingTotal, rentalDays } from './booking-pricing-helpers'
import type { CancelResult, StatusTransitionResult, SubstituteResult } from './booking-types'
import type { LifecycleTrigger } from './notification-dispatcher'

/**
 * The payment-side capabilities the cancel paths need (#851), owned by the consumer
 * (DIP) so the lifecycle service never imports PaymentService. The composition root
 * passes the PaymentService, which structurally satisfies this.
 */
export interface CancellationRefundCoordinator {
  /** Does the booking have a captured (SUCCEEDED) payment? Decides whether a cancel
   *  owes a refund (REFUND_DUE) or there is nothing to move (ADVISORY). */
  isBookingPaid(bookingId: string): Promise<boolean>
  /** Eager, best-effort refund drive after the cancel tx commits REFUND_DUE. A throw
   *  is the caller's to swallow — the reconciler backstop re-drives from the row. */
  initiateCancellationRefund(booking: Booking, intendedAmountJpy: number): Promise<void>
}

// #616 §A: an operator fleet is ~40-50 vehicles; the AVAILABLE same-store subset
// is far smaller. Scan generously so the substitute picker never silently drops a
// candidate, while still bounding the read.
const SUBSTITUTION_CANDIDATE_SCAN_LIMIT = 200
// #664: the renter lifecycle email a status transition triggers. Only renter-
// visible advances notify; any unlisted transition dispatches nothing.
const STATUS_TRIGGER: Partial<Record<BookingStatus, LifecycleTrigger>> = {
  ACTIVE: 'ACTIVATED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
}

// #851 money policy: an UNPAID cancel has nothing to move (ADVISORY); a PAID cancel
// owes the tiered refund when any is due (REFUND_DUE) or keeps the whole capture on
// the FULL tier where nothing is refundable (CAPTURED).
function renterCancelSettlement(
  isPaid: boolean,
  refundAmount: number,
): Booking['cancellationFeeSettlement'] {
  if (!isPaid) return 'ADVISORY'
  return refundAmount > 0 ? 'REFUND_DUE' : 'CAPTURED'
}

/**
 * Lifecycle side of the booking domain (#713 split of the BookingService
 * god-class). Owns status transitions, cancellation, vehicle substitution and
 * its candidate lookup. All repos are injected; the composition root shares the
 * same instances across the query/creation/lifecycle services.
 */
export class BookingLifecycleService {
  constructor(
    private readonly bookingRepo: BookingRepository,
    private readonly runInTransaction: RunInTransaction,
    private readonly vehicleRepo?: VehicleRepository,
    private readonly vehicleClassRepo?: VehicleClassRepository,
    // Single post-commit seam (#393, TODO #300): ensureThread + notifications,
    // each caught-and-logged.
    // Optional is a TEST-ONLY seam: prod always wires it (createApp/index.ts);
    // omitting it silently disables ALL post-commit effects (threads + emails).
    private readonly postCommit?: BookingPostCommitDispatcher,
    // #851: payment-side coordinator for the auto-refund. Optional — when unwired
    // (tests, pre-#851), cancels stay ADVISORY and never touch Stripe.
    private readonly refunds?: CancellationRefundCoordinator,
  ) {}

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
      const result = await this.runInTransaction(async (repos): Promise<SubstituteResult> => {
        const booking = await repos.bookingRepo.findById(ctx, bookingId)
        if (!booking) {
          return { ok: false, status: 404, error: 'Booking not found' }
        }
        if (booking.status !== 'CONFIRMED' && booking.status !== 'ACTIVE') {
          return { ok: false, status: 409, error: `Cannot substitute a ${booking.status} booking` }
        }
        // #464: CLASS_COMBO price is fixed by the rate plan — re-snapshotting off
        // the new vehicle's dailyRate would corrupt it. Operators must use
        // assignVehicle() instead, which leaves totalPrice untouched.
        if (booking.fulfillmentMode === 'CLASS_COMBO') {
          return {
            ok: false,
            status: 409,
            error: 'Use assign, not substitute, for a class-deal booking',
            code: 'USE_ASSIGN_FOR_COMBO' as const,
          }
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
        // §5.3b (#916): the swap path is independent of create, so the road-legal
        // gate must live here too — same JST clock as create (a return ON expiry
        // is allowed). Without it an expired car create/availability would never
        // surface could still be substituted in (policy drift).
        if (!isRoadLegal(replacement, jstDateString(booking.endAt))) {
          return {
            ok: false,
            status: 400,
            error: "Replacement vehicle's shaken or insurance expires before the booking ends",
            // Same code the create path emits (booking-creation.ts) so callers
            // branch on it instead of string-matching the message (#982 parity).
            code: 'VEHICLE_DOCS_EXPIRE_BEFORE_RETURN',
          }
        }
        // #1152: same scheduled-block guard as create/assign — a 23P01 EXCLUDE only
        // covers booking-vs-booking, so reject substituting onto the replacement
        // car's own maintenance/hold window (over [startAt, effectiveEndAt)) before
        // we bother repricing.
        const blockConflicts = await repos.vehicleBlockRepo.findOverlapping(
          replacement.id,
          booking.startAt,
          booking.effectiveEndAt,
        )
        if (blockConflicts.length > 0) {
          return {
            ok: false,
            status: 409,
            error:
              'Replacement vehicle is blocked (maintenance or hold) for the requested time range',
            code: 'VEHICLE_BLOCKED',
          }
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
        // Re-compose off the new vehicle's base through the SAME helper as
        // creation so a swap can never desync: locked insurance + locked add-ons
        // (#460) ride along unchanged, only the base re-prices. #855 was the
        // missing add-on term here; #862 makes divergence structurally impossible.
        const totalPrice = composeBookingTotal({
          baseJpy: pricing.totalPriceJpy,
          insurancePerDayJpy: booking.insuranceSnapshot?.dailyPriceJpy ?? 0,
          days: rentalDays(booking.startAt, booking.endAt),
          addOns: booking.addOnSnapshot,
        })

        // Turnaround follows the dropoff location, and substitution changes
        // neither pickup nor dropoff, so effectiveEndAt is preserved; the repo
        // re-runs the exclusion check for the NEW assigned vehicle over that
        // window atomically.
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
            type: 'VEHICLE_SUBSTITUTED',
            fromVehicleId: booking.assignedVehicleId,
            toVehicleId: replacement.id,
            reason,
          },
        })
        return { ok: true, booking: updated }
      })
      // Post-commit (#664): tell the renter their vehicle was swapped. Outside the
      // tx, caught-and-logged in the dispatcher — never rolls the substitution back.
      if (result.ok) await this.postCommit?.run(ctx, result.booking, 'SUBSTITUTED')
      return result
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

  /**
   * Operator assigns a concrete car to a CLASS_COMBO float (#464). One transaction:
   * load the booking (cross-operator -> 404, no leak), validate it is a CLASS_COMBO
   * in an assignable status, validate the car is AVAILABLE / same operator / same
   * pickup location / same ACRISS class / road-legal through the booking's endAt,
   * reassign via bookingRepo.reassignVehicle (exclusion constraint re-checks the
   * new vehicle atomically -> 409 if it's already booked), and append VEHICLE_ASSIGNED.
   * Price is intentionally NOT re-snapshotted — the class rate plan fixed it at submit.
   */
  async assignVehicle(
    ctx: CallerContext,
    bookingId: string,
    vehicleId: string,
    reason: string | null,
  ): Promise<SubstituteResult> {
    try {
      const result = await this.runInTransaction(async (repos): Promise<SubstituteResult> => {
        const booking = await repos.bookingRepo.findById(ctx, bookingId)
        if (!booking) return { ok: false, status: 404, error: 'Booking not found' }
        if (booking.fulfillmentMode !== 'CLASS_COMBO')
          return {
            ok: false,
            status: 409,
            error: 'Only class-deal bookings are assigned a vehicle',
            code: 'NOT_A_COMBO',
          }
        if (booking.status !== 'CONFIRMED' && booking.status !== 'ACTIVE')
          return {
            ok: false,
            status: 409,
            error: `Cannot assign a vehicle to a ${booking.status} booking`,
            code: 'INVALID_STATUS',
          }

        const car = await repos.vehicleRepo.findById(SYSTEM_CONTEXT, vehicleId)
        // missing OR foreign => 404, no existence leak (mirrors substitute()).
        if (!car || car.operatorId !== booking.operatorId)
          return { ok: false, status: 404, error: 'Vehicle not found' }
        if (car.status !== 'AVAILABLE')
          return { ok: false, status: 400, error: 'Vehicle is not available' }
        if ((car.pickupLocationId ?? null) !== booking.pickupLocationId)
          return { ok: false, status: 400, error: 'Vehicle serves a different pickup location' }
        if (!car.classId || !(await this.sameAcrissClass(booking.classId, car.classId)))
          return { ok: false, status: 400, error: 'Vehicle is a different class' }
        // road-legal asOf = endAt (NOT effectiveEndAt) to match the candidate feeder.
        if (!isRoadLegal(car, jstDateString(booking.endAt)))
          return {
            ok: false,
            status: 400,
            error: "Vehicle's shaken or insurance expires before the booking ends",
            code: 'VEHICLE_DOCS_EXPIRE_BEFORE_RETURN',
          }
        // #1152: a scheduled vehicle_block (maintenance/hold) on the target car is a
        // hard conflict — the SAME service-level guard SPECIFIC creation runs
        // (booking-creation.ts). The GiST EXCLUDE spans only bookings, so blocks are
        // checked here over the [startAt, effectiveEndAt) turnaround-inclusive window.
        const blockConflicts = await repos.vehicleBlockRepo.findOverlapping(
          car.id,
          booking.startAt,
          booking.effectiveEndAt,
        )
        if (blockConflicts.length > 0)
          return {
            ok: false,
            status: 409,
            error: 'Vehicle is blocked (maintenance or hold) for the requested time range',
            code: 'VEHICLE_BLOCKED',
          }

        // No reprice — class-deal price is fixed by the rate plan. effectiveEndAt is
        // invariant (turnaround follows the dropoff location, unchanged here).
        const updated = await repos.bookingRepo.reassignVehicle(ctx, booking.id, {
          assignedVehicleId: car.id,
          totalPrice: booking.totalPrice,
          effectiveEndAt: booking.effectiveEndAt,
        })
        if (!updated) return { ok: false, status: 404, error: 'Booking not found' }

        await repos.bookingEventRepo.append(ctx, {
          bookingId: booking.id,
          type: 'VEHICLE_ASSIGNED',
          actorId: ctx.userId,
          payload: {
            type: 'VEHICLE_ASSIGNED',
            fromVehicleId: booking.assignedVehicleId,
            toVehicleId: car.id,
            reason,
          },
        })
        return { ok: true, booking: updated }
      })
      return result
    } catch (err) {
      if (pgErrorCode(err) === PG_ERROR.EXCLUSION_VIOLATION)
        return {
          ok: false,
          status: 409,
          error: 'Vehicle is already booked for this time range',
          code: 'VEHICLE_UNAVAILABLE',
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
   * #616 §A: the vehicles eligible to replace a booking's assigned car — same
   * eligibility `substitute()` enforces: AVAILABLE, same pickup location, same
   * NON-NULL ACRISS code, excluding the assigned vehicle. Authorizes via the
   * tenant-scoped `findById` (foreign/missing booking -> undefined -> route
   * 404s, no leak); `findAll` operator-scopes the fleet, so same-operator is
   * implicit. ACRISS codes are resolved in ONE batch read, not two findById per
   * candidate (#709) — the classById pattern from storefront-search.ts.
   */
  async findSubstitutionCandidates(
    ctx: CallerContext,
    bookingId: string,
  ): Promise<Vehicle[] | undefined> {
    if (!this.vehicleRepo || !this.vehicleClassRepo) {
      throw new Error('BookingService missing vehicle/class repo; check DI wiring')
    }
    const booking = await this.bookingRepo.findById(ctx, bookingId)
    if (!booking) return undefined

    const { data: available } = await this.vehicleRepo.findAll(ctx, {
      status: 'AVAILABLE',
      limit: SUBSTITUTION_CANDIDATE_SCAN_LIMIT,
    })
    const classes = await this.vehicleClassRepo.findAll(ctx, { includeArchived: true })
    const acrissById = new Map(classes.map((vc) => [vc.id, vc.acrissCode]))
    // Unmapped class (null acriss) is never a substitution target (mirrors
    // sameAcrissClass): both sides must share the same non-null code.
    const bookingAcriss = acrissById.get(booking.classId)
    if (!bookingAcriss) return []
    // §5.3b (#916): an expired car must never surface as a substitution option —
    // road-legal through the booking's return date, same clock as substitute().
    const asOf = jstDateString(booking.endAt)
    return available.filter(
      (v) =>
        v.id !== booking.assignedVehicleId &&
        (v.pickupLocationId ?? null) === booking.pickupLocationId &&
        acrissById.get(v.classId ?? '') === bookingAcriss &&
        isRoadLegal(v, asOf),
    )
  }

  /**
   * Operator status transition (route-gated to MANAGEMENT_READ_ROLES, #643).
   * Transitioning to CANCELLED is the operator cancel path and is deliberately
   * FEE-FREE — operator non-delivery is the operator's fault, so the renter is made
   * whole, never penalised for it. The tiered cancellation fee lives ONLY on renter
   * self-cancel (`cancel()`); the two CANCELLED paths are intentionally divergent,
   * not duplicated (#679) — do not merge them.
   */
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

    // #851: operator cancel of a PAID booking is fee-free → the renter is owed the
    // FULL total back. The settlement is read before the tx (payment_events is
    // immutable once SUCCEEDED) and committed REFUND_DUE atomically inside it.
    const owesRefund =
      newStatus === 'CANCELLED' && ((await this.refunds?.isBookingPaid(booking.id)) ?? false)

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
        payload: {
          type: 'STATUS_CHANGED',
          from: booking.status,
          to: newStatus as Booking['status'],
        },
      })
      // Commit REFUND_DUE in the same tx (a CANCELLED booking is at the 'ADVISORY'
      // default). Return the settled projection so callers/emails see REFUND_DUE.
      if (owesRefund) {
        const settled = await repos.bookingRepo.markCancellationSettlement(ctx, booking.id, {
          from: 'ADVISORY',
          to: 'REFUND_DUE',
        })
        if (settled) return settled
      }
      return next
    })
    if (!updated) {
      return {
        ok: false,
        status: 409,
        error: 'Booking status was modified by another request. Please retry.',
      }
    }
    // Post-commit (#664): notify the renter on a renter-visible advance
    // (ACTIVE/COMPLETED). Unlisted transitions map to undefined → no email.
    const trigger = STATUS_TRIGGER[newStatus]
    if (trigger) await this.postCommit?.run(ctx, updated, trigger)
    // Eager refund (#851), best-effort. Gate on the COMMITTED settlement, not the pre-tx
    // `owesRefund` (#1056): if the in-tx REFUND_DUE write no-op'd, firing would refund a
    // booking the reconciler can't see. Mirrors cancel()'s settlement === 'REFUND_DUE' gate.
    if (updated.cancellationFeeSettlement === 'REFUND_DUE') {
      await this.fireEagerRefund(updated, booking.totalPrice ?? 0)
    }
    return { ok: true, booking: updated }
  }

  /**
   * Renter self-cancel — ALWAYS applies the tiered cancellation fee
   * (`calculateCancellationFee`) and returns the breakdown so the renter sees what
   * they forfeit vs are refunded. CONFIRMED-only by design; an operator cancels an
   * ACTIVE booking via `updateStatus(-> CANCELLED)`, which charges nothing (#679).
   * Keep the two paths separate — the fee asymmetry is the product rule, not dup.
   */
  async cancel(
    ctx: CallerContext,
    bookingId: string,
    reason: CancellationReason | null = null,
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
    // #851: a PAID booking owes a refund; the settlement state is written IN the
    // cancel tx so the durable work queue can never miss it on a crash.
    const isPaid = (await this.refunds?.isBookingPaid(booking.id)) ?? false
    const settlement = renterCancelSettlement(isPaid, cancellation.refundAmount)

    // Projection cancel + BOOKING_CANCELLED append in one tx so the event log
    // records every lifecycle transition, not just create/substitute (§3.1).
    const updated = await this.runInTransaction(async (repos) => {
      const next = await repos.bookingRepo.cancel(ctx, booking.id, {
        from: booking.status,
        fee: cancellation.feeAmount,
        cancelledAt: now,
        settlement,
      })
      if (!next) return undefined
      await repos.bookingEventRepo.append(ctx, {
        bookingId: booking.id,
        type: 'BOOKING_CANCELLED',
        actorId: ctx.userId,
        payload: {
          type: 'BOOKING_CANCELLED',
          cancellationFee: cancellation.feeAmount,
          cancelledAt: now.toISOString(),
          cancellationReason: reason,
        },
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
    // Post-commit (#664): tell the renter their booking was cancelled.
    await this.postCommit?.run(ctx, updated, 'CANCELLED')
    // Eager refund (#851), best-effort: only when we durably committed REFUND_DUE.
    if (settlement === 'REFUND_DUE') {
      await this.fireEagerRefund(updated, cancellation.refundAmount)
    }
    return { ok: true, booking: updated, cancellation }
  }

  /** Eager, best-effort kick of the refund after a cancel commits REFUND_DUE (#851).
   *  Caught-and-logged like the post-commit dispatcher: a Stripe hiccup must never
   *  roll back (or 500) the cancel — the booking is durably REFUND_DUE and the
   *  reconciler backstop re-drives. */
  private async fireEagerRefund(booking: Booking, intendedAmountJpy: number): Promise<void> {
    if (!this.refunds) return
    try {
      await this.refunds.initiateCancellationRefund(booking, intendedAmountJpy)
    } catch (err) {
      console.error('[refund:eager] initiate failed; left REFUND_DUE for the reconciler', {
        bookingId: booking.id,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
}
