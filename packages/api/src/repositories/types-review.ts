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
}
