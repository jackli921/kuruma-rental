import { reviews } from '@kuruma/shared/db/schema'
import { eq } from 'drizzle-orm'
import type { Review } from '../../stores'
import type { NewReview, ReviewRepository } from '../types'
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

  async findByBookingId(bookingId: string): Promise<Review[]> {
    const rows = await this.db
      .select(reviewColumns)
      .from(reviews)
      .where(eq(reviews.bookingId, bookingId))
    return rows.map(toReview)
  }
}
