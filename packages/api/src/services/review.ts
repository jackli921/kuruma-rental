import type { ReviewAuthorRole, ReviewModerationStatus, ReviewSubject } from '@kuruma/shared/enums'
import {
  computeRevealDeadline,
  decideReveal,
  summarizeSides,
} from '@kuruma/shared/lib/review-reveal'
import type {
  EditReviewInput,
  ReportReviewInput,
  SubmitReviewInput,
} from '@kuruma/shared/validators/review'
import { type CallerContext, SYSTEM_CONTEXT } from '../middleware/auth'
import {
  PG_ERROR,
  REVIEWS_SUBJECT_CONSTRAINT,
  REVIEW_REPORT_UNIQUE_CONSTRAINT,
  pgConstraintName,
  pgErrorCode,
} from '../pg-errors'
import type {
  BookingEventRepository,
  BookingRepository,
  NewReview,
  OperatorMembershipRepository,
  ReportedQueueCursor,
  ReportedReviewPage,
  ReviewEdit,
  ReviewRepository,
  VehicleRepository,
} from '../repositories/types'
import type { Booking, Review, ReviewReport } from '../stores'

interface Fail {
  readonly ok: false
  readonly status: number
  readonly error: string
}
type Ok<T> = { readonly ok: true } & T

export type SubmitResult = Ok<{ review: Review }> | Fail
export type EditResult = Ok<{ review: Review }> | Fail

/** The participant-facing projection of a review (#1086 follow-up). The double-blind read
 *  returns the caller's own rows plus revealed counterparty rows — but the raw entity also
 *  carries internal moderation state (moderatedBy is a platform admin's userId; moderationStatus
 *  and moderatedAt are operator/audit-only) plus authorUserId, operatorId and the reveal
 *  deadline. Allowlist exactly the fields the client reads so none of that crosses the wire. */
export interface ParticipantReview {
  readonly id: Review['id']
  readonly bookingId: Review['bookingId']
  readonly authorRole: Review['authorRole']
  readonly subject: Review['subject']
  readonly overall: Review['overall']
  readonly comment: Review['comment']
  readonly publishedAt: Review['publishedAt']
}

function toParticipantReview(r: Review): ParticipantReview {
  return {
    id: r.id,
    bookingId: r.bookingId,
    authorRole: r.authorRole,
    subject: r.subject,
    overall: r.overall,
    comment: r.comment,
    publishedAt: r.publishedAt,
  }
}

export type GetReviewsResult = Ok<{ reviews: ParticipantReview[] }> | Fail
export type ReportResult = Ok<{ report: ReviewReport }> | Fail
export interface SweepSummary {
  readonly scanned: number
  readonly published: number
  readonly bookingsTouched: number
}

const fail = (status: number, error: string): Fail => ({ ok: false, status, error })

// Moderation-queue page bounds (#1451). The queue is admin-only and small today, but a
// list endpoint ships with a limit from day one — an unbounded payload/query is a latent
// scaling cliff. Callers may request a smaller page; the max caps a hostile/large `limit`.
const DEFAULT_MODERATION_QUEUE_LIMIT = 20
const MAX_MODERATION_QUEUE_LIMIT = 100

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
    private readonly vehicleRepo: VehicleRepository,
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

    // Key the class to the car ACTUALLY driven, not booking.classId: substitution / assignVehicle
    // can swap in a same-ACRISS car of a DIFFERENT class without touching booking.classId (#1270),
    // and the storefront badge reads the vehicle's own class — so a class-X car's review must land
    // under class X. Derive it from the assigned vehicle so subjectVehicleId and subjectClassId
    // agree. Null when the car has no class (or, defensively, is gone): the one-way
    // reviews_class_subject_chk permits a VEHICLE review with a null class.
    const subjectClassId =
      subjectVehicleId === null
        ? null
        : ((await this.vehicleRepo.findById(SYSTEM_CONTEXT, subjectVehicleId))?.classId ?? null)

    const newReview: NewReview = {
      bookingId: booking.id,
      operatorId: booking.operatorId,
      authorUserId: ctx.userId,
      authorRole: role,
      subject: input.subject,
      subjectVehicleId,
      subjectClassId,
      overall: input.overall,
      subRatings,
      comment: input.comment ?? null,
      moderationStatus: 'VISIBLE',
      moderatedBy: null,
      moderatedAt: null,
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
    // The reader always sees their own rows (even after an admin hides them — the author
    // must know their content was moderated). Every OTHER path is additionally gated on
    // moderationStatus === 'VISIBLE', so an admin-HIDDEN review stops leaking to a revealed
    // counterparty or an operator colleague (#1086) — otherwise `publishedAt !== null`
    // alone would keep surfacing it. Of the remaining rows a reader may see: a counterparty
    // row once published, and — for an OPERATOR reader — their operator's OWN side even
    // while hidden/authored by a colleague (#1158), so a colleague's pending row still hides
    // the rate-renter prompt. All OPERATOR rows share the booking's operatorId, so this never
    // reveals the renter's still-hidden side — the renter↔operator double-blind stays intact.
    const visible = reviews.filter((r) => {
      if (r.authorUserId === ctx.userId) return true
      if (r.moderationStatus !== 'VISIBLE') return false
      return r.publishedAt !== null || (role === 'OPERATOR' && r.authorRole === 'OPERATOR')
    })
    return { ok: true, reviews: visible.map(toParticipantReview) }
  }

  /** Flag a review for moderator attention (#1086). Only a publicly-visible review
   *  (published AND VISIBLE) can be reported: a still-hidden double-blind row, an
   *  admin-HIDDEN row, and a missing id are indistinguishable — all 404 — so a report
   *  cannot probe whether a counterparty's review exists yet. A report NEVER auto-hides;
   *  it only queues the review (owner decision, keeps the model retaliation-proof). The
   *  unique (reviewId, reporterUserId) seal maps a repeat report to 409 ALREADY_REPORTED
   *  without a check-then-act race. */
  async reportReview(
    ctx: CallerContext,
    reviewId: string,
    input: ReportReviewInput,
  ): Promise<ReportResult> {
    const review = await this.reviewRepo.findById(reviewId)
    if (!review || review.publishedAt === null || review.moderationStatus !== 'VISIBLE') {
      return fail(404, 'REVIEW_NOT_FOUND')
    }
    try {
      const report = await this.reviewRepo.insertReport({
        reviewId: review.id,
        reporterUserId: ctx.userId,
        reason: input.reason,
      })
      return { ok: true, report }
    } catch (err) {
      if (
        pgErrorCode(err) === PG_ERROR.UNIQUE_VIOLATION &&
        pgConstraintName(err) === REVIEW_REPORT_UNIQUE_CONSTRAINT
      ) {
        return fail(409, 'ALREADY_REPORTED')
      }
      throw err
    }
  }

  /** Admin soft-hide (#1086): flip a review to HIDDEN so it stops surfacing publicly and
   *  to the counterparty (getForBooking + slice-5 aggregates both gate on VISIBLE), while
   *  the row is kept for audit. Records WHO hid it and WHEN (#1454) — `ctx.userId` +
   *  `now` — so a multi-admin platform can attribute the action. Returns the updated row,
   *  or undefined when no review has that id (→ 404 at the route). Idempotent on status —
   *  re-hiding stays HIDDEN (and re-stamps the audit with the latest actor). The
   *  platform-admin write gate is applied in the route (routes/admin-reviews.ts), atop the
   *  structural `/admin/*` floor. */
  async hideReview(ctx: CallerContext, reviewId: string, now: Date): Promise<Review | undefined> {
    return this.reviewRepo.setModerationStatus(reviewId, 'HIDDEN', ctx.userId, now)
  }

  /** The admin moderation queue (#1086), keyset-paginated + status-partitioned (#1451).
   *  Defaults to the UNACTIONED partition (VISIBLE) so already-hidden rows don't pile up in
   *  the working queue; pass status: 'HIDDEN' for the resolved view. `limit` is clamped to
   *  [1, MAX] so a caller can page smaller but never unbounded. Read-gated by the route. */
  async listReported(
    options: {
      readonly limit?: number | undefined
      readonly status?: ReviewModerationStatus | undefined
      readonly cursor?: ReportedQueueCursor | undefined
    } = {},
  ): Promise<ReportedReviewPage> {
    const limit = Math.min(
      Math.max(Math.trunc(options.limit ?? DEFAULT_MODERATION_QUEUE_LIMIT), 1),
      MAX_MODERATION_QUEUE_LIMIT,
    )
    const status = options.status ?? 'VISIBLE'
    return this.reviewRepo.listReported({ limit, status, cursor: options.cursor })
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
