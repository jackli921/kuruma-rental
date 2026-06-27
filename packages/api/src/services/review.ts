import type { ReviewAuthorRole, ReviewSubject } from '@kuruma/shared/enums'
import {
  computeRevealDeadline,
  decideReveal,
  summarizeSides,
} from '@kuruma/shared/lib/review-reveal'
import type { EditReviewInput, SubmitReviewInput } from '@kuruma/shared/validators/review'
import { type CallerContext, SYSTEM_CONTEXT } from '../middleware/auth'
import { PG_ERROR, REVIEWS_SUBJECT_CONSTRAINT, pgConstraintName, pgErrorCode } from '../pg-errors'
import type {
  BookingEventRepository,
  BookingRepository,
  NewReview,
  OperatorMembershipRepository,
  ReviewEdit,
  ReviewRepository,
} from '../repositories/types'
import type { Booking, Review } from '../stores'

interface Fail {
  readonly ok: false
  readonly status: number
  readonly error: string
}
type Ok<T> = { readonly ok: true } & T

export type SubmitResult = Ok<{ review: Review }> | Fail
export type EditResult = Ok<{ review: Review }> | Fail
export type GetReviewsResult = Ok<{ reviews: Review[] }> | Fail
export interface SweepSummary {
  readonly scanned: number
  readonly published: number
  readonly bookingsTouched: number
}

const fail = (status: number, error: string): Fail => ({ ok: false, status, error })

// The sub-dimensions each direction may rate (#1067). The KEYS of each inner record
// double as the subjects a given author role is allowed to review — so this one table
// drives both the participant/pairing guard and per-direction dimension validation.
// A renter rates the operator (4 dims) or the vehicle (none); an operator rates the
// renter (3 dims). Anything outside its row is a 403 (wrong subject) or 400 (wrong dim).
const DIRECTION: Record<ReviewAuthorRole, Partial<Record<ReviewSubject, readonly string[]>>> = {
  RENTER: {
    OPERATOR: ['cleanliness', 'accuracy', 'communication', 'value'],
    VEHICLE: [],
  },
  OPERATOR: {
    RENTER: ['communication', 'cleanliness', 'ruleAdherence'],
  },
}

// Drop absent optionals so the validated (typed-optional) sub-ratings narrow to a clean
// Record<string, number> for the column — no `as` assertion, no undefined values stored.
function cleanSubRatings(raw: Record<string, number | undefined>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'number') out[key] = value
  }
  return out
}

// A review may only carry sub-dimensions its direction allows (DIRECTION table). The same
// invariant gates submit AND edit — an author must not be able to smuggle a foreign-direction
// dimension in after the fact — so both call this rather than re-spelling the check.
function hasForeignDimension(
  subRatings: Record<string, number>,
  allowedDims: readonly string[],
): boolean {
  return Object.keys(subRatings).some((d) => !allowedDims.includes(d))
}

/**
 * Mutual, double-blind review submission + reveal (#1067 slice 2). Owns the
 * eligibility guard (COMPLETED-only, participant-only), the server-side derivation of
 * a review's tenant/subject/reveal fields, and the lazy + swept reveal that keeps a
 * counterparty's review hidden until both sides submit OR the window elapses.
 *
 * The booking is loaded with SYSTEM_CONTEXT and authorized HERE (participant check)
 * rather than relying on the repo's tenant scope — the service is the authorization
 * boundary for reviews, and it must distinguish a stranger (403) from a missing
 * booking (404), which a renter-scoped read could not.
 */
export class ReviewService {
  constructor(
    private readonly reviewRepo: ReviewRepository,
    private readonly bookingRepo: BookingRepository,
    private readonly bookingEventRepo: BookingEventRepository,
    private readonly operatorMembershipRepo: OperatorMembershipRepository,
  ) {}

  /** The role the caller acts as for this booking, or null if they are not a
   *  participant. Renter wins by identity; otherwise an ACTIVE membership of the
   *  booking's operator. PLATFORM_ADMIN/PARTNER are NOT review participants. */
  private async resolveRole(
    ctx: CallerContext,
    booking: Booking,
  ): Promise<ReviewAuthorRole | null> {
    if (booking.renterId === ctx.userId) return 'RENTER'
    const membership = await this.operatorMembershipRepo.findActiveByUserId(ctx.userId)
    if (membership && membership.operatorId === booking.operatorId) return 'OPERATOR'
    return null
  }

  /** Completion instant from the booking event log — the STATUS_CHANGED->COMPLETED
   *  event's createdAt, NOT the mutable bookings.updatedAt. Null if (defensively) no
   *  such event exists, which the caller turns into a 409. */
  private async findCompletedAt(bookingId: string): Promise<Date | null> {
    const events = await this.bookingEventRepo.findByBookingId(SYSTEM_CONTEXT, bookingId)
    const completions = events
      .filter((e) => e.payload.type === 'STATUS_CHANGED' && e.payload.to === 'COMPLETED')
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    return completions[0]?.createdAt ?? null
  }

  async submit(ctx: CallerContext, input: SubmitReviewInput, now: Date): Promise<SubmitResult> {
    const booking = await this.bookingRepo.findById(SYSTEM_CONTEXT, input.bookingId)
    if (!booking) return fail(404, 'BOOKING_NOT_FOUND')

    const role = await this.resolveRole(ctx, booking)
    const allowedDims = role ? DIRECTION[role][input.subject] : undefined
    // Participant + subject-pairing in one check: a caller may only review a subject
    // their role has a dimension row for. Checked before status so a non-participant
    // can't probe the booking's lifecycle state.
    if (!role || allowedDims === undefined) return fail(403, 'NOT_A_PARTICIPANT')
    if (booking.status !== 'COMPLETED') return fail(409, 'BOOKING_NOT_COMPLETED')

    const subRatings = cleanSubRatings(input.subRatings)
    if (hasForeignDimension(subRatings, allowedDims)) return fail(400, 'INVALID_DIMENSIONS')

    const subjectVehicleId = input.subject === 'VEHICLE' ? booking.assignedVehicleId : null
    if (input.subject === 'VEHICLE' && subjectVehicleId === null) {
      return fail(409, 'VEHICLE_NOT_ASSIGNED')
    }
    const completedAt = await this.findCompletedAt(booking.id)
    if (!completedAt) return fail(409, 'COMPLETION_TIME_UNKNOWN')

    const newReview: NewReview = {
      bookingId: booking.id,
      operatorId: booking.operatorId,
      authorUserId: ctx.userId,
      authorRole: role,
      subject: input.subject,
      subjectVehicleId,
      // A vehicle review carries the booking's class (substitution preserves it); the
      // class CHECK is one-way so a non-vehicle review's null is fine.
      subjectClassId: input.subject === 'VEHICLE' ? booking.classId : null,
      overall: input.overall,
      subRatings,
      comment: input.comment ?? null,
      moderationStatus: 'VISIBLE',
      revealDeadlineAt: computeRevealDeadline(completedAt),
      submittedAt: now,
      publishedAt: null,
    }

    try {
      const inserted = await this.reviewRepo.insert(newReview)
      // Reveal on write, not only on read (#1195): if this submit completes a pair — or the
      // 14-day window has already elapsed — publish both sides now, so API-only/3rd-party
      // submitters (no refetch) and slice-5 aggregates (which filter publishedAt) don't wait
      // for a later getForBooking or the daily sweep. Idempotent (publishMany is first-write-
      // wins) and double-blind-safe: decideReveal still gates on counterpart-submitted-or-
      // elapsed, so a lone first submitter inside the window stays hidden. Re-read so the
      // response reflects the post-settle publishedAt.
      await this.settleReveal(booking.id, now)
      const review = (await this.reviewRepo.findById(inserted.id)) ?? inserted
      return { ok: true, review }
    } catch (err) {
      // The single seal trips ALREADY_REVIEWED: a resubmit of the same (booking, subject)
      // by the renter, or a colleague already speaking for the operator (#1158/#1201).
      if (
        pgErrorCode(err) === PG_ERROR.UNIQUE_VIOLATION &&
        pgConstraintName(err) === REVIEWS_SUBJECT_CONSTRAINT
      ) {
        return fail(409, 'ALREADY_REVIEWED')
      }
      throw err
    }
  }

  async edit(
    ctx: CallerContext,
    reviewId: string,
    input: EditReviewInput,
    _now: Date,
  ): Promise<EditResult> {
    // Load first: the row carries the authorRole + subject the dimension rule needs, and
    // lets a missing OR foreign id collapse to one 404 (no review-id enumeration, and the
    // honest code instead of a misleading ALREADY_PUBLISHED for a stranger).
    const review = await this.reviewRepo.findById(reviewId)
    if (!review || review.authorUserId !== ctx.userId) return fail(404, 'REVIEW_NOT_FOUND')
    if (review.publishedAt) return fail(409, 'ALREADY_PUBLISHED')

    const subRatings = cleanSubRatings(input.subRatings)
    // Re-enforce the per-direction dimension invariant on edit, exactly as submit does —
    // otherwise an author could submit clean then edit in a foreign-direction dimension,
    // polluting the slice-5 aggregates the rule exists to protect.
    const allowedDims = DIRECTION[review.authorRole][review.subject] ?? []
    if (hasForeignDimension(subRatings, allowedDims)) return fail(400, 'INVALID_DIMENSIONS')

    const patch: ReviewEdit = { overall: input.overall, subRatings, comment: input.comment ?? null }
    // update keeps its own atomic (id, author, publishedAt IS NULL) WHERE as the race guard:
    // if a concurrent reveal published the row between the read above and here, it returns
    // undefined — which can now only mean a just-published row, hence the honest 409.
    const updated = await this.reviewRepo.update(reviewId, ctx.userId, patch)
    if (!updated) return fail(409, 'ALREADY_PUBLISHED')
    return { ok: true, review: updated }
  }

  /** Lazy reveal: publish every hidden review for the booking whose reveal condition
   *  is now met (counterpart submitted OR window elapsed). Idempotent — publishMany
   *  only flips still-hidden rows. Returns how many newly published. */
  async settleReveal(bookingId: string, now: Date): Promise<number> {
    const reviews = await this.reviewRepo.findByBookingId(bookingId)
    const sides = summarizeSides(reviews)
    const toPublish = reviews
      .filter((r) => r.publishedAt === null)
      .filter((r) => {
        const counterpartSubmitted =
          r.authorRole === 'RENTER' ? sides.operatorSubmitted : sides.renterSubmitted
        return decideReveal(r, counterpartSubmitted, now) !== null
      })
      .map((r) => r.id)
    if (toPublish.length === 0) return 0
    return this.reviewRepo.publishMany(toPublish, now)
  }

  async getForBooking(ctx: CallerContext, bookingId: string, now: Date): Promise<GetReviewsResult> {
    const booking = await this.bookingRepo.findById(SYSTEM_CONTEXT, bookingId)
    if (!booking) return fail(404, 'BOOKING_NOT_FOUND')
    const role = await this.resolveRole(ctx, booking)
    if (!role) return fail(403, 'NOT_A_PARTICIPANT')

    await this.settleReveal(bookingId, now)
    const reviews = await this.reviewRepo.findByBookingId(bookingId)
    // The reader always sees their own rows; a counterparty row only once published. An
    // OPERATOR reader additionally sees their operator's OWN side even while hidden /
    // authored by a colleague (#1158): the operator->renter review is the tenant's, not
    // the staff member's, so a colleague's pending row must hide the rate-renter prompt.
    // All OPERATOR rows for a booking share its operatorId, so this never reveals the
    // renter's still-hidden side — the renter↔operator double-blind stays intact.
    const visible = reviews.filter(
      (r) =>
        r.authorUserId === ctx.userId ||
        r.publishedAt !== null ||
        (role === 'OPERATOR' && r.authorRole === 'OPERATOR'),
    )
    return { ok: true, reviews: visible }
  }

  /** Daily backstop: publish window-elapsed reviews that no read has settled. Bounded
   *  scan; idempotent (publishMany first-write-wins). */
  async sweep(now: Date, limit: number): Promise<SweepSummary> {
    const due = await this.reviewRepo.findRevealDue(now, limit)
    const toPublish = due.filter((r) => decideReveal(r, false, now) !== null)
    const ids = toPublish.map((r) => r.id)
    const published = ids.length > 0 ? await this.reviewRepo.publishMany(ids, now) : 0
    const bookingsTouched = new Set(toPublish.map((r) => r.bookingId)).size
    return { scanned: due.length, published, bookingsTouched }
  }
}
