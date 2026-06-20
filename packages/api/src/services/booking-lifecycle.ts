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
    private readonly postCommit?: BookingPostCommitDispatcher,
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
    return { ok: true, booking: updated, cancellation }
  }
}
