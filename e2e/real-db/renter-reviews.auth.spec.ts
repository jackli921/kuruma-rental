import { type APIRequestContext, type Locator, expect, request, test } from '@playwright/test'
import { OPERATOR_SEED_EMAIL, RENTER_SEED_EMAIL, RENTER_STORAGE_STATE } from './constants'
import {
  SESSION_COOKIE_NAME,
  mintOperatorSessionToken,
  mintRenterSessionToken,
} from './mint-session'
import { testSql } from './pg'

// #1537: authenticated, real-DB coverage for the renter post-trip review flow — the
// renter rates the OPERATOR (overall + 4 sub-dimensions + comment) and the VEHICLE
// (overall + comment) on a COMPLETED booking, then the double-blind reveal. Drives the
// real Vite UI -> Hono API -> seeded Postgres stack under the RENTER session.
//
// What this proves (submission and reveal are otherwise only unit-covered):
//   1. The renter submits both subjects through the My Bookings "Leave a review" dialog;
//      two review rows persist with the exact overall/sub-ratings/comment given, and the
//      post-trip prompt disappears (the client re-read them — visible to their author).
//   2. Double-blind HIDDEN: the counterpart (operator) GET returns nothing while the
//      reviews are unpublished and the operator has not reciprocated.
//   3. Double-blind REVEAL: once the 14-day window elapses (simulated by pushing
//      revealDeadlineAt into the past — we cannot wait 14 days), a read settles the
//      reveal and the counterpart now sees both published reviews.
//
// The COMPLETED booking is seeded directly over pg (testSql) rather than driven through
// the operator advance-to-COMPLETED UI: that keeps the spec self-contained and in the
// renter context. Reviews read completion time from the STATUS_CHANGED->COMPLETED
// booking_events row (ReviewService.findCompletedAt), so the seed inserts that event too —
// status='COMPLETED' alone would 409 COMPLETION_TIME_UNKNOWN. The bookings_no_overlap
// exclusion only covers CONFIRMED/ACTIVE, so a COMPLETED seed never clashes with the
// demo bookings. Every seeded row is tagged notes=MARKER so afterAll sweeps it clean.

// The renter view: override the project-default OPERATOR storageState (#390 pattern).
test.use({ storageState: RENTER_STORAGE_STATE })

const OPERATOR_NAME = 'Best Car Rental'
const MARKER = 'e2e-1537-reviews'
const DAY_MS = 24 * 60 * 60 * 1000

// The real Hono API port — mirrors playwright.real-db.config.ts (API_PORT = 8788). The
// counterpart (operator) read hits it directly with a minted cookie: a GET needs no CSRF,
// and a non-browser request context is not subject to CORS.
const API_URL = 'http://localhost:8788'

// What the renter enters. Kept as constants so the DB assertions are mutation-resistant —
// a wrong star or a dropped sub-rating fails, not just "some review exists".
const OPERATOR_OVERALL = 5
const OPERATOR_DIMS = { cleanliness: 5, accuracy: 4, communication: 5, value: 3 } as const
const OPERATOR_COMMENT = 'Smooth handover, clear instructions, great communication.'
const VEHICLE_OVERALL = 4
const VEHICLE_COMMENT = 'Clean and reliable; ran perfectly the whole trip.'

interface SeededReviewBooking {
  bookingId: string
  bookingCode: string
  vehicleId: string
}

// The membership row this spec inserts (see seedCompletedBooking) so afterAll can drop
// exactly it. ReviewService resolves the operator's participant role via an ACTIVE
// operator_memberships row (findActiveByUserId) — NOT the token's operatorId claim — and
// the demo seed creates the owner with users.operatorId set but no membership row, so the
// operator side of reviews is inert against the seeded DB without this. (Reported on #1537.)
let seededMembershipId: string | null = null

test.describe('renter post-trip reviews — submit both subjects + double-blind reveal (real DB)', () => {
  test.afterAll(cleanupSeeded)

  test('renter reviews the operator and the vehicle; hidden from the operator until the window reveals', async ({
    page,
  }) => {
    test.setTimeout(120_000) // Vite builds the /bookings route on first hit.

    const { bookingId, bookingCode, vehicleId } = await seedCompletedBooking()

    // --- 1. Submit both subjects through the renter's My Bookings prompt -----------------
    await page.goto('/en/bookings')
    const card = page.getByRole('listitem').filter({ hasText: bookingCode })
    // Generous: Vite lazily compiles the /bookings route on the first hit of a fresh server.
    await expect(card).toBeVisible({ timeout: 30_000 })
    await expect(card).toContainText('Completed')

    const leaveReview = card.getByRole('button', { name: 'Leave a review' })
    await expect(leaveReview).toBeVisible()
    await leaveReview.click()

    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: 'Review your trip' })).toBeVisible()

    // Operator: overall + all four sub-dimensions + comment.
    await setStars(dialog, 'overall-OPERATOR', OPERATOR_OVERALL)
    await setStars(dialog, 'dim-OPERATOR-cleanliness', OPERATOR_DIMS.cleanliness)
    await setStars(dialog, 'dim-OPERATOR-accuracy', OPERATOR_DIMS.accuracy)
    await setStars(dialog, 'dim-OPERATOR-communication', OPERATOR_DIMS.communication)
    await setStars(dialog, 'dim-OPERATOR-value', OPERATOR_DIMS.value)
    await dialog.getByLabel('Comment about The operator').fill(OPERATOR_COMMENT)

    // Vehicle: overall + comment (a renter->VEHICLE review carries no sub-dimensions).
    await setStars(dialog, 'overall-VEHICLE', VEHICLE_OVERALL)
    await dialog.getByLabel('Comment about The vehicle').fill(VEHICLE_COMMENT)

    await dialog.getByRole('button', { name: 'Submit review' }).click()

    // The dialog closes and the prompt disappears: both subjects are now reviewed, so the
    // client's re-read of GET /bookings/:id/reviews returned the renter's own rows (author-
    // visible) and pendingReviewSubjects() went empty.
    await expect(dialog).toBeHidden()
    await expect(leaveReview).toBeHidden()

    // --- 2. Both rows persisted with exactly what was entered, and start hidden ----------
    const stored = await readReviews(bookingId)
    expect(stored).toHaveLength(2)
    const operatorReview = stored.find((r) => r.subject === 'OPERATOR')
    const vehicleReview = stored.find((r) => r.subject === 'VEHICLE')

    expect(operatorReview).toMatchObject({
      authorRole: 'RENTER',
      overall: OPERATOR_OVERALL,
      comment: OPERATOR_COMMENT,
      subjectVehicleId: null, // an operator review must not carry a vehicle id
      publishedAt: null,
    })
    expect(operatorReview?.subRatings).toEqual(OPERATOR_DIMS)
    expect(vehicleReview).toMatchObject({
      authorRole: 'RENTER',
      overall: VEHICLE_OVERALL,
      comment: VEHICLE_COMMENT,
      subjectVehicleId: vehicleId,
      publishedAt: null,
    })
    // A vehicle review must not smuggle in operator sub-dimensions.
    expect(vehicleReview?.subRatings).toEqual({})

    // --- 3. Double-blind: hidden from the counterpart, visible to the author -------------
    const operatorApi = await authedApi(await mintOperatorSessionToken())
    const renterApi = await authedApi(await mintRenterSessionToken())
    try {
      // The operator has not reciprocated and the window is open -> the counterpart sees
      // nothing (the renter's rows are unpublished).
      expect(await getReviews(operatorApi, bookingId)).toHaveLength(0)
      // The author always sees their own rows, published or not.
      const authorView = await getReviews(renterApi, bookingId)
      expect(authorView).toHaveLength(2)
      expect(authorView.every((r) => r.publishedAt === null)).toBe(true)

      // --- 4. Reveal: the 14-day window elapses (simulated) -> counterpart now sees both --
      await expireReviewWindow(bookingId)
      const revealed = await getReviews(operatorApi, bookingId)
      expect(revealed).toHaveLength(2)
      expect(revealed.every((r) => r.publishedAt !== null)).toBe(true)
      // Assert the revealed CONTENT, not just that publishedAt flipped — a reveal bug that
      // blanks or swaps a row would still set publishedAt.
      const revealedBySubject = Object.fromEntries(revealed.map((r) => [r.subject, r]))
      expect(revealedBySubject.OPERATOR).toMatchObject({
        overall: OPERATOR_OVERALL,
        comment: OPERATOR_COMMENT,
      })
      expect(revealedBySubject.VEHICLE).toMatchObject({
        overall: VEHICLE_OVERALL,
        comment: VEHICLE_COMMENT,
      })
    } finally {
      await operatorApi.dispose()
      await renterApi.dispose()
    }
  })
})

// --- UI helpers ----------------------------------------------------------------------------

/** Click the Nth star of a named radio group. The radio itself is sr-only (the visible
 *  Star icon is its label), so we click the wrapping <label> — a real, visible tap target
 *  whose native association toggles the radio, exactly as a user does. */
async function setStars(scope: Locator, group: string, n: number): Promise<void> {
  await scope.locator(`label:has(input[name="${group}"][aria-label="${n} stars"])`).click()
}

// --- API helpers ---------------------------------------------------------------------------

interface ReviewView {
  subject: 'OPERATOR' | 'VEHICLE'
  authorRole: 'RENTER' | 'OPERATOR'
  overall: number
  comment: string | null
  publishedAt: string | null
}

/** A request context carrying a seeded persona's session cookie, pointed at the real API. */
function authedApi(token: string): Promise<APIRequestContext> {
  return request.newContext({
    baseURL: API_URL,
    extraHTTPHeaders: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
  })
}

/** GET /bookings/:id/reviews as whoever the context is authenticated as (double-blind read). */
async function getReviews(ctx: APIRequestContext, bookingId: string): Promise<ReviewView[]> {
  const res = await ctx.get(`/bookings/${bookingId}/reviews`)
  expect(res.status()).toBe(200)
  // API envelope is { success, data } (routes/helpers.ts ok()).
  const body = (await res.json()) as { data: { reviews: ReviewView[] } }
  return body.data.reviews
}

// --- seeding + assertion helpers (raw pg over testSql) -------------------------------------

interface StoredReview {
  subject: string
  authorRole: string
  overall: number
  subRatings: Record<string, number>
  comment: string | null
  subjectVehicleId: string | null
  publishedAt: Date | null
}

async function readReviews(bookingId: string): Promise<StoredReview[]> {
  const sql = testSql()
  try {
    return await sql<StoredReview[]>`
      SELECT subject, "authorRole", overall, "subRatings", comment, "subjectVehicleId", "publishedAt"
      FROM reviews WHERE "bookingId" = ${bookingId} ORDER BY subject`
  } finally {
    await sql.end({ timeout: 5 })
  }
}

/** Simulate the 14-day double-blind window elapsing by moving every review's deadline into
 *  the past. The next participant read then settles the reveal for real (decideReveal +
 *  publishMany run unchanged) — we only fast-forward the clock the deadline is measured against. */
async function expireReviewWindow(bookingId: string): Promise<void> {
  const sql = testSql()
  try {
    await sql`
      UPDATE reviews SET "revealDeadlineAt" = now() - interval '1 minute'
      WHERE "bookingId" = ${bookingId}`
  } finally {
    await sql.end({ timeout: 5 })
  }
}

/** A COMPLETED Best Car Rental booking owned by Sarah, plus the STATUS_CHANGED->COMPLETED
 *  event ReviewService.findCompletedAt reads. completedAt is recent (1 day ago) so the 14-day
 *  reveal window is still open and the renter's reviews start hidden. */
async function seedCompletedBooking(): Promise<SeededReviewBooking> {
  const sql = testSql()
  try {
    const [op] = await sql<{ id: string }[]>`
      SELECT id FROM operators WHERE name = ${OPERATOR_NAME}`
    const [renter] = await sql<{ id: string }[]>`
      SELECT id FROM users WHERE email = ${RENTER_SEED_EMAIL}`
    const [owner] = await sql<{ id: string }[]>`
      SELECT id FROM users WHERE email = ${OPERATOR_SEED_EMAIL}`
    if (!op || !renter || !owner) {
      throw new Error(`seed missing operator ${OPERATOR_NAME}, renter, or owner`)
    }

    // The owner's ACTIVE membership — makes them a review participant (see note above).
    // Delete-before-insert so a run killed before afterAll can't leave a zombie ACTIVE row
    // that fails the next INSERT on operator_memberships_active_user_unique (the demo seed
    // creates none for this owner, so this only clears our own leftovers). Same self-heal
    // convention as operator-cold-start.auth.spec.ts.
    await sql`DELETE FROM operator_memberships WHERE "userId" = ${owner.id} AND status = 'ACTIVE'`
    const [membership] = await sql<{ id: string }[]>`
      INSERT INTO operator_memberships (id, "userId", "operatorId", role, status)
      VALUES (${crypto.randomUUID()}, ${owner.id}, ${op.id}, 'OPERATOR_OWNER', 'ACTIVE')
      RETURNING id`
    seededMembershipId = membership?.id ?? null
    const [vehicle] = await sql<{ id: string; classId: string; locationId: string }[]>`
      SELECT v.id, v."classId", v."pickupLocationId" AS "locationId"
      FROM vehicles v
      WHERE v."operatorId" = ${op.id}
        AND v.status = 'AVAILABLE'
        AND v."classId" IS NOT NULL
        AND v."pickupLocationId" IS NOT NULL
      LIMIT 1`
    if (!vehicle)
      throw new Error('seed has no AVAILABLE Best Car Rental vehicle with a class + location')

    const bookingId = crypto.randomUUID()
    const bookingCode = `E1537${Math.random().toString(36).slice(2, 8).toUpperCase()}`
    const startAt = new Date(Date.now() - 3 * DAY_MS)
    const endAt = new Date(Date.now() - 1 * DAY_MS)
    const completedAt = new Date(Date.now() - 1 * DAY_MS)

    await sql`INSERT INTO bookings ${sql({
      id: bookingId,
      operatorId: op.id,
      renterId: renter.id,
      classId: vehicle.classId,
      requestedVehicleId: vehicle.id,
      assignedVehicleId: vehicle.id,
      pickupLocationId: vehicle.locationId,
      dropoffLocationId: vehicle.locationId,
      startAt,
      endAt,
      effectiveEndAt: endAt, // placeholder; a BEFORE trigger overwrites with endAt + turnaround
      status: 'COMPLETED',
      bookingCode,
      totalPrice: 18_000,
      notes: MARKER,
    })}`

    await sql`
      INSERT INTO booking_events (id, "bookingId", type, payload, "createdAt")
      VALUES (
        ${crypto.randomUUID()},
        ${bookingId},
        'STATUS_CHANGED',
        ${sql.json({ type: 'STATUS_CHANGED', from: 'ACTIVE', to: 'COMPLETED' })},
        ${completedAt}
      )`

    return { bookingId, bookingCode, vehicleId: vehicle.id }
  } finally {
    await sql.end({ timeout: 5 })
  }
}

/** Drop everything this spec created: the booking's children (reviews, events) then the
 *  booking itself in FK order, plus the separately-tracked owner membership. */
async function cleanupSeeded(): Promise<void> {
  const sql = testSql()
  try {
    const ids = await sql<{ id: string }[]>`SELECT id FROM bookings WHERE notes = ${MARKER}`
    if (ids.length > 0) {
      const bookingIds = ids.map((r) => r.id)
      await sql`DELETE FROM reviews WHERE "bookingId" IN ${sql(bookingIds)}`
      await sql`DELETE FROM booking_events WHERE "bookingId" IN ${sql(bookingIds)}`
      await sql`DELETE FROM bookings WHERE id IN ${sql(bookingIds)}`
    }
    // Always drop the seeded membership, even if no booking landed (a mid-seed failure).
    if (seededMembershipId) {
      await sql`DELETE FROM operator_memberships WHERE id = ${seededMembershipId}`
    }
  } finally {
    await sql.end({ timeout: 5 })
  }
}
