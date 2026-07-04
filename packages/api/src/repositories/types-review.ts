import type { ReviewModerationStatus } from '@kuruma/shared/enums'
import type { Review, ReviewReport } from '../stores'

/** A review to persist. id + createdAt + updatedAt are store-assigned (DB defaults
 *  / in-memory), so the submission service never invents them. `publishedAt` is
 *  passed explicitly (null on first submit — the row starts hidden); `submittedAt`
 *  and `revealDeadlineAt` are domain decisions the service computes from one clock. */
export type NewReview = Omit<Review, 'id' | 'createdAt' | 'updatedAt'>

/** The only mutable content of a review (the rest is identity/reveal state derived
 *  server-side and never editable). Applied by `update` until the row publishes. */
export type ReviewEdit = Pick<Review, 'overall' | 'subRatings' | 'comment'>

/** A report to persist. id + createdAt are store-assigned (DB default / in-memory). */
export type NewReviewReport = Omit<ReviewReport, 'id' | 'createdAt'>

/** A reported review for the admin moderation queue: the review plus how many distinct
 *  users flagged it and their reasons (newest-reported first from the repo). */
export interface ReportedReview {
  review: Review
  reportCount: number
  reasons: readonly string[]
}

/** Keyset cursor for the moderation queue (#1451): the previous page's last boundary — a
 *  report-recency instant plus a reviewId tiebreak, matching the queue's
 *  (lastReportedAt DESC, reviewId DESC) order. Opaque to callers above the repo. */
export interface ReportedQueueCursor {
  lastReportedAt: Date
  reviewId: string
}

/** Query for the moderation queue (#1451). `status` partitions it: 'VISIBLE' = unactioned
 *  (the default working set — hidden rows never accumulate here), 'HIDDEN' = already
 *  resolved. `limit` + `cursor` bound each page so the payload/query can't grow unbounded. */
export interface ListReportedOptions {
  limit: number
  status: ReviewModerationStatus
  cursor?: ReportedQueueCursor | undefined
}

/** One page of the moderation queue: the reported reviews plus the cursor for the next
 *  page, or null when no further page may exist. */
export interface ReportedReviewPage {
  items: readonly ReportedReview[]
  nextCursor: ReportedQueueCursor | null
}

/** reviews data access (#1067 slice 1, extended slice 2). The submission service is
 *  the only writer; reveal-on-read (slice 2) and subject aggregates (slice 5) layer on
 *  top of this contract. */
export interface ReviewRepository {
  // Persist a submitted review. Throws a PG-shaped UNIQUE_VIOLATION (with
  // `constraint_name === REVIEWS_SUBJECT_CONSTRAINT`) when a review for the same
  // (bookingId, subject) already exists, so the service can tell a resubmission
  // (edit the hidden row) apart from a first submit. See pg-errors.
  insert(review: NewReview): Promise<Review>
  // A single review by id, or undefined. The edit path loads the row first to re-check
  // its per-direction dimension rule (the row carries authorRole + subject) and to map a
  // missing / foreign id to a uniform 404 — neither of which `update`'s WHERE can express.
  findById(id: string): Promise<Review | undefined>
  // Every review authored for a booking (either side, any subject) — drives the
  // double-blind reveal decision (`summarizeSides` / `decideReveal`) in slice 2.
  findByBookingId(bookingId: string): Promise<Review[]>
  // Edit-until-published (slice 2). Atomically scoped to `authorUserId` AND to
  // unpublished rows (`publishedAt IS NULL`) so a non-author can't edit and a
  // concurrent reveal can't be clobbered. Returns undefined when no such row matched
  // (absent, already published, or not the caller's) — the service maps that to 409.
  update(id: string, authorUserId: string, patch: ReviewEdit): Promise<Review | undefined>
  // Reveal write (slice 2). Stamp `publishedAt` on the given ids that are still hidden
  // (`publishedAt IS NULL`), first-write-wins. Returns how many rows flipped, so both
  // the lazy-read and the sweep are idempotent (a re-run publishes 0, never re-stamps).
  publishMany(ids: string[], publishedAt: Date): Promise<number>
  // Sweep scan (slice 2). Hidden reviews past their window (`publishedAt IS NULL AND
  // revealDeadlineAt <= now`), oldest-deadline first, capped at `limit`.
  findRevealDue(now: Date, limit: number): Promise<Review[]>
  // Aggregate scans (slice 5 #1085). Sum + count of overall ratings per subject id,
  // over reviews that are BOTH published (`publishedAt IS NOT NULL`) AND visible
  // (`moderationStatus = 'VISIBLE'`) so a hidden or still-double-blind row never
  // skews a public storefront rating. Batched (single-id is a 1-element batch) so a
  // search page's N storefront cards don't fan out into N queries. Empty ids -> empty
  // Map, zero rows. Ids with no matching rows are ABSENT from the returned Map
  // (not present as {sum:0,count:0}) — the service distinguishes "no reviews yet"
  // from "rated zero" at the call site.
  aggregateByOperator(
    operatorIds: readonly string[],
  ): Promise<Map<string, { sum: number; count: number }>>
  aggregateByVehicle(
    vehicleIds: readonly string[],
  ): Promise<Map<string, { sum: number; count: number }>>
  aggregateByClass(
    classIds: readonly string[],
  ): Promise<Map<string, { sum: number; count: number }>>
  // Persist a report (slice 6 #1086). Throws a PG-shaped UNIQUE_VIOLATION with
  // constraint_name === REVIEW_REPORT_UNIQUE_CONSTRAINT when this user already reported
  // the review, so the service maps a duplicate to 409 without a check-then-act race.
  insertReport(report: NewReviewReport): Promise<ReviewReport>
  // Flip a review's moderation status (admin hide, slice 6). Stamps the moderation audit
  // (#1454): `moderatedBy` = the acting admin, `moderatedAt` = the moderation instant — so a
  // multi-admin platform can attribute the action (distinct from the mutable `updatedAt`).
  // Returns the updated row, or undefined when no review has that id (→ 404). Idempotent on
  // status, but each call re-stamps the audit with the latest actor/time.
  setModerationStatus(
    id: string,
    status: ReviewModerationStatus,
    moderatedBy: string,
    moderatedAt: Date,
  ): Promise<Review | undefined>
  // The admin moderation queue (slice 6 #1086), keyset-paginated + status-partitioned
  // (#1451). Reviews with >=1 report whose moderationStatus === options.status, each with
  // its distinct-reporter count + reasons, ordered (lastReportedAt DESC, reviewId DESC),
  // capped at options.limit, starting after options.cursor. `nextCursor` is non-null only
  // when the page was full (a further page may exist).
  listReported(options: ListReportedOptions): Promise<ReportedReviewPage>
  // Public display read (review-display slice). The newest published + VISIBLE
  // reviews whose subject key matches, capped at `limit`, ordered publishedAt DESC.
  // subject='OPERATOR' scopes on the denormalized operatorId; 'VEHICLE' on
  // subjectVehicleId. RENTER is never listable (privacy) — the service enforces that,
  // so this port only accepts the two public subjects.
  listPublishedForSubject(
    subject: 'OPERATOR' | 'VEHICLE',
    subjectId: string,
    limit: number,
  ): Promise<Review[]>
}
