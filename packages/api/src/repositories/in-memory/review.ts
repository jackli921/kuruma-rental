import type { ReviewModerationStatus } from '@kuruma/shared/enums'
import {
  PG_ERROR,
  REVIEWS_SUBJECT_CONSTRAINT,
  REVIEW_REPORT_UNIQUE_CONSTRAINT,
} from '../../pg-errors'
import type { Review, ReviewReport } from '../../stores'
import type {
  ListReportedOptions,
  NewReview,
  NewReviewReport,
  ReportedReviewPage,
  ReviewEdit,
  ReviewRepository,
} from '../types'

// Mirror postgres-js's PostgresError: the violated constraint is exposed as
// `constraint_name` (what pgConstraintName reads). Faithful mirroring lets the
// submission service's resubmit-vs-insert branch behave identically here and on
// Drizzle (mirrors in-memory/payment-event.ts).
function uniqueViolation(
  constraintName: string,
): Error & { code: string; constraint_name: string } {
  return Object.assign(new Error(`duplicate key violates unique constraint "${constraintName}"`), {
    code: PG_ERROR.UNIQUE_VIOLATION,
    constraint_name: constraintName,
  })
}

export class InMemoryReviewRepository implements ReviewRepository {
  private readonly store: Map<string, Review>
  private readonly reports: Map<string, ReviewReport>

  constructor(store?: Map<string, Review>, reports?: Map<string, ReviewReport>) {
    this.store = store ?? new Map()
    this.reports = reports ?? new Map()
  }

  async insert(data: NewReview): Promise<Review> {
    // One review per (booking, subject) — mirrors the single DB seal (#1201). subject is
    // CHECK-sealed to the author side, so this traps a renter's same-subject resubmit AND a
    // 2nd operator->renter by a colleague of the same operator, without depending on operatorId.
    const clash = [...this.store.values()].some(
      (r) => r.bookingId === data.bookingId && r.subject === data.subject,
    )
    if (clash) throw uniqueViolation(REVIEWS_SUBJECT_CONSTRAINT)
    const now = new Date()
    const review: Review = { ...data, id: crypto.randomUUID(), createdAt: now, updatedAt: now }
    this.store.set(review.id, review)
    return review
  }

  async findById(id: string): Promise<Review | undefined> {
    return this.store.get(id)
  }

  async findByBookingId(bookingId: string): Promise<Review[]> {
    return [...this.store.values()].filter((r) => r.bookingId === bookingId)
  }

  async update(id: string, authorUserId: string, patch: ReviewEdit): Promise<Review | undefined> {
    const existing = this.store.get(id)
    // Mirror the Drizzle WHERE: only the author's own, still-hidden row is editable.
    // Any other case (absent / published / not the caller's) matches nothing here too.
    if (!existing || existing.authorUserId !== authorUserId || existing.publishedAt) {
      return undefined
    }
    const updated: Review = { ...existing, ...patch, updatedAt: new Date() }
    this.store.set(id, updated)
    return updated
  }

  async publishMany(ids: string[], publishedAt: Date): Promise<number> {
    const idSet = new Set(ids)
    let published = 0
    for (const review of this.store.values()) {
      // First-write-wins: only flip rows still hidden, so a re-run never re-stamps.
      if (idSet.has(review.id) && review.publishedAt === null) {
        this.store.set(review.id, { ...review, publishedAt, updatedAt: new Date() })
        published += 1
      }
    }
    return published
  }

  async findRevealDue(now: Date, limit: number): Promise<Review[]> {
    return [...this.store.values()]
      .filter((r) => r.publishedAt === null && r.revealDeadlineAt.getTime() <= now.getTime())
      .sort((a, b) => a.revealDeadlineAt.getTime() - b.revealDeadlineAt.getTime())
      .slice(0, limit)
  }

  async aggregateByOperator(operatorIds: readonly string[]) {
    // Filter to subject='OPERATOR' — the operatorId column is denormalized on
    // EVERY row (it's the booking's operator), so a renter's VEHICLE review or
    // an operator's RENTER review would pollute the operator's public rating
    // without this guard. Vehicle/class paths don't need a mirror filter: their
    // key columns (subjectVehicleId/subjectClassId) are null on non-VEHICLE rows
    // and the `key === null` drop already excludes them.
    return this.aggregate(operatorIds, (r) => (r.subject === 'OPERATOR' ? r.operatorId : null))
  }

  async aggregateByVehicle(vehicleIds: readonly string[]) {
    return this.aggregate(vehicleIds, (r) => r.subjectVehicleId)
  }

  async aggregateByClass(classIds: readonly string[]) {
    return this.aggregate(classIds, (r) => r.subjectClassId)
  }

  async insertReport(data: NewReviewReport): Promise<ReviewReport> {
    // Mirror the DB unique (reviewId, reporterUserId): a second report by the same user
    // trips the same constraint name the service branches on (ALREADY_REPORTED).
    const clash = [...this.reports.values()].some(
      (r) => r.reviewId === data.reviewId && r.reporterUserId === data.reporterUserId,
    )
    if (clash) throw uniqueViolation(REVIEW_REPORT_UNIQUE_CONSTRAINT)
    const report: ReviewReport = { ...data, id: crypto.randomUUID(), createdAt: new Date() }
    this.reports.set(report.id, report)
    return report
  }

  async setModerationStatus(
    id: string,
    status: ReviewModerationStatus,
    moderatedBy: string,
    moderatedAt: Date,
  ): Promise<Review | undefined> {
    const existing = this.store.get(id)
    if (!existing) return undefined
    // Mirror the Drizzle write: flip status AND stamp the moderation audit (#1454).
    const updated: Review = {
      ...existing,
      moderationStatus: status,
      moderatedBy,
      moderatedAt,
      updatedAt: new Date(),
    }
    this.store.set(id, updated)
    return updated
  }

  async listReported(options: ListReportedOptions): Promise<ReportedReviewPage> {
    const { limit, status, cursor } = options
    // Group reports by review; emit each still-present review WHOSE moderationStatus matches
    // the requested partition (#1451: VISIBLE = unactioned queue, HIDDEN = resolved) with
    // its distinct-reporter count (the unique seal makes report count === reporter count) +
    // reasons, newest report first. Orphan reports (review gone) are skipped — cascade latent.
    const byReview = new Map<string, ReviewReport[]>()
    for (const report of this.reports.values()) {
      byReview.set(report.reviewId, [...(byReview.get(report.reviewId) ?? []), report])
    }
    const entries = [...byReview.entries()].flatMap(([reviewId, reports]) => {
      const review = this.store.get(reviewId)
      if (!review || review.moderationStatus !== status) return []
      const newestFirst = [...reports].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      const lastReportedAt = newestFirst[0]?.createdAt ?? new Date(0)
      return [
        {
          review,
          reportCount: reports.length,
          reasons: newestFirst.map((r) => r.reason),
          lastReportedAt,
        },
      ]
    })
    // (lastReportedAt DESC, reviewId DESC) — mirrors the Drizzle orderBy so the keyset
    // boundary is byte-identical across drivers (the reveal sweep and same-ms reports make
    // the id tiebreak necessary for a stable page boundary).
    entries.sort((a, b) => {
      const byDate = b.lastReportedAt.getTime() - a.lastReportedAt.getTime()
      if (byDate !== 0) return byDate
      return a.review.id < b.review.id ? 1 : a.review.id > b.review.id ? -1 : 0
    })
    const afterCursor = cursor
      ? entries.filter((e) => {
          const boundary = cursor.lastReportedAt.getTime()
          const t = e.lastReportedAt.getTime()
          return t < boundary || (t === boundary && e.review.id < cursor.reviewId)
        })
      : entries
    // Peek one past the page so `nextCursor` is precise (null exactly when exhausted),
    // mirroring the Drizzle limit+1.
    const slice = afterCursor.slice(0, limit + 1)
    const hasMore = slice.length > limit
    const page = slice.slice(0, limit)
    const last = page[page.length - 1]
    const nextCursor =
      hasMore && last ? { lastReportedAt: last.lastReportedAt, reviewId: last.review.id } : null
    return {
      items: page.map(({ review, reportCount, reasons }) => ({ review, reportCount, reasons })),
      nextCursor,
    }
  }

  async listPublishedForSubject(
    subject: 'OPERATOR' | 'VEHICLE',
    subjectId: string,
    limit: number,
  ): Promise<Review[]> {
    const keyOf = (r: Review) => (subject === 'OPERATOR' ? r.operatorId : r.subjectVehicleId)
    return [...this.store.values()]
      .filter(
        (r): r is Review & { publishedAt: Date } =>
          r.subject === subject &&
          r.publishedAt !== null &&
          r.moderationStatus === 'VISIBLE' &&
          keyOf(r) === subjectId,
      )
      .sort((a, b) => {
        // Newest-first, with an id tiebreak: the reveal sweep stamps a whole batch with
        // ONE identical publishedAt, so date alone is an unstable order (and the keyset
        // pagination follow-up needs a unique tiebreak anyway). Mirror the Drizzle
        // orderBy(desc(publishedAt), desc(id)).
        const byDate = b.publishedAt.getTime() - a.publishedAt.getTime()
        return byDate !== 0 ? byDate : a.id < b.id ? 1 : a.id > b.id ? -1 : 0
      })
      .slice(0, limit)
  }

  // Shared predicate (#1085): only published+visible reviews enter aggregates, so a
  // hidden or still-double-blind row never skews a public storefront rating.
  // Ids that match no published+visible row stay absent from the result Map.
  private aggregate(
    ids: readonly string[],
    keyOf: (r: Review) => string | null,
  ): Map<string, { sum: number; count: number }> {
    const out = new Map<string, { sum: number; count: number }>()
    if (ids.length === 0) return out
    const idSet = new Set(ids)
    for (const r of this.store.values()) {
      if (r.publishedAt === null) continue
      if (r.moderationStatus !== 'VISIBLE') continue
      const key = keyOf(r)
      if (key === null || !idSet.has(key)) continue
      const prev = out.get(key) ?? { sum: 0, count: 0 }
      out.set(key, { sum: prev.sum + r.overall, count: prev.count + 1 })
    }
    return out
  }
}
