import { reviewReports, reviews } from '@kuruma/shared/db/schema'
import { inArray } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { DrizzleReviewRepository } from '../../src/repositories/drizzle/review'
import { type SeededBooking, createSeededBooking, seedRenter } from './booking-factory'
import { cleanupUsers, db } from './setup'

// #1451 / #1454: pin the moderation-queue read + audit write on real Postgres. The
// InMemory mirror proves the pagination logic; this proves the Drizzle lowering renders
// the SAME semantics against a live schema. The one surface only real pg can validate:
// `listReported`'s keyset lives in a HAVING over max(review_reports.createdAt) — an
// aggregate the query planner treats differently from a WHERE — plus the innerJoin
// status partition, the array_agg reason ordering, and the limit+1 peek → nextCursor.
// And that migration 0101 actually created reviews.moderatedBy / moderatedAt (a bad
// migration would 500 with "column does not exist"; setModerationStatus round-trips them).
//
// Parallel-safety: `listReported` is a PLATFORM-wide query (no operator scope). Two
// facts keep the assertions deterministic under concurrent files:
//   - The HIDDEN partition is populated only by a file that BOTH hides AND reports a
//     review; this is the only such file, so the HIDDEN queue is exactly our rows —
//     letting us assert the full page + a precise null cursor.
//   - The VISIBLE partition is shared (review-constraints.test.ts reports VISIBLE rows),
//     so those cases id-scope their assertions and date reports far in the future so our
//     rows sort to the top of the newest-first order regardless of what else is present.

const repo = new DrizzleReviewRepository(db)

// One FK-valid booking per queue row (the (bookingId, subject) reseal admits a single
// OPERATOR review per booking), pooled and reused: afterEach clears the reviews (their
// reports cascade), the bookings survive, so we pay the heavy booking seed once.
let pool: [SeededBooking, SeededBooking, SeededBooking, SeededBooking]
let reporterA: string
let reporterB: string
let admin: string

beforeAll(async () => {
  pool = await Promise.all([
    createSeededBooking({ prefix: 'mq-1' }),
    createSeededBooking({ prefix: 'mq-2' }),
    createSeededBooking({ prefix: 'mq-3' }),
    createSeededBooking({ prefix: 'mq-4' }),
  ])
  reporterA = await seedRenter('mq-reporter-a')
  reporterB = await seedRenter('mq-reporter-b')
  admin = await seedRenter('mq-admin')
})

const poolBookingIds = (): string[] => pool.map((p) => p.booking.id)

afterEach(async () => {
  // review_reports is ON DELETE cascade, so deleting the reviews clears their reports.
  await db.delete(reviews).where(inArray(reviews.bookingId, poolBookingIds()))
})

afterAll(async () => {
  await db.delete(reviews).where(inArray(reviews.bookingId, poolBookingIds()))
  await Promise.all(pool.map((p) => p.cleanup()))
  // Safe only after every review (and its cascading report) is gone: review_reports
  // and reviews.moderatedBy both restrict-reference these users.
  await cleanupUsers([reporterA, reporterB, admin])
})

const FAR_FUTURE_DEADLINE = new Date('2099-01-21T09:00:00Z')

/** Insert one OPERATOR review on a pooled booking; returns its id. */
function insertReview(
  booking: SeededBooking,
  opts: { id?: string; moderationStatus?: 'VISIBLE' | 'HIDDEN' } = {},
): Promise<string> {
  const id = opts.id ?? crypto.randomUUID()
  return db
    .insert(reviews)
    .values({
      id,
      bookingId: booking.booking.id,
      operatorId: booking.operatorId,
      authorUserId: booking.renterId,
      authorRole: 'RENTER',
      subject: 'OPERATOR',
      overall: 4,
      moderationStatus: opts.moderationStatus ?? 'VISIBLE',
      revealDeadlineAt: FAR_FUTURE_DEADLINE,
    })
    .then(() => id)
}

/** File a report with an explicit createdAt (the queue's sort key is max(createdAt)). */
function report(
  reviewId: string,
  reporterUserId: string,
  createdAt: Date,
  reason: string,
): Promise<unknown> {
  return db
    .insert(reviewReports)
    .values({ id: crypto.randomUUID(), reviewId, reporterUserId, reason, createdAt })
}

describe('DrizzleReviewRepository.listReported (#1451, real pg)', () => {
  it('orders by latest report, counts distinct reporters, and aggregates reasons newest-first', async () => {
    const [b0, b1, b2] = pool
    const h1 = await insertReview(b0, { moderationStatus: 'HIDDEN' })
    const h2 = await insertReview(b1, { moderationStatus: 'HIDDEN' })
    const h3 = await insertReview(b2, { moderationStatus: 'HIDDEN' })
    // h1: two DISTINCT reporters; its latest report is the newest in the queue, so it
    // sorts first, and its reasons come back ordered by report recency (newest first).
    await report(h1, reporterA, new Date('2099-03-03T00:00:00Z'), 'spam')
    await report(h1, reporterB, new Date('2099-03-03T00:01:00Z'), 'offensive')
    await report(h2, reporterA, new Date('2099-03-02T00:00:00Z'), 'harassment')
    await report(h3, reporterA, new Date('2099-03-01T00:00:00Z'), 'other')

    const page = await repo.listReported({ limit: 20, status: 'HIDDEN' })

    // Isolated partition: the page IS exactly our three rows, newest-reported first.
    expect(page.items.map((i) => i.review.id)).toEqual([h1, h2, h3])
    expect(page.nextCursor).toBeNull()
    expect(page.items[0]?.reportCount).toBe(2)
    expect(page.items[0]?.reasons).toEqual(['offensive', 'spam'])
    expect(page.items[1]?.reportCount).toBe(1)
  })

  it('keyset-paginates newest-first with a (report recency, review id) tiebreak', async () => {
    const [b0, b1, b2, b3] = pool
    const uniq = crypto.randomUUID()
    // Controlled ids so the same-instant tiebreak is deterministic: identical prefix,
    // differing only in the trailing rank char ('2' < '3' under every collation).
    const rHi = await insertReview(b0, { id: `mq-${uniq}-hi`, moderationStatus: 'HIDDEN' })
    const rMid3 = await insertReview(b1, { id: `mq-${uniq}-3`, moderationStatus: 'HIDDEN' })
    const rMid2 = await insertReview(b2, { id: `mq-${uniq}-2`, moderationStatus: 'HIDDEN' })
    const rLo = await insertReview(b3, { id: `mq-${uniq}-lo`, moderationStatus: 'HIDDEN' })
    const MID = new Date('2099-05-02T00:00:00Z')
    await report(rHi, reporterA, new Date('2099-05-03T00:00:00Z'), 'spam')
    await report(rMid3, reporterA, MID, 'spam') // tie with rMid2, larger id -> comes first
    await report(rMid2, reporterA, MID, 'spam') // tie with rMid3, smaller id -> comes after
    await report(rLo, reporterA, new Date('2099-05-01T00:00:00Z'), 'spam')

    const page1 = await repo.listReported({ limit: 2, status: 'HIDDEN' })
    expect(page1.items.map((i) => i.review.id)).toEqual([rHi, rMid3])
    // The peek past the page yields a precise cursor pointing at the page's last row.
    expect(page1.nextCursor?.reviewId).toBe(rMid3)
    expect(page1.nextCursor?.lastReportedAt.getTime()).toBe(MID.getTime())

    const page2 = await repo.listReported({
      limit: 2,
      status: 'HIDDEN',
      cursor: page1.nextCursor ?? undefined,
    })
    // rMid2 (same instant, smaller id) resumes strictly past the cursor, then rLo (older).
    expect(page2.items.map((i) => i.review.id)).toEqual([rMid2, rLo])
    expect(page2.nextCursor).toBeNull()
  })

  it('partitions the queue by moderationStatus (VISIBLE vs HIDDEN)', async () => {
    const [b0, b1] = pool
    const visible = await insertReview(b0, { moderationStatus: 'VISIBLE' })
    const hidden = await insertReview(b1, { moderationStatus: 'HIDDEN' })
    // Far-future reports sort our rows to the top of each newest-first partition.
    await report(visible, reporterA, new Date('2099-07-01T00:00:00Z'), 'spam')
    await report(hidden, reporterA, new Date('2099-07-01T00:00:00Z'), 'spam')

    const mine = new Set([visible, hidden])
    // The VISIBLE partition is shared with other files; scope to our two rows. The
    // innerJoin + moderationStatus filter must surface the visible row, never the hidden.
    const visiblePage = await repo.listReported({ limit: 50, status: 'VISIBLE' })
    expect(visiblePage.items.map((i) => i.review.id).filter((id) => mine.has(id))).toEqual([
      visible,
    ])

    const hiddenPage = await repo.listReported({ limit: 50, status: 'HIDDEN' })
    expect(hiddenPage.items.map((i) => i.review.id).filter((id) => mine.has(id))).toEqual([hidden])
  })
})

describe('DrizzleReviewRepository.setModerationStatus (#1454, real pg)', () => {
  it('stamps the moderation audit trail (moderatedBy + moderatedAt) and persists it', async () => {
    const [b0] = pool
    const id = await insertReview(b0, { moderationStatus: 'VISIBLE' })
    const moderatedAt = new Date('2099-08-15T12:34:56.000Z')

    const updated = await repo.setModerationStatus(id, 'HIDDEN', admin, moderatedAt)
    expect(updated?.moderationStatus).toBe('HIDDEN')
    expect(updated?.moderatedBy).toBe(admin)
    expect(updated?.moderatedAt?.getTime()).toBe(moderatedAt.getTime())

    // Re-read proves migration 0101's columns actually persisted the write, not just
    // echoed it from the same statement's RETURNING.
    const reread = await repo.findById(id)
    expect(reread?.moderatedBy).toBe(admin)
    expect(reread?.moderatedAt?.getTime()).toBe(moderatedAt.getTime())
  })
})
