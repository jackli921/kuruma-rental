import type { ReviewModerationStatus } from '@kuruma/shared/enums'
import { reviewReports, reviews } from '@kuruma/shared/db/schema'
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  max,
  or,
  sql,
  sum,
} from 'drizzle-orm'
import type { PgColumn } from 'drizzle-orm/pg-core'
import type { Review, ReviewReport } from '../../stores'
import type {
  NewReview,
  NewReviewReport,
  ReportedReview,
  ReviewEdit,
  ReviewListCursor,
  ReviewRepository,
} from '../types'
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

  async aggregateByOperator(operatorIds: readonly string[]) {
    // `operatorId` is denormalized onto EVERY review (the booking's operator),
    // so without `subject='OPERATOR'` a VEHICLE review (or an operator→RENTER
    // review) would pollute the public storefront operator rating. The vehicle
    // and class paths are inherently scoped — their key columns are null on
    // non-VEHICLE rows and the planner drops them via `inArray` + `groupBy`.
    return this.aggregate(operatorIds, reviews.operatorId, eq(reviews.subject, 'OPERATOR'))
  }

  async aggregateByVehicle(vehicleIds: readonly string[]) {
    return this.aggregate(vehicleIds, reviews.subjectVehicleId)
  }

  async aggregateByClass(classIds: readonly string[]) {
    return this.aggregate(classIds, reviews.subjectClassId)
  }

  async insertReport(data: NewReviewReport): Promise<ReviewReport> {
    // The DB unique (reviewId, reporterUserId) bubbles up as a PostgresError whose
    // constraint_name the service reads (ALREADY_REPORTED) — deliberately not swallowed.
    const [row] = await this.db.insert(reviewReports).values(data).returning()
    if (!row) throw new Error('review_reports insert returned no row')
    return row
  }

  async setModerationStatus(
    id: string,
    status: ReviewModerationStatus,
  ): Promise<Review | undefined> {
    const [row] = await this.db
      .update(reviews)
      .set({ moderationStatus: status, updatedAt: new Date() })
      .where(eq(reviews.id, id))
      .returning(reviewColumns)
    return row ? toReview(row) : undefined
  }

  async listReported(): Promise<ReportedReview[]> {
    // One aggregate pass over review_reports (count + reasons + latest per review), newest
    // reported first, then hydrate the reviews. reportCount === distinct reporters (unique seal).
    const grouped = await this.db
      .select({
        reviewId: reviewReports.reviewId,
        reportCount: count(),
        reasons: sql<
          string[]
        >`array_agg(${reviewReports.reason} order by ${reviewReports.createdAt} desc)`,
        lastReportedAt: max(reviewReports.createdAt),
      })
      .from(reviewReports)
      .groupBy(reviewReports.reviewId)
      .orderBy(desc(max(reviewReports.createdAt)))
    if (grouped.length === 0) return []
    const rows = await this.db
      .select(reviewColumns)
      .from(reviews)
      .where(
        inArray(
          reviews.id,
          grouped.map((g) => g.reviewId),
        ),
      )
    const reviewsById = new Map(rows.map((r) => [r.id, toReview(r)]))
    // Skip an orphan report whose review was hard-deleted (cascade makes this latent).
    return grouped.flatMap((g) => {
      const review = reviewsById.get(g.reviewId)
      return review ? [{ review, reportCount: Number(g.reportCount), reasons: g.reasons }] : []
    })
  }

  // Public review-list read (review-display slice, #1067).
  // subject='OPERATOR' keys on the denormalized operatorId (idx_reviews_operator_published
  // covers filter+order); 'VEHICLE' keys on subjectVehicleId.
  async listPublishedForSubject(
    subject: 'OPERATOR' | 'VEHICLE',
    subjectId: string,
    limit: number,
    after?: ReviewListCursor,
  ): Promise<Review[]> {
    const key = subject === 'OPERATOR' ? reviews.operatorId : reviews.subjectVehicleId
    // Keyset cursor (#1449): rows strictly older than `after` in the list's
    // (publishedAt desc, id desc) order. The id half compares under `COLLATE "C"` — byte
    // order, matching InMemory's JS `<` for ASCII uuids — so a same-publishedAt batch
    // pages identically in the in-memory tests and in prod, whatever the DB's default
    // collation. Consistent with the orderBy below by construction.
    const keyset = after
      ? or(
          lt(reviews.publishedAt, after.publishedAt),
          and(
            eq(reviews.publishedAt, after.publishedAt),
            sql`${reviews.id} COLLATE "C" < ${after.id}`,
          ),
        )
      : undefined
    const rows = await this.db
      .select(reviewColumns)
      .from(reviews)
      .where(
        and(
          eq(reviews.subject, subject),
          eq(key, subjectId),
          isNotNull(reviews.publishedAt),
          eq(reviews.moderationStatus, 'VISIBLE'),
          keyset,
        ),
      )
      // desc(id COLLATE "C") tiebreak: the reveal sweep stamps a batch with one identical
      // publishedAt, so date alone is an unstable order. Byte order matches the InMemory
      // sort (JS `<`) so tests and prod agree on the page boundary.
      .orderBy(desc(reviews.publishedAt), sql`${reviews.id} COLLATE "C" DESC`)
      .limit(limit)
    return rows.map(toReview)
  }

  // Shared aggregate scan (#1085): SUM(overall) + COUNT(*) per key over published+visible
  // reviews whose key falls in `ids`. Ids with no matching rows stay absent from the Map
  // — the service distinguishes "no reviews yet" from "rated zero" at the call site.
  // The operator scan uses idx_reviews_operator_published; vehicle and class use the
  // partial cover indexes idx_reviews_subject_{vehicle,class}_published (#1220), which
  // carry `overall` as a trailing key column so this aggregate is an Index Only Scan.
  private async aggregate(
    ids: readonly string[],
    key: PgColumn,
    extraWhere?: ReturnType<typeof eq>,
  ): Promise<Map<string, { sum: number; count: number }>> {
    const out = new Map<string, { sum: number; count: number }>()
    if (ids.length === 0) return out
    const rows = await this.db
      .select({ key, sum: sum(reviews.overall), count: count() })
      .from(reviews)
      .where(
        and(
          inArray(key, ids as string[]),
          isNotNull(reviews.publishedAt),
          eq(reviews.moderationStatus, 'VISIBLE'),
          extraWhere,
        ),
      )
      .groupBy(key)
    for (const row of rows) {
      const k = row.key as string | null
      if (k === null) continue
      // sum() returns string | null in drizzle (numeric is bigint-safe); Number() is
      // safe at our scale (overall is 1-5, rows in a single aggregate window <<= 2^53).
      out.set(k, { sum: Number(row.sum ?? 0), count: Number(row.count) })
    }
    return out
  }
}
