import { reviews } from '@kuruma/shared/db/schema'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { DrizzleReviewRepository } from '../../src/repositories/drizzle/review'
import { type SeededBooking, createSeededBooking } from './booking-factory'
import { db } from './setup'

let a: SeededBooking
let b: SeededBooking
const repo = new DrizzleReviewRepository(db)

beforeAll(async () => {
  a = await createSeededBooking({ prefix: 'review-list' })
  b = await createSeededBooking({ prefix: 'review-list-2' })
})

afterEach(async () => {
  await db.delete(reviews).where(inArray(reviews.bookingId, [a.booking.id, b.booking.id]))
})

afterAll(async () => {
  await db.delete(reviews).where(inArray(reviews.bookingId, [a.booking.id, b.booking.id]))
  await a.cleanup()
  await b.cleanup()
})

async function insertOperatorReview(
  booking: SeededBooking,
  over: { publishedAt: Date | null; moderationStatus?: 'VISIBLE' | 'HIDDEN'; overall?: number },
) {
  return repo.insert({
    bookingId: booking.booking.id,
    operatorId: booking.operatorId,
    authorUserId: booking.renterId,
    authorRole: 'RENTER',
    subject: 'OPERATOR',
    subjectVehicleId: null,
    subjectClassId: null,
    overall: over.overall ?? 5,
    subRatings: {},
    comment: 'great',
    moderationStatus: over.moderationStatus ?? 'VISIBLE',
    revealDeadlineAt: new Date('2026-01-01'),
    submittedAt: new Date('2026-01-01'),
    publishedAt: over.publishedAt,
  })
}

describe('DrizzleReviewRepository.listPublishedForSubject (real pg)', () => {
  it('returns published+visible operator reviews newest-first and drops hidden/unrevealed', async () => {
    await insertOperatorReview(a, { publishedAt: new Date('2026-06-01') })
    await insertOperatorReview(b, { publishedAt: new Date('2026-06-05') })
    // c and d are created inside the test body; clean up in finally so leaks
    // don't accumulate if an assertion throws before the cleanup lines run.
    const c = await createSeededBooking({ prefix: 'review-list-3' })
    const d = await createSeededBooking({ prefix: 'review-list-4' })
    try {
      // c: published but HIDDEN by moderator — must be excluded
      await insertOperatorReview(c, {
        publishedAt: new Date('2026-06-09'),
        moderationStatus: 'HIDDEN',
        overall: 1,
      })
      // d: VISIBLE but unrevealed (publishedAt: null) — must be excluded by the
      // isNotNull(publishedAt) predicate
      await insertOperatorReview(d, { publishedAt: null })

      const result = await repo.listPublishedForSubject('OPERATOR', a.operatorId, 20)

      // Scope the assertion to OUR seeded bookings: listPublishedForSubject scans EVERY
      // published+visible OPERATOR review for that operator, and a concurrently-running
      // integration file may insert rows for the SAME default operator. So assert relative
      // order + membership of a/b and exclusion of the hidden c and unrevealed d —
      // NEVER a full-scan toEqual.
      const ours = result
        .map((r) => r.bookingId)
        .filter((id) => [a.booking.id, b.booking.id, c.booking.id, d.booking.id].includes(id))
      expect(ours).toEqual([b.booking.id, a.booking.id])
      expect(result.map((r) => r.bookingId)).not.toContain(c.booking.id)
      expect(result.map((r) => r.bookingId)).not.toContain(d.booking.id)
    } finally {
      await db.delete(reviews).where(inArray(reviews.bookingId, [c.booking.id, d.booking.id]))
      await c.cleanup()
      await d.cleanup()
    }
  })
})

// #1449 keyset "load more". The architect flagged (M2) that ids are `text` uuids, so
// Postgres orders them by the DB's collation while the InMemory repo sorts with JS `<`
// (code units). For a same-publishedAt batch — the only place the tiebreak decides the
// page boundary — those can disagree under a non-C collation, which a keyset cursor
// cannot tolerate. The Drizzle repo pins the id compare to `COLLATE "C"` (byte order ==
// JS `<` for ASCII uuids); these tests lock that parity in real Postgres.
describe('DrizzleReviewRepository.listPublishedForSubject keyset tiebreak (real pg, #1449)', () => {
  // A publishedAt shared by every seeded row, so ONLY the id tiebreak orders them.
  const TIE = new Date('2026-06-15T00:00:00Z')

  it('orders a same-publishedAt batch by id DESC in byte order (COLLATE "C" == JS `<`)', async () => {
    const c = await createSeededBooking({ prefix: 'review-list-tie-3' })
    try {
      // a, b, c share the default operator; all three published at the same instant.
      const inserted = await Promise.all([
        insertOperatorReview(a, { publishedAt: TIE }),
        insertOperatorReview(b, { publishedAt: TIE }),
        insertOperatorReview(c, { publishedAt: TIE }),
      ])
      const ourIds = new Set(inserted.map((r) => r.id))
      const result = await repo.listPublishedForSubject('OPERATOR', a.operatorId, 50)
      // Scope to our rows (a concurrent file may share the operator); relative order among
      // ours is exactly the tiebreak. Postgres MUST match the InMemory JS sort.
      const ours = result.map((r) => r.id).filter((id) => ourIds.has(id))
      const expected = [...ourIds].sort((x, y) => (x < y ? 1 : x > y ? -1 : 0))
      expect(ours).toEqual(expected)
    } finally {
      await db.delete(reviews).where(eq(reviews.bookingId, c.booking.id))
      await c.cleanup()
    }
  })

  it('an `after` cursor drops the cursor row and returns the rest of the tie in order', async () => {
    const c = await createSeededBooking({ prefix: 'review-list-tie-4' })
    try {
      const inserted = await Promise.all([
        insertOperatorReview(a, { publishedAt: TIE }),
        insertOperatorReview(b, { publishedAt: TIE }),
        insertOperatorReview(c, { publishedAt: TIE }),
      ])
      const ourIds = new Set(inserted.map((r) => r.id))
      const ordered = (await repo.listPublishedForSubject('OPERATOR', a.operatorId, 50))
        .map((r) => r.id)
        .filter((id) => ourIds.has(id))
      const [first, ...rest] = ordered
      if (!first) throw new Error('fixture: expected our seeded rows to be listed')
      // Big limit + filter (not LIMIT paging) so a concurrent file's rows can't interleave
      // the assertion — this exercises the real-pg keyset WHERE with COLLATE "C".
      const afterFirst = (
        await repo.listPublishedForSubject('OPERATOR', a.operatorId, 50, {
          publishedAt: TIE,
          id: first,
        })
      )
        .map((r) => r.id)
        .filter((id) => ourIds.has(id))
      expect(afterFirst).toEqual(rest)
      expect(afterFirst).not.toContain(first)
    } finally {
      await db.delete(reviews).where(eq(reviews.bookingId, c.booking.id))
      await c.cleanup()
    }
  })
})
