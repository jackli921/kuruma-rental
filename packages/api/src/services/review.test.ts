import type { SubmitReviewInput } from '@kuruma/shared/validators/review'
import { describe, expect, it } from 'vitest'
import type { CallerContext } from '../middleware/auth'
import { InMemoryBookingRepository } from '../repositories/in-memory/booking'
import { InMemoryBookingEventRepository } from '../repositories/in-memory/booking-event'
import { InMemoryOperatorMembershipRepository } from '../repositories/in-memory/operator-membership'
import { InMemoryReviewRepository } from '../repositories/in-memory/review'
import { InMemoryVehicleRepository } from '../repositories/in-memory/vehicle'
import type { Booking, BookingEvent, OperatorMembership, Review, Vehicle } from '../stores'
import { ReviewService } from './review'
import { ReviewAggregateService } from './review-aggregate'

const OPERATOR_ID = 'op-1'
const RENTER_ID = 'renter-1'
const OP_USER_ID = 'opuser-1'
const STRANGER_ID = 'stranger-1'
const VEHICLE_ID = 'veh-1'
const CLASS_ID = 'class-1'
const BOOKING_ID = 'bk-1'

const COMPLETED_AT = new Date('2026-06-01T00:00:00Z')
const DEADLINE = new Date('2026-06-15T00:00:00Z') // COMPLETED_AT + 14d
const NOW = new Date('2026-06-03T00:00:00Z') // inside the window
const AFTER_DEADLINE = new Date('2026-06-15T00:00:00.001Z')

const renterCtx: CallerContext = { userId: RENTER_ID, role: 'RENTER', bypassScope: false }
const operatorCtx: CallerContext = {
  userId: OP_USER_ID,
  role: 'OPERATOR_OWNER',
  operatorId: OPERATOR_ID,
  bypassScope: false,
}
const strangerCtx: CallerContext = { userId: STRANGER_ID, role: 'RENTER', bypassScope: false }
const ADMIN_ID = 'admin-1'
const adminCtx: CallerContext = { userId: ADMIN_ID, role: 'PLATFORM_ADMIN', bypassScope: false }

function makeBooking(overrides: Partial<Booking> = {}): Booking {
  return {
    id: BOOKING_ID,
    operatorId: OPERATOR_ID,
    renterId: RENTER_ID,
    classId: CLASS_ID,
    requestedVehicleId: VEHICLE_ID,
    assignedVehicleId: VEHICLE_ID,
    pickupLocationId: 'loc-1',
    dropoffLocationId: 'loc-1',
    startAt: new Date('2026-05-20T00:00:00Z'),
    endAt: new Date('2026-05-30T00:00:00Z'),
    effectiveEndAt: new Date('2026-05-30T00:00:00Z'),
    status: 'COMPLETED',
    source: 'DIRECT',
    fulfillmentMode: 'SPECIFIC',
    bookingCode: 'ABCD1234',
    insuranceOptionId: null,
    insuranceSnapshot: null,
    feeSnapshot: [],
    addOnSnapshot: [],
    externalId: null,
    notes: null,
    totalPrice: 50000,
    cancellationFee: null,
    cancellationFeeSettlement: 'ADVISORY',
    cancelledAt: null,
    idempotencyKey: null,
    disclaimerAcknowledgedAt: null,
    disclaimerTermsVersion: null,
    createdAt: new Date('2026-05-15T00:00:00Z'),
    updatedAt: new Date('2026-05-30T00:00:00Z'),
    ...overrides,
  }
}

function makeVehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id: VEHICLE_ID,
    operatorId: OPERATOR_ID,
    classId: CLASS_ID,
    pickupLocationId: 'loc-1',
    name: 'Toyota Yaris',
    description: null,
    photos: [],
    seats: 5,
    luggageCapacity: null,
    luggageSize: null,
    transmission: 'AUTO',
    fuelType: null,
    licensePlate: null,
    status: 'AVAILABLE',
    minRentalHours: null,
    maxRentalHours: null,
    advanceBookingHours: null,
    make: null,
    model: null,
    year: null,
    color: null,
    dailyRateJpy: 8000,
    hourlyRateJpy: null,
    shakenExpiryDate: null,
    insuranceExpiryDate: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  }
}

function completionEvent(bookingId = BOOKING_ID, createdAt = COMPLETED_AT): BookingEvent {
  return {
    id: `evt-${bookingId}`,
    bookingId,
    type: 'STATUS_CHANGED',
    payload: { type: 'STATUS_CHANGED', from: 'ACTIVE', to: 'COMPLETED' },
    actorId: null,
    createdAt,
  }
}

function activeMembership(): OperatorMembership {
  return {
    id: 'mem-1',
    userId: OP_USER_ID,
    operatorId: OPERATOR_ID,
    role: 'OPERATOR_OWNER',
    status: 'ACTIVE',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  }
}

interface Harness {
  service: ReviewService
  reviewRepo: InMemoryReviewRepository
}

function makeHarness(
  opts: {
    bookings?: Booking[]
    events?: BookingEvent[]
    memberships?: OperatorMembership[]
    reviews?: Review[]
    vehicles?: Vehicle[]
  } = {},
): Harness {
  const bookingStore = new Map((opts.bookings ?? [makeBooking()]).map((b) => [b.id, b]))
  const memberStore = new Map((opts.memberships ?? [activeMembership()]).map((m) => [m.id, m]))
  const reviewStore = new Map((opts.reviews ?? []).map((r) => [r.id, r]))
  const vehicleStore = new Map((opts.vehicles ?? [makeVehicle()]).map((v) => [v.id, v]))
  const reviewRepo = new InMemoryReviewRepository(reviewStore)
  const service = new ReviewService(
    reviewRepo,
    new InMemoryBookingRepository(bookingStore),
    new InMemoryVehicleRepository(vehicleStore),
    new InMemoryBookingEventRepository(opts.events ?? [completionEvent()]),
    new InMemoryOperatorMembershipRepository(memberStore),
  )
  return { service, reviewRepo }
}

function submitInput(overrides: Partial<SubmitReviewInput> = {}): SubmitReviewInput {
  return { bookingId: BOOKING_ID, subject: 'OPERATOR', overall: 5, subRatings: {}, ...overrides }
}

describe('ReviewService.submit — derivation', () => {
  it('persists a renter->operator review with server-derived identity + reveal fields', async () => {
    const { service } = makeHarness()
    const result = await service.submit(renterCtx, submitInput({ comment: 'great car' }), NOW)
    if (!result.ok) throw new Error(`expected ok, got ${result.error}`)
    expect(result.review).toMatchObject({
      bookingId: BOOKING_ID,
      operatorId: OPERATOR_ID,
      authorUserId: RENTER_ID,
      authorRole: 'RENTER',
      subject: 'OPERATOR',
      subjectVehicleId: null,
      subjectClassId: null,
      overall: 5,
      comment: 'great car',
      moderationStatus: 'VISIBLE',
      publishedAt: null,
    })
    // Window anchored to the COMPLETED event, not the submit clock (NOW != COMPLETED_AT).
    expect(result.review.revealDeadlineAt).toEqual(DEADLINE)
  })

  it('tags a renter->vehicle review with the assigned vehicle + its class', async () => {
    const { service } = makeHarness()
    const result = await service.submit(renterCtx, submitInput({ subject: 'VEHICLE' }), NOW)
    if (!result.ok) throw new Error(`expected ok, got ${result.error}`)
    expect(result.review.subject).toBe('VEHICLE')
    expect(result.review.subjectVehicleId).toBe(VEHICLE_ID)
    expect(result.review.subjectClassId).toBe(CLASS_ID)
  })

  it('persists an operator->renter review with authorRole OPERATOR and no vehicle tag', async () => {
    const { service } = makeHarness()
    const result = await service.submit(operatorCtx, submitInput({ subject: 'RENTER' }), NOW)
    if (!result.ok) throw new Error(`expected ok, got ${result.error}`)
    expect(result.review.authorRole).toBe('OPERATOR')
    expect(result.review.subject).toBe('RENTER')
    expect(result.review.subjectVehicleId).toBeNull()
  })
})

describe('ReviewService.submit — VEHICLE class derived from the assigned car (#1270)', () => {
  // Substitution / assignVehicle can swap in a same-ACRISS car of a DIFFERENT class without
  // touching booking.classId. The review of the car actually driven must count under that
  // car's real class (what the storefront badge reads), not the class originally booked.
  const BOOKED_CLASS = 'class-booked'
  const ACTUAL_CLASS = 'class-actual'
  const SUB_VEHICLE = 'veh-sub'

  const substitutedHarness = (subClassId: string | null) =>
    makeHarness({
      bookings: [makeBooking({ classId: BOOKED_CLASS, assignedVehicleId: SUB_VEHICLE })],
      vehicles: [makeVehicle({ id: SUB_VEHICLE, classId: subClassId })],
    })

  it('keys subjectClassId to the assigned vehicle’s class, not the booked class', async () => {
    const { service } = substitutedHarness(ACTUAL_CLASS)
    const result = await service.submit(renterCtx, submitInput({ subject: 'VEHICLE' }), NOW)
    if (!result.ok) throw new Error(`expected ok, got ${result.error}`)
    expect(result.review.subjectVehicleId).toBe(SUB_VEHICLE)
    expect(result.review.subjectClassId).toBe(ACTUAL_CLASS)
  })

  it('stores a null subjectClassId when the assigned car has no class', async () => {
    const { service } = substitutedHarness(null)
    const result = await service.submit(renterCtx, submitInput({ subject: 'VEHICLE' }), NOW)
    if (!result.ok) throw new Error(`expected ok, got ${result.error}`)
    expect(result.review.subjectVehicleId).toBe(SUB_VEHICLE)
    expect(result.review.subjectClassId).toBeNull()
  })

  it('aggregates the review under the assigned car’s class — not the booked class', async () => {
    const { service, reviewRepo } = substitutedHarness(ACTUAL_CLASS)
    // Submit past the reveal window so the lone VEHICLE review publishes immediately (#1195),
    // making it visible to the published+visible aggregate scan.
    const submitted = await service.submit(
      renterCtx,
      submitInput({ subject: 'VEHICLE', overall: 4 }),
      AFTER_DEADLINE,
    )
    if (!submitted.ok) throw new Error(`expected ok, got ${submitted.error}`)
    expect(submitted.review.publishedAt).toEqual(AFTER_DEADLINE)

    const aggregate = new ReviewAggregateService(reviewRepo)
    expect(await aggregate.forClasses([ACTUAL_CLASS])).toEqual({
      [ACTUAL_CLASS]: { avg: 4, count: 1 },
    })
    // The booked class must NOT absorb the review of a car that isn't in it.
    expect(await aggregate.forClasses([BOOKED_CLASS])).toEqual({ [BOOKED_CLASS]: null })
  })
})

describe('ReviewService.submit — eligibility guard', () => {
  it('404s when the booking does not exist', async () => {
    const { service } = makeHarness({ bookings: [makeBooking({ id: 'other' })] })
    expect(await service.submit(renterCtx, submitInput(), NOW)).toEqual({
      ok: false,
      status: 404,
      error: 'BOOKING_NOT_FOUND',
    })
  })

  it.each(['CONFIRMED', 'ACTIVE', 'CANCELLED'] as const)(
    'rejects a %s (non-COMPLETED) booking with 409 BOOKING_NOT_COMPLETED',
    async (status) => {
      const { service } = makeHarness({ bookings: [makeBooking({ status })] })
      expect(await service.submit(renterCtx, submitInput(), NOW)).toEqual({
        ok: false,
        status: 409,
        error: 'BOOKING_NOT_COMPLETED',
      })
    },
  )

  it('rejects a stranger (neither renter nor operator member) with 403', async () => {
    const { service } = makeHarness()
    expect(await service.submit(strangerCtx, submitInput(), NOW)).toEqual({
      ok: false,
      status: 403,
      error: 'NOT_A_PARTICIPANT',
    })
  })

  it('rejects a renter reviewing subject=RENTER with 403 (renters never review renters)', async () => {
    const { service } = makeHarness()
    expect(await service.submit(renterCtx, submitInput({ subject: 'RENTER' }), NOW)).toMatchObject({
      ok: false,
      status: 403,
      error: 'NOT_A_PARTICIPANT',
    })
  })

  it('rejects an operator reviewing subject=OPERATOR with 403 (operators only review renters)', async () => {
    const { service } = makeHarness()
    expect(
      await service.submit(operatorCtx, submitInput({ subject: 'OPERATOR' }), NOW),
    ).toMatchObject({ ok: false, status: 403, error: 'NOT_A_PARTICIPANT' })
  })

  it('rejects an operator member of a DIFFERENT operator with 403', async () => {
    const { service } = makeHarness({
      memberships: [{ ...activeMembership(), operatorId: 'op-OTHER' }],
    })
    expect(
      await service.submit(operatorCtx, submitInput({ subject: 'RENTER' }), NOW),
    ).toMatchObject({ ok: false, status: 403, error: 'NOT_A_PARTICIPANT' })
  })
})

describe('ReviewService.submit — dimensions + dedup', () => {
  it('accepts an operator-direction sub-dimension on a renter->operator review', async () => {
    const { service } = makeHarness()
    const result = await service.submit(
      renterCtx,
      submitInput({ subRatings: { cleanliness: 4, value: 5 } }),
      NOW,
    )
    expect(result.ok).toBe(true)
  })

  it('rejects a renter->operator review carrying a renter-direction dimension (ruleAdherence)', async () => {
    const { service } = makeHarness()
    expect(
      await service.submit(renterCtx, submitInput({ subRatings: { ruleAdherence: 5 } }), NOW),
    ).toEqual({ ok: false, status: 400, error: 'INVALID_DIMENSIONS' })
  })

  it('rejects a second review of the same subject by the same author with 409 ALREADY_REVIEWED', async () => {
    const { service } = makeHarness()
    expect((await service.submit(renterCtx, submitInput(), NOW)).ok).toBe(true)
    expect(await service.submit(renterCtx, submitInput(), NOW)).toEqual({
      ok: false,
      status: 409,
      error: 'ALREADY_REVIEWED',
    })
  })
})

describe('ReviewService — double-blind reveal on read', () => {
  it("hides the counterpart's unpublished review but shows the reader their own", async () => {
    const { service } = makeHarness()
    await service.submit(renterCtx, submitInput(), NOW) // renter -> operator, still hidden

    const operatorView = await service.getForBooking(operatorCtx, BOOKING_ID, NOW)
    if (!operatorView.ok) throw new Error('expected ok')
    expect(operatorView.reviews).toHaveLength(0) // renter's row is hidden from the operator

    const renterView = await service.getForBooking(renterCtx, BOOKING_ID, NOW)
    if (!renterView.ok) throw new Error('expected ok')
    expect(renterView.reviews).toHaveLength(1) // author always sees their own
    expect(renterView.reviews[0]?.publishedAt).toBeNull()
  })

  it('reveals BOTH sides once the counterpart submits (both-submitted branch)', async () => {
    const { service } = makeHarness()
    await service.submit(renterCtx, submitInput(), NOW)
    await service.submit(operatorCtx, submitInput({ subject: 'RENTER' }), NOW)

    const operatorView = await service.getForBooking(operatorCtx, BOOKING_ID, NOW)
    if (!operatorView.ok) throw new Error('expected ok')
    const renterRow = operatorView.reviews.find((r) => r.authorRole === 'RENTER')
    expect(renterRow).toBeDefined()
    expect(renterRow?.publishedAt).toEqual(NOW)
  })

  it('reveals the lone review to the counterpart once the window has elapsed', async () => {
    const { service } = makeHarness()
    await service.submit(renterCtx, submitInput(), NOW)

    const operatorView = await service.getForBooking(operatorCtx, BOOKING_ID, AFTER_DEADLINE)
    if (!operatorView.ok) throw new Error('expected ok')
    expect(operatorView.reviews).toHaveLength(1)
    expect(operatorView.reviews[0]?.publishedAt).toEqual(AFTER_DEADLINE)
  })

  it('403s a non-participant reading a booking it has no part in', async () => {
    const { service } = makeHarness()
    await service.submit(renterCtx, submitInput(), NOW)
    expect(await service.getForBooking(strangerCtx, BOOKING_ID, NOW)).toMatchObject({
      ok: false,
      status: 403,
    })
  })

  it('projects the participant read to an allowlist so moderation internals never cross the wire', async () => {
    const { service } = makeHarness()
    await service.submit(renterCtx, submitInput(), NOW)

    const view = await service.getForBooking(renterCtx, BOOKING_ID, NOW)
    if (!view.ok) throw new Error('expected ok')
    const row = view.reviews[0]
    // Exactly the participant-facing fields. The raw entity would also carry moderatedBy (a
    // platform admin's userId — a #1086 leak to the very author who was moderated),
    // moderationStatus, moderatedAt, authorUserId, operatorId, subRatings and the internal
    // reveal deadline. Pinning the exact key set fails if any of those leak back in.
    expect(row && Object.keys(row).sort()).toEqual(
      ['authorRole', 'bookingId', 'comment', 'id', 'overall', 'publishedAt', 'subject'].sort(),
    )
  })
})

describe('ReviewService.submit — reveal on write (#1195)', () => {
  // settleReveal must run on submit, not only on a later getForBooking read. These assert the
  // PERSISTED state directly (no read-repair) — a 3rd-party/API-only submitter never re-reads,
  // and slice-5 aggregates filter publishedAt, so an unread both-submitted pair would undercount.
  it('publishes BOTH sides the moment the second party submits — without any read', async () => {
    const { service, reviewRepo } = makeHarness()
    await service.submit(renterCtx, submitInput(), NOW) // renter -> operator (first, stays hidden)
    const second = await service.submit(operatorCtx, submitInput({ subject: 'RENTER' }), NOW)

    const persisted = await reviewRepo.findByBookingId(BOOKING_ID)
    expect(persisted).toHaveLength(2)
    expect(persisted.find((r) => r.authorRole === 'RENTER')?.publishedAt).toEqual(NOW)
    expect(persisted.find((r) => r.authorRole === 'OPERATOR')?.publishedAt).toEqual(NOW)
    // The submit response is honest about the post-settle publish.
    expect(second.ok && second.review.publishedAt).toEqual(NOW)
  })

  it('keeps a lone first submitter hidden in the window — double-blind preserved', async () => {
    const { service, reviewRepo } = makeHarness()
    const first = await service.submit(renterCtx, submitInput(), NOW)

    const persisted = await reviewRepo.findByBookingId(BOOKING_ID)
    expect(persisted).toHaveLength(1)
    expect(persisted[0]?.publishedAt).toBeNull()
    expect(first.ok && first.review.publishedAt).toBeNull()
  })

  it('publishes the lone review on submit once the window has already elapsed', async () => {
    const { service, reviewRepo } = makeHarness()
    const only = await service.submit(renterCtx, submitInput(), AFTER_DEADLINE)

    const persisted = await reviewRepo.findByBookingId(BOOKING_ID)
    expect(persisted[0]?.publishedAt).toEqual(AFTER_DEADLINE)
    expect(only.ok && only.review.publishedAt).toEqual(AFTER_DEADLINE)
  })
})

describe('ReviewService — one review per operator (#1158)', () => {
  // A SECOND active staff member of the same operator. The operator->renter review
  // represents the operator (the tenant), not the individual staff user, so the first
  // to submit speaks for it — a colleague must not be able to add a second.
  const OP_USER_ID_2 = 'opuser-2'
  const operatorCtx2: CallerContext = {
    userId: OP_USER_ID_2,
    role: 'OPERATOR_STAFF',
    operatorId: OPERATOR_ID,
    bypassScope: false,
  }
  const twoStaff = (): OperatorMembership[] => [
    activeMembership(),
    { ...activeMembership(), id: 'mem-2', userId: OP_USER_ID_2 },
  ]

  it('rejects a second operator->renter review by a DIFFERENT staff member with 409 ALREADY_REVIEWED', async () => {
    const { service } = makeHarness({ memberships: twoStaff() })
    expect((await service.submit(operatorCtx, submitInput({ subject: 'RENTER' }), NOW)).ok).toBe(
      true,
    )
    // Different authorUserId, same booking+subject: the single (bookingId, subject) seal traps this.
    expect(await service.submit(operatorCtx2, submitInput({ subject: 'RENTER' }), NOW)).toEqual({
      ok: false,
      status: 409,
      error: 'ALREADY_REVIEWED',
    })
  })

  it('shows an operator staff member their colleague’s still-hidden operator->renter review', async () => {
    const { service } = makeHarness({ memberships: twoStaff() })
    await service.submit(operatorCtx, submitInput({ subject: 'RENTER' }), NOW) // staff A, hidden

    // Same operator = same tenant: staff B sees their operator's OWN side even before reveal,
    // so the portal can hide the rate-renter prompt once any colleague has reviewed (#1158).
    const staffBView = await service.getForBooking(operatorCtx2, BOOKING_ID, NOW)
    if (!staffBView.ok) throw new Error('expected ok')
    expect(staffBView.reviews).toHaveLength(1)
    expect(staffBView.reviews[0]?.authorRole).toBe('OPERATOR')
    expect(staffBView.reviews[0]?.publishedAt).toBeNull()
  })

  it('does NOT leak the operator’s still-hidden review to the renter (double-blind intact)', async () => {
    const { service } = makeHarness()
    await service.submit(operatorCtx, submitInput({ subject: 'RENTER' }), NOW) // operator, hidden

    // The widening that lets staff see their own side must stay operator-only: the renter
    // still sees nothing until the operator's review publishes.
    const renterView = await service.getForBooking(renterCtx, BOOKING_ID, NOW)
    if (!renterView.ok) throw new Error('expected ok')
    expect(renterView.reviews).toHaveLength(0)
  })
})

describe('ReviewService.edit — until published', () => {
  it('edits a still-hidden review in place', async () => {
    const { service } = makeHarness()
    const submitted = await service.submit(renterCtx, submitInput({ overall: 5 }), NOW)
    if (!submitted.ok) throw new Error('expected ok')
    const edited = await service.edit(
      renterCtx,
      submitted.review.id,
      { overall: 2, subRatings: {}, comment: 'changed my mind' },
      NOW,
    )
    if (!edited.ok) throw new Error('expected ok')
    expect(edited.review.overall).toBe(2)
    expect(edited.review.comment).toBe('changed my mind')
  })

  it('refuses to edit once the review has published (409 ALREADY_PUBLISHED)', async () => {
    const { service } = makeHarness()
    const submitted = await service.submit(renterCtx, submitInput(), NOW)
    if (!submitted.ok) throw new Error('expected ok')
    // Window-elapse publishes it via a read.
    await service.getForBooking(operatorCtx, BOOKING_ID, AFTER_DEADLINE)

    expect(
      await service.edit(
        renterCtx,
        submitted.review.id,
        { overall: 1, subRatings: {} },
        AFTER_DEADLINE,
      ),
    ).toEqual({ ok: false, status: 409, error: 'ALREADY_PUBLISHED' })
  })

  it('does not let a non-author edit — uniform 404 (no IDOR oracle, no mutation)', async () => {
    const { service, reviewRepo } = makeHarness()
    const submitted = await service.submit(renterCtx, submitInput({ overall: 5 }), NOW)
    if (!submitted.ok) throw new Error('expected ok')
    const result = await service.edit(
      strangerCtx,
      submitted.review.id,
      { overall: 1, subRatings: {}, comment: 'hijacked' },
      NOW,
    )
    // A non-author's edit looks identical to editing a non-existent id (both 404), so a
    // review id can't be enumerated; and it's the honest code, not a false ALREADY_PUBLISHED.
    expect(result).toEqual({ ok: false, status: 404, error: 'REVIEW_NOT_FOUND' })
    const rows = await reviewRepo.findByBookingId(BOOKING_ID)
    expect(rows[0]?.overall).toBe(5) // untouched
  })

  it('404s editing a review id that does not exist', async () => {
    const { service } = makeHarness()
    expect(
      await service.edit(renterCtx, crypto.randomUUID(), { overall: 1, subRatings: {} }, NOW),
    ).toEqual({ ok: false, status: 404, error: 'REVIEW_NOT_FOUND' })
  })

  it('rejects an edit that injects an out-of-direction dimension (400 INVALID_DIMENSIONS)', async () => {
    const { service } = makeHarness()
    // A valid renter->operator review (operator dims allowed) ...
    const submitted = await service.submit(
      renterCtx,
      submitInput({ subRatings: { cleanliness: 4 } }),
      NOW,
    )
    if (!submitted.ok) throw new Error('expected ok')
    // ... edited to smuggle in ruleAdherence (a renter-direction dim) must be rejected the
    // same way submit rejects it — the per-direction rule is an invariant, not a create gate.
    expect(
      await service.edit(
        renterCtx,
        submitted.review.id,
        { overall: 3, subRatings: { ruleAdherence: 5 }, comment: 'sneaky' },
        NOW,
      ),
    ).toEqual({ ok: false, status: 400, error: 'INVALID_DIMENSIONS' })
  })
})

describe('ReviewService — moderation withholds a hidden review (#1086)', () => {
  // Reveal both sides so each row is published; then admin-hide one and re-read.
  async function seedRevealedPair(harness = makeHarness()) {
    await harness.service.submit(renterCtx, submitInput(), NOW)
    await harness.service.submit(operatorCtx, submitInput({ subject: 'RENTER' }), NOW)
    const rows = await harness.reviewRepo.findByBookingId(BOOKING_ID)
    const renterRow = rows.find((r) => r.authorRole === 'RENTER')
    if (!renterRow) throw new Error('expected a renter review')
    return { ...harness, renterRow }
  }

  it('withholds an admin-HIDDEN published review from the revealed counterparty', async () => {
    const { service, reviewRepo, renterRow } = await seedRevealedPair()
    await reviewRepo.setModerationStatus(renterRow.id, 'HIDDEN', ADMIN_ID, NOW)

    const operatorView = await service.getForBooking(operatorCtx, BOOKING_ID, NOW)
    if (!operatorView.ok) throw new Error('expected ok')
    // The counterparty must no longer see the hidden review, even though it published.
    expect(operatorView.reviews.some((r) => r.authorRole === 'RENTER')).toBe(false)
    // The operator's own still-visible review is unaffected.
    expect(operatorView.reviews.some((r) => r.authorRole === 'OPERATOR')).toBe(true)
  })

  it('still shows a hidden review to its own author', async () => {
    const { service, reviewRepo, renterRow } = await seedRevealedPair()
    await reviewRepo.setModerationStatus(renterRow.id, 'HIDDEN', ADMIN_ID, NOW)

    const renterView = await service.getForBooking(renterCtx, BOOKING_ID, NOW)
    if (!renterView.ok) throw new Error('expected ok')
    expect(renterView.reviews.map((r) => r.id)).toContain(renterRow.id)
  })
})

describe('ReviewService.reportReview — flag for moderation (#1086)', () => {
  // A published+visible review is publicly displayed (slice 5), so any authenticated
  // user viewing a storefront can report it — no participant check.
  async function seedPublishedReview(harness = makeHarness()) {
    await harness.service.submit(renterCtx, submitInput(), NOW)
    await harness.service.submit(operatorCtx, submitInput({ subject: 'RENTER' }), NOW)
    const rows = await harness.reviewRepo.findByBookingId(BOOKING_ID)
    const target = rows.find((r) => r.authorRole === 'RENTER')
    if (!target) throw new Error('expected a renter review')
    return { ...harness, target }
  }

  it('records a report against a published, visible review without auto-hiding it', async () => {
    const { service, reviewRepo, target } = await seedPublishedReview()
    const result = await service.reportReview(strangerCtx, target.id, {
      reason: 'Abusive language',
    })
    if (!result.ok) throw new Error('expected ok')
    expect(result.report).toMatchObject({
      reviewId: target.id,
      reporterUserId: STRANGER_ID,
      reason: 'Abusive language',
    })
    // Report-only by owner decision: the review stays VISIBLE until an admin acts.
    expect((await reviewRepo.findById(target.id))?.moderationStatus).toBe('VISIBLE')
  })

  it('404s reporting a still-hidden double-blind review — no existence oracle', async () => {
    const h = makeHarness()
    await h.service.submit(renterCtx, submitInput(), NOW) // lone submit -> stays hidden
    const hidden = (await h.reviewRepo.findByBookingId(BOOKING_ID))[0]
    if (!hidden) throw new Error('expected a review')
    expect(await h.service.reportReview(strangerCtx, hidden.id, { reason: 'x' })).toMatchObject({
      ok: false,
      status: 404,
    })
  })

  it('404s reporting an admin-HIDDEN review — no oracle', async () => {
    const { service, reviewRepo, target } = await seedPublishedReview()
    await reviewRepo.setModerationStatus(target.id, 'HIDDEN', ADMIN_ID, NOW)
    expect(await service.reportReview(strangerCtx, target.id, { reason: 'x' })).toMatchObject({
      ok: false,
      status: 404,
    })
  })

  it('404s reporting a nonexistent review id', async () => {
    const { service } = makeHarness()
    expect(await service.reportReview(strangerCtx, 'no-such-id', { reason: 'x' })).toMatchObject({
      ok: false,
      status: 404,
    })
  })

  it('409 ALREADY_REPORTED on a second report by the same user', async () => {
    const { service, target } = await seedPublishedReview()
    expect((await service.reportReview(strangerCtx, target.id, { reason: 'a' })).ok).toBe(true)
    expect(await service.reportReview(strangerCtx, target.id, { reason: 'b' })).toEqual({
      ok: false,
      status: 409,
      error: 'ALREADY_REPORTED',
    })
  })

  it('lets a DIFFERENT user report the same review', async () => {
    const { service, target } = await seedPublishedReview()
    await service.reportReview(strangerCtx, target.id, { reason: 'a' })
    const other: CallerContext = { userId: 'stranger-2', role: 'RENTER', bypassScope: false }
    expect((await service.reportReview(other, target.id, { reason: 'b' })).ok).toBe(true)
  })
})

describe('ReviewService.hideReview — admin soft-hide (#1086)', () => {
  async function seedPublished() {
    const h = makeHarness()
    await h.service.submit(renterCtx, submitInput(), NOW)
    await h.service.submit(operatorCtx, submitInput({ subject: 'RENTER' }), NOW)
    const rows = await h.reviewRepo.findByBookingId(BOOKING_ID)
    const target = rows.find((r) => r.authorRole === 'RENTER')
    if (!target) throw new Error('expected a renter review')
    return { ...h, target }
  }

  it('flips a review to HIDDEN and returns the updated row', async () => {
    const { service, reviewRepo, target } = await seedPublished()
    expect((await service.hideReview(adminCtx, target.id, NOW))?.moderationStatus).toBe('HIDDEN')
    expect((await reviewRepo.findById(target.id))?.moderationStatus).toBe('HIDDEN')
  })

  it('records the acting admin and moderation instant on hide (#1454)', async () => {
    const { service, reviewRepo, target } = await seedPublished()
    // Before moderation the audit fields are empty.
    const before = await reviewRepo.findById(target.id)
    expect(before?.moderatedBy).toBeNull()
    expect(before?.moderatedAt).toBeNull()

    const moderatedAt = new Date('2026-06-05T09:30:00Z')
    const hidden = await service.hideReview(adminCtx, target.id, moderatedAt)
    expect(hidden?.moderatedBy).toBe(ADMIN_ID)
    expect(hidden?.moderatedAt).toEqual(moderatedAt)
    // Persisted, not just returned.
    const persisted = await reviewRepo.findById(target.id)
    expect(persisted?.moderatedBy).toBe(ADMIN_ID)
    expect(persisted?.moderatedAt).toEqual(moderatedAt)
  })

  it('returns undefined for an unknown review id (→ 404 at the route)', async () => {
    const { service } = makeHarness()
    expect(await service.hideReview(adminCtx, 'no-such-id', NOW)).toBeUndefined()
  })

  it('is idempotent — re-hiding a hidden review stays HIDDEN', async () => {
    const { service, target } = await seedPublished()
    await service.hideReview(adminCtx, target.id, NOW)
    expect((await service.hideReview(adminCtx, target.id, NOW))?.moderationStatus).toBe('HIDDEN')
  })
})

describe('ReviewService.listReported — moderation queue (#1086, #1451)', () => {
  // Seed a single reported, published review (the renter side) and return it + harness.
  async function seedReported(harness = makeHarness()) {
    await harness.service.submit(renterCtx, submitInput(), NOW)
    await harness.service.submit(operatorCtx, submitInput({ subject: 'RENTER' }), NOW)
    const rows = await harness.reviewRepo.findByBookingId(BOOKING_ID)
    const renterReview = rows.find((r) => r.authorRole === 'RENTER')
    if (!renterReview) throw new Error('expected a renter review')
    return { ...harness, renterReview }
  }

  it('is empty (no items, no next page) when nothing has been reported', async () => {
    const { service } = makeHarness()
    expect(await service.listReported()).toEqual({ items: [], nextCursor: null })
  })

  it('returns a reported review with its distinct-reporter count and reasons, excluding unreported rows', async () => {
    const { service, renterReview } = await seedReported()
    const stranger2: CallerContext = { userId: 'stranger-2', role: 'RENTER', bypassScope: false }
    // Two distinct reporters flag the renter review; the operator review goes unreported.
    await service.reportReview(strangerCtx, renterReview.id, { reason: 'abusive' })
    await service.reportReview(stranger2, renterReview.id, { reason: 'spam' })

    const { items, nextCursor } = await service.listReported()
    expect(items).toHaveLength(1)
    expect(items[0]?.review.id).toBe(renterReview.id)
    expect(items[0]?.reportCount).toBe(2)
    expect(items[0]?.reasons).toEqual(expect.arrayContaining(['abusive', 'spam']))
    // A single reported review is the whole queue — no further page.
    expect(nextCursor).toBeNull()
  })

  it('defaults to the UNACTIONED (VISIBLE) partition; a hidden review is reachable only via status: HIDDEN (#1451)', async () => {
    const { service, renterReview } = await seedReported()
    await service.reportReview(strangerCtx, renterReview.id, { reason: 'abusive' })

    // Reported + still visible -> in the default queue.
    expect((await service.listReported()).items.map((e) => e.review.id)).toEqual([renterReview.id])

    // Admin hides it -> it leaves the default (unactioned) queue and only shows under HIDDEN.
    await service.hideReview(adminCtx, renterReview.id, NOW)
    expect((await service.listReported()).items).toEqual([])
    expect(
      (await service.listReported({ status: 'HIDDEN' })).items.map((e) => e.review.id),
    ).toEqual([renterReview.id])
  })
})

describe('ReviewService.sweep — window backstop', () => {
  it('publishes window-elapsed unread rows and is idempotent', async () => {
    const future = makeBooking({ id: 'bk-future' })
    const { service, reviewRepo } = makeHarness({
      bookings: [makeBooking(), future],
      events: [completionEvent(), completionEvent('bk-future', new Date('2026-07-01T00:00:00Z'))],
    })
    await service.submit(renterCtx, submitInput(), NOW) // deadline 2026-06-15
    await service.submit(renterCtx, submitInput({ bookingId: 'bk-future' }), NOW) // deadline 2026-07-15

    const summary = await service.sweep(AFTER_DEADLINE, 100)
    expect(summary).toEqual({ scanned: 1, published: 1, bookingsTouched: 1 })

    const swept = (await reviewRepo.findByBookingId(BOOKING_ID))[0]
    expect(swept?.publishedAt).toEqual(AFTER_DEADLINE)
    const stillHidden = (await reviewRepo.findByBookingId('bk-future'))[0]
    expect(stillHidden?.publishedAt).toBeNull()

    // Re-running the sweep flips nothing (first-write-wins).
    expect(await service.sweep(AFTER_DEADLINE, 100)).toMatchObject({ published: 0 })
  })
})
