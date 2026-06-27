import {
  PG_ERROR,
  REVIEWS_AUTHOR_SUBJECT_CONSTRAINT,
  REVIEWS_OPERATOR_SUBJECT_CONSTRAINT,
} from '../../pg-errors'
import type { Review } from '../../stores'
import type { NewReview, ReviewEdit, ReviewRepository } from '../types'

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

  constructor(store?: Map<string, Review>) {
    this.store = store ?? new Map()
  }

  async insert(data: NewReview): Promise<Review> {
    // The one-per-author-per-subject seal: a renter still reviews OPERATOR and
    // VEHICLE separately, but never the same (booking, author, subject) twice.
    const rows = [...this.store.values()]
    const authorClash = rows.some(
      (r) =>
        r.bookingId === data.bookingId &&
        r.authorUserId === data.authorUserId &&
        r.subject === data.subject,
    )
    if (authorClash) throw uniqueViolation(REVIEWS_AUTHOR_SUBJECT_CONSTRAINT)
    // The one-per-OPERATOR seal (#1158): mirrors the partial unique index on
    // (booking, operator, subject) WHERE authorRole='OPERATOR'. A colleague of the same
    // operator (a different authorUserId, so the author seal above lets it through) must
    // not be able to add a second operator->renter review for one booking.
    const operatorClash =
      data.authorRole === 'OPERATOR' &&
      rows.some(
        (r) =>
          r.authorRole === 'OPERATOR' &&
          r.bookingId === data.bookingId &&
          r.operatorId === data.operatorId &&
          r.subject === data.subject,
      )
    if (operatorClash) throw uniqueViolation(REVIEWS_OPERATOR_SUBJECT_CONSTRAINT)
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
    return this.aggregate(operatorIds, (r) => r.operatorId)
  }

  async aggregateByVehicle(vehicleIds: readonly string[]) {
    return this.aggregate(vehicleIds, (r) => r.subjectVehicleId)
  }

  async aggregateByClass(classIds: readonly string[]) {
    return this.aggregate(classIds, (r) => r.subjectClassId)
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
