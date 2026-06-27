import { reviews } from '@kuruma/shared/db/schema'
import { and, asc, eq, inArray, isNull, lte } from 'drizzle-orm'
import type { Review } from '../../stores'
import type { NewReview, ReviewEdit, ReviewRepository } from '../types'
import { type Db, reviewColumns, toReview } from './shared'

export class DrizzleReviewRepository implements ReviewRepository {
  constructor(private readonly db: Db) {}

  // The DB enforces the one-per-author-per-subject unique + the row-shape CHECKs;
  // a violation bubbles up as a PostgresError whose constraint_name the submission
  // service reads (resubmit vs first submit). We do NOT swallow it here — that
  // policy decision belongs to the service (mirrors DrizzlePaymentEventRepository).
  async insert(data: NewReview): Promise<Review> {
    const [row] = await this.db.insert(reviews).values(data).returning(reviewColumns)
    // .returning always yields the inserted row on success; the non-null branch is
    // unreachable but keeps the type honest without a non-null assertion.
    if (!row) throw new Error('reviews insert returned no row')
    return toReview(row)
  }

  async findById(id: string): Promise<Review | undefined> {
    const [row] = await this.db
      .select(reviewColumns)
      .from(reviews)
      .where(eq(reviews.id, id))
      .limit(1)
    return row ? toReview(row) : undefined
  }

  async findByBookingId(bookingId: string): Promise<Review[]> {
    const rows = await this.db
      .select(reviewColumns)
      .from(reviews)
      .where(eq(reviews.bookingId, bookingId))
    return rows.map(toReview)
  }

  async update(id: string, authorUserId: string, patch: ReviewEdit): Promise<Review | undefined> {
    // The WHERE is the guard: only the author's own, still-hidden row updates. A
    // published or foreign or absent row matches nothing -> .returning yields [] ->
    // undefined, which the service maps to 409. publishedAt IS NULL also wins the race
    // against a concurrent reveal (the sweep can't be clobbered).
    const [row] = await this.db
      .update(reviews)
      .set({ ...patch, updatedAt: new Date() })
      .where(
        and(
          eq(reviews.id, id),
          eq(reviews.authorUserId, authorUserId),
          isNull(reviews.publishedAt),
        ),
      )
      .returning(reviewColumns)
    return row ? toReview(row) : undefined
  }

  async publishMany(ids: string[], publishedAt: Date): Promise<number> {
    if (ids.length === 0) return 0
    // isNull(publishedAt) makes this first-write-wins: a re-run (lazy read after the
    // sweep already published) updates zero rows and never re-stamps an earlier reveal.
    const rows = await this.db
      .update(reviews)
      .set({ publishedAt, updatedAt: new Date() })
      .where(and(inArray(reviews.id, ids), isNull(reviews.publishedAt)))
      .returning({ id: reviews.id })
    return rows.length
  }

  async findRevealDue(now: Date, limit: number): Promise<Review[]> {
    const rows = await this.db
      .select(reviewColumns)
      .from(reviews)
      .where(and(isNull(reviews.publishedAt), lte(reviews.revealDeadlineAt, now)))
      .orderBy(asc(reviews.revealDeadlineAt))
      .limit(limit)
    return rows.map(toReview)
  }
}
