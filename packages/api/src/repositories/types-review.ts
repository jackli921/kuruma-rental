import type { Review } from '../stores'

/** A review to persist. id + createdAt + updatedAt are store-assigned (DB defaults
 *  / in-memory), so the submission service never invents them. `publishedAt` is
 *  passed explicitly (null on first submit — the row starts hidden); `submittedAt`
 *  and `revealDeadlineAt` are domain decisions the service computes from one clock. */
export type NewReview = Omit<Review, 'id' | 'createdAt' | 'updatedAt'>

/** reviews data access (#1067 slice 1). The submission service is the only writer;
 *  later slices layer reveal-on-read (slice 2) and subject aggregates (slice 5) on
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
}
