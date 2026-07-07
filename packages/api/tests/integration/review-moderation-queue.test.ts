import { reviewReports, reviews } from '@kuruma/shared/db/schema'
import { inArray, sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { DrizzleReviewRepository } from '../../src/repositories/drizzle/review'
import type { ReportedQueueCursor } from '../../src/repositories/types-review'
import { type SeededBooking, createSeededBooking, seedRenter } from './booking-factory'
import { cleanupUsers, db } from './setup'

// #1451 / #1454 real-pg gate for the review moderation surface. The InMemory mirror proves
// the pagination + audit logic; this proves the Drizzle lowering renders the SAME semantics
// against a live schema — the surfaces neither the mirror nor tsc can exercise:
//   - listReported's keyset lives in a HAVING over `max(review_reports.createdAt)` INNER
//     JOINed to `reviews` for the status partition (#1451). Under the real driver this pins
//     (lastReportedAt DESC, reviewId DESC) ordering with reportCount = distinct reporters and
//     reasons newest-report-first, the VISIBLE/HIDDEN partition, the limit+1 peek producing a
//     precise cursor (no dup / no gap across a page boundary), and the same-instant reviewId
//     tiebreak with the cursor `lt` boundary. The keyset binds its boundary instant as an
//     explicitly-cast timestamptz string, which only a real driver validates (a raw Date
//     throws under postgres-js) — see DrizzleReviewRepository.listReported.
//   - setModerationStatus stamps reviews.moderatedBy / moderatedAt (#1454). This proves
//     migration 0101 actually created those columns (a bad migration would 500 with "column
//     does not exist") and that the audit write round-trips through the real column types.
//
// Collation note: the reviewId tiebreak is compared without an explicit COLLATE, yet stays
// stable across C and en_US.utf8 because every reviewId is a fixed-format lowercase UUID —
// hyphens sit at identical positions, so the first differing character is always hex-vs-hex,
// which both collations order identically. (A non-UUID id format would break that; the tie
// case below uses canonical UUIDs deliberately.)
//
// listReported scans EVERY reported review of the requested status (it is NOT operator-
// scoped), and integration files run in parallel, so foreign rows may interleave. Two
// defenses keep the assertions deterministic: (a) this file stamps its reports far in the
// future (2099) so its rows lead the DESC queue ahead of any concurrent ~2026 row, and
// (b) assertions filter the result down to this file's own review ids.

const repo = new DrizzleReviewRepository(db)

let b0: SeededBooking
let b1: SeededBooking
let b2: SeededBooking
let b3: SeededBooking
let poolBookingIds: string[]
// A second reporter (for the distinct-reporter count) and the acting admin (moderatedBy FK),
// seeded once and cleaned in afterAll so review_reports / reviews.moderatedBy never dangle.
let extraReporter: string
let admin: string

beforeAll(async () => {
  ;[b0, b1, b2, b3] = await Promise.all([
    createSeededBooking({ prefix: 'reported-q-0' }),
    createSeededBooking({ prefix: 'reported-q-1' }),
    createSeededBooking({ prefix: 'reported-q-2' }),
    createSeededBooking({ prefix: 'reported-q-3' }),
  ])
  poolBookingIds = [b0.booking.id, b1.booking.id, b2.booking.id, b3.booking.id]
  extraReporter = await seedRenter('reported-q-extra')
  admin = await seedRenter('reported-q-admin')
})

afterEach(async () => {
  // review_reports cascade-delete with their review (onDelete cascade on reviewId),
  // so clearing the reviews resets the queue between cases.
  await db.delete(reviews).where(inArray(reviews.bookingId, poolBookingIds))
})

afterAll(async () => {
  await db.delete(reviews).where(inArray(reviews.bookingId, poolBookingIds))
  for (const b of [b0, b1, b2, b3]) await b.cleanup()
  // Safe only after every review (+ cascading report) is gone: review_reports.reporterUserId
  // and reviews.moderatedBy both restrict-reference these users.
  await cleanupUsers([extraReporter, admin])
})

interface ReportSpec {
  reporter: string
  at: Date
  reason?: string
}

/** Insert one OPERATOR review on `booking` plus its reports (report createdAt controls the
 *  queue's sort key). Returns the review id. */
async function seedReportedReview(
  booking: SeededBooking,
  opts: { id?: string; status?: 'VISIBLE' | 'HIDDEN'; reports: ReportSpec[] },
): Promise<string> {
  const id = opts.id ?? crypto.randomUUID()
  await db.insert(reviews).values({
    id,
    bookingId: booking.booking.id,
    operatorId: booking.operatorId,
    authorUserId: booking.renterId,
    authorRole: 'RENTER',
    subject: 'OPERATOR',
    overall: 4,
    moderationStatus: opts.status ?? 'VISIBLE',
    revealDeadlineAt: new Date('2027-01-21T09:00:00Z'),
  })
  for (const r of opts.reports) {
    await db.insert(reviewReports).values({
      id: crypto.randomUUID(),
      reviewId: id,
      reporterUserId: r.reporter,
      reason: r.reason ?? 'inappropriate',
      createdAt: r.at,
    })
  }
  return id
}

/** Seed one VISIBLE OPERATOR review whose single report lands at an explicit sub-millisecond
 *  instant. `createdAtLiteral` is bound as a raw `timestamptz` because JS `Date` is ms-only
 *  and cannot express the microseconds that expose the ms-cursor truncation. */
async function seedReviewReportedAtLiteral(
  booking: SeededBooking,
  id: string,
  createdAtLiteral: string,
): Promise<void> {
  await db.insert(reviews).values({
    id,
    bookingId: booking.booking.id,
    operatorId: booking.operatorId,
    authorUserId: booking.renterId,
    authorRole: 'RENTER',
    subject: 'OPERATOR',
    overall: 4,
    moderationStatus: 'VISIBLE',
    revealDeadlineAt: new Date('2027-01-21T09:00:00Z'),
  })
  await db.insert(reviewReports).values({
    id: crypto.randomUUID(),
    reviewId: id,
    reporterUserId: booking.renterId,
    reason: 'inappropriate',
    createdAt: sql`${createdAtLiteral}::timestamptz`,
  })
}

describe('DrizzleReviewRepository.listReported (#1451, real pg)', () => {
  it('does not drop a reported review whose newest report shares a millisecond but differs in microseconds', async () => {
    // review_reports.createdAt is defaultNow() = MICROSECOND precision, but the queue cursor is
    // serialized to MILLISECONDS (Date.toISOString). Two reviews reported in the same ms but
    // different µs must BOTH survive pagination — the ms cursor must not exclude the sub-ms
    // neighbour on the far side of a page boundary (a dropped row is a reported review the
    // moderator never sees, so it is never hidden and keeps counting in the public aggregate).
    // The InMemory mirror CANNOT catch this: its reports stamp ms JS Dates, so it is lossless.
    const SAME_MS = '2099-07-01 00:00:00.123'
    const idA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    const idB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
    // A's report is later WITHIN the same ms (µs 900) so it leads the raw-µs DESC order; B
    // (µs 100) is the neighbour the buggy ms cursor drops once A's page boundary is passed.
    await seedReviewReportedAtLiteral(b0, idA, `${SAME_MS}900+00`)
    await seedReviewReportedAtLiteral(b1, idB, `${SAME_MS}100+00`)

    // Walk one row per page following the cursor; both must be visited exactly once.
    const collected: string[] = []
    let cursor: ReportedQueueCursor | undefined
    for (let guard = 0; guard < 12 && collected.length < 2; guard++) {
      const page = await repo.listReported({ limit: 1, status: 'VISIBLE', cursor })
      for (const item of page.items) {
        if (item.review.id === idA || item.review.id === idB) collected.push(item.review.id)
      }
      if (!page.nextCursor) break
      cursor = page.nextCursor
    }
    expect([...collected].sort()).toEqual([idA, idB])
  })

  it('orders reports newest-first with distinct-reporter count and reasons', async () => {
    const r0 = await seedReportedReview(b0, {
      reports: [{ reporter: b0.renterId, at: new Date('2099-01-01T00:00:00Z'), reason: 'spam' }],
    })
    // r1 is reported by two DISTINCT reporters -> reportCount 2, reasons newest-first.
    const r1 = await seedReportedReview(b1, {
      reports: [
        { reporter: b1.renterId, at: new Date('2099-01-02T00:00:00Z'), reason: 'offensive' },
        { reporter: extraReporter, at: new Date('2099-02-01T00:00:00Z'), reason: 'harassment' },
      ],
    })
    const r2 = await seedReportedReview(b2, {
      reports: [{ reporter: b2.renterId, at: new Date('2099-03-01T00:00:00Z'), reason: 'spam' }],
    })

    const page = await repo.listReported({ limit: 50, status: 'VISIBLE' })
    const mine = page.items.filter((i) => [r0, r1, r2].includes(i.review.id))

    // lastReportedAt = max(createdAt): r2 (2099-03) > r1 (2099-02) > r0 (2099-01).
    expect(mine.map((i) => i.review.id)).toEqual([r2, r1, r0])
    const r1row = mine.find((i) => i.review.id === r1)
    expect(r1row?.reportCount).toBe(2)
    expect(r1row?.reasons).toEqual(['harassment', 'offensive'])
  })

  it('partitions by moderationStatus: VISIBLE excludes HIDDEN and vice versa', async () => {
    const visible = await seedReportedReview(b0, {
      status: 'VISIBLE',
      reports: [{ reporter: b0.renterId, at: new Date('2099-01-05T00:00:00Z') }],
    })
    const hidden = await seedReportedReview(b1, {
      status: 'HIDDEN',
      reports: [{ reporter: b1.renterId, at: new Date('2099-01-06T00:00:00Z') }],
    })

    const visibleIds = (await repo.listReported({ limit: 50, status: 'VISIBLE' })).items.map(
      (i) => i.review.id,
    )
    expect(visibleIds).toContain(visible)
    expect(visibleIds).not.toContain(hidden)

    const hiddenIds = (await repo.listReported({ limit: 50, status: 'HIDDEN' })).items.map(
      (i) => i.review.id,
    )
    expect(hiddenIds).toContain(hidden)
    expect(hiddenIds).not.toContain(visible)
  })

  it('paginates with a precise cursor: no dup or gap across pages walked at limit=2', async () => {
    // Four rows at strictly-increasing recency; 2099 keeps them ahead of any concurrent
    // ~2026 row so they lead the DESC queue and are collected within the first pages.
    const seeded = [
      await seedReportedReview(b0, {
        reports: [{ reporter: b0.renterId, at: new Date('2099-05-01T00:00:00Z') }],
      }),
      await seedReportedReview(b1, {
        reports: [{ reporter: b1.renterId, at: new Date('2099-05-02T00:00:00Z') }],
      }),
      await seedReportedReview(b2, {
        reports: [{ reporter: b2.renterId, at: new Date('2099-05-03T00:00:00Z') }],
      }),
      await seedReportedReview(b3, {
        reports: [{ reporter: b3.renterId, at: new Date('2099-05-04T00:00:00Z') }],
      }),
    ]
    const mineSet = new Set(seeded)
    const expectedDesc = [...seeded].reverse()

    // Walk pages following nextCursor until every seeded id has been seen. The keyset must
    // visit each exactly once in recency-DESC order — a lte boundary would repeat a row, a
    // gt-only boundary would drop one.
    const collected: string[] = []
    let cursor: ReportedQueueCursor | undefined
    for (let guard = 0; guard < 50 && collected.length < seeded.length; guard++) {
      const listPage = await repo.listReported({ limit: 2, status: 'VISIBLE', cursor })
      for (const item of listPage.items) {
        if (mineSet.has(item.review.id)) collected.push(item.review.id)
      }
      if (!listPage.nextCursor) break
      cursor = listPage.nextCursor
    }

    expect(collected).toEqual(expectedDesc)
  })

  it('breaks a same-instant report tie by reviewId DESC and the cursor excludes the boundary', async () => {
    const TIE = new Date('2099-06-01T00:00:00.000Z')
    const idLo = '11111111-1111-1111-1111-111111111111'
    const idHi = '99999999-9999-9999-9999-999999999999'
    await seedReportedReview(b0, { id: idLo, reports: [{ reporter: b0.renterId, at: TIE }] })
    await seedReportedReview(b1, { id: idHi, reports: [{ reporter: b1.renterId, at: TIE }] })

    const page = await repo.listReported({ limit: 50, status: 'VISIBLE' })
    const mine = page.items.map((i) => i.review.id).filter((id) => id === idLo || id === idHi)
    // Same lastReportedAt -> reviewId DESC decides: idHi before idLo.
    expect(mine).toEqual([idHi, idLo])

    // A cursor AT idHi's boundary excludes idHi (not < itself) and still yields idLo.
    const after = await repo.listReported({
      limit: 50,
      status: 'VISIBLE',
      cursor: { lastReportedAt: TIE, reviewId: idHi },
    })
    const afterMine = after.items.map((i) => i.review.id).filter((id) => id === idLo || id === idHi)
    expect(afterMine).toEqual([idLo])
  })
})

describe('DrizzleReviewRepository.setModerationStatus (#1454, real pg)', () => {
  it('stamps the moderation audit trail (moderatedBy + moderatedAt) and persists it', async () => {
    const id = await seedReportedReview(b0, {
      status: 'VISIBLE',
      reports: [{ reporter: b0.renterId, at: new Date('2099-08-01T00:00:00Z') }],
    })
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
