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
  ListReportedOptions,
  NewReview,
  NewReviewReport,
  ReportedReviewPage,
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
    moderatedBy: string,
    moderatedAt: Date,
  ): Promise<Review | undefined> {
    const [row] = await this.db
      .update(reviews)
      .set({ moderationStatus: status, moderatedBy, moderatedAt, updatedAt: new Date() })
      .where(eq(reviews.id, id))
      .returning(reviewColumns)
    return row ? toReview(row) : undefined
  }

  async listReported(options: ListReportedOptions): Promise<ReportedReviewPage> {
    const { limit, status, cursor } = options
    // One aggregate pass over review_reports (count + reasons + recency per review), joined
    // to reviews so we can (a) partition by moderationStatus — the queue defaults to
    // unactioned (VISIBLE) and never accumulates HIDDEN rows (#1451) — and (b) keyset-
    // paginate on (lastReportedAt DESC, reviewId DESC). reportCount === distinct reporters
    // (the one-per-reporter unique seal), so the join to reviews doesn't fan out the count.
    // Sort key, truncated to MILLISECONDS so the DB-side precision equals the cursor's:
    // review_reports.createdAt is defaultNow() (MICROSECONDS), but the cursor round-trips
    // through Date.toISOString() (ms). Comparing a µs aggregate against an ms cursor silently
    // drops a same-ms/different-µs neighbour on the far side of a page boundary — a reported
    // review the moderator never sees, so it is never hidden and keeps counting in the public
    // aggregate. Truncating both sides to ms makes the boundary exact — the lossless round-trip
    // #1449 gets for free from its JS-Date-written publishedAt. (InMemory can't catch the gap:
    // its reports stamp ms JS Dates, so it is already lossless.)
    // `.mapWith` reattaches the createdAt column's date decoder that the raw `date_trunc`
    // wrapper drops, so the SELECT still returns a JS Date for the cursor (not a raw string).
    const lastReportedAt = sql`date_trunc('milliseconds', ${max(reviewReports.createdAt)})`.mapWith(
      reviewReports.createdAt,
    )
    // Keyset in HAVING (the sort key is an aggregate): strictly past the previous page's
    // (lastReportedAt, reviewId) boundary in the DESC ordering. The boundary instant is bound
    // as an explicitly-cast timestamptz STRING (ms), never a raw Date: the left side is an
    // aggregate expression, not a Column, so drizzle has no column mapper to encode a Date
    // param here — postgres-js rejects the raw Date ("must be of type string"), and neon-http
    // would lean on undocumented Date coercion. `${iso}::timestamptz` binds a string both
    // drivers serialize identically, and now matches the ms-truncated left side. The reviewId
    // tiebreak compares under COLLATE "C" so its byte order matches the InMemory JS `<` (mirrors
    // #1449) — load-bearing here because the ms truncation deliberately increases exact ties.
    const cursorTs = cursor
      ? sql`${cursor.lastReportedAt.toISOString()}::timestamptz`
      : undefined
    const keyset =
      cursor && cursorTs
        ? or(
            lt(lastReportedAt, cursorTs),
            and(
              eq(lastReportedAt, cursorTs),
              sql`${reviewReports.reviewId} COLLATE "C" < ${cursor.reviewId}`,
            ),
          )
        : undefined
    const grouped = await this.db
      .select({
        reviewId: reviewReports.reviewId,
        reportCount: count(),
        reasons: sql<
          string[]
        >`array_agg(${reviewReports.reason} order by ${reviewReports.createdAt} desc)`,
        lastReportedAt,
      })
      .from(reviewReports)
      .innerJoin(reviews, eq(reviews.id, reviewReports.reviewId))
      .where(eq(reviews.moderationStatus, status))
      .groupBy(reviewReports.reviewId)
      .having(keyset)
      .orderBy(desc(lastReportedAt), sql`${reviewReports.reviewId} COLLATE "C" DESC`)
      // Peek one past the page so `nextCursor` is precise (null exactly when exhausted),
      // never handing back a cursor that resolves to an empty page.
      .limit(limit + 1)
    if (grouped.length === 0) return { items: [], nextCursor: null }
    const hasMore = grouped.length > limit
    const pageGroups = grouped.slice(0, limit)
    const rows = await this.db
      .select(reviewColumns)
      .from(reviews)
      .where(
        inArray(
          reviews.id,
          pageGroups.map((g) => g.reviewId),
        ),
      )
    const reviewsById = new Map(rows.map((r) => [r.id, toReview(r)]))
    // Skip an orphan report whose review was hard-deleted (cascade makes this latent).
    const items = pageGroups.flatMap((g) => {
      const review = reviewsById.get(g.reviewId)
      return review ? [{ review, reportCount: Number(g.reportCount), reasons: g.reasons }] : []
    })
    // The boundary is the last GROUPED row on the page (pagination follows the grouped
    // order, even if an orphan trimmed it from `items`).
    const last = pageGroups[pageGroups.length - 1]
    const nextCursor =
      hasMore && last?.lastReportedAt
        ? { lastReportedAt: last.lastReportedAt, reviewId: last.reviewId }
        : null
    return { items, nextCursor }
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
