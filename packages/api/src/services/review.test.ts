import type { SubmitReviewInput } from '@kuruma/shared/validators/review'
import { describe, expect, it } from 'vitest'
import type { CallerContext } from '../middleware/auth'
import { InMemoryBookingRepository } from '../repositories/in-memory/booking'
import { InMemoryBookingEventRepository } from '../repositories/in-memory/booking-event'
import { InMemoryOperatorMembershipRepository } from '../repositories/in-memory/operator-membership'
import { InMemoryReviewRepository } from '../repositories/in-memory/review'
import type { Booking, BookingEvent, OperatorMembership, Review } from '../stores'
import { ReviewService } from './review'

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
  } = {},
): Harness {
  const bookingStore = new Map((opts.bookings ?? [makeBooking()]).map((b) => [b.id, b]))
  const memberStore = new Map((opts.memberships ?? [activeMembership()]).map((m) => [m.id, m]))
  const reviewStore = new Map((opts.reviews ?? []).map((r) => [r.id, r]))
  const reviewRepo = new InMemoryReviewRepository(reviewStore)
  const service = new ReviewService(
    reviewRepo,
    new InMemoryBookingRepository(bookingStore),
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

  it('does not let a non-author edit (no mutation, rejected)', async () => {
    const { service, reviewRepo } = makeHarness()
    const submitted = await service.submit(renterCtx, submitInput({ overall: 5 }), NOW)
    if (!submitted.ok) throw new Error('expected ok')
    const result = await service.edit(
      strangerCtx,
      submitted.review.id,
      { overall: 1, subRatings: {}, comment: 'hijacked' },
      NOW,
    )
    expect(result.ok).toBe(false)
    const rows = await reviewRepo.findByBookingId(BOOKING_ID)
    expect(rows[0]?.overall).toBe(5) // untouched
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
