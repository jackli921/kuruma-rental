import type { Review } from '../stores'

/** A review to persist. id + createdAt + updatedAt are store-assigned (DB defaults
 *  / in-memory), so the submission service never invents them. `publishedAt` is
 *  passed explicitly (null on first submit — the row starts hidden); `submittedAt`
 *  and `revealDeadlineAt` are domain decisions the service computes from one clock. */
export type NewReview = Omit<Review, 'id' | 'createdAt' | 'updatedAt'>

/** The only mutable content of a review (the rest is identity/reveal state derived
 *  server-side and never editable). Applied by `update` until the row publishes. */
export type ReviewEdit = Pick<Review, 'overall' | 'subRatings' | 'comment'>

/** reviews data access (#1067 slice 1, extended slice 2). The submission service is
 *  the only writer; reveal-on-read (slice 2) and subject aggregates (slice 5) layer on
 *  top of this contract. */
export interface ReviewRepository {
  // Persist a submitted review. Throws a PG-shaped UNIQUE_VIOLATION (with
  // `constraint_name === REVIEWS_AUTHOR_SUBJECT_CONSTRAINT`) when the same
  // (bookingId, authorUserId, subject) already exists, so the service can tell a
  // resubmission (edit the hidden row) apart from a first submit. See pg-errors.
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
}
