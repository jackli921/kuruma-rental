import { PG_ERROR, REVIEWS_AUTHOR_SUBJECT_CONSTRAINT } from '../../pg-errors'
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
    const clash = [...this.store.values()].some(
      (r) =>
        r.bookingId === data.bookingId &&
        r.authorUserId === data.authorUserId &&
        r.subject === data.subject,
    )
    if (clash) throw uniqueViolation(REVIEWS_AUTHOR_SUBJECT_CONSTRAINT)
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
}
