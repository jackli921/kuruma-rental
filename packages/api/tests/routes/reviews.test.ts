import { Hono } from 'hono'
import { beforeEach, describe, expect, it } from 'vitest'
import { InMemoryBookingRepository } from '../../src/repositories/in-memory/booking'
import { InMemoryBookingEventRepository } from '../../src/repositories/in-memory/booking-event'
import { InMemoryOperatorMembershipRepository } from '../../src/repositories/in-memory/operator-membership'
import { InMemoryReviewRepository } from '../../src/repositories/in-memory/review'
import { InMemoryVehicleRepository } from '../../src/repositories/in-memory/vehicle'
import { createReviewRoutes } from '../../src/routes/reviews'
import { ReviewService } from '../../src/services/review'
import type { Booking, BookingEvent, OperatorMembership, Vehicle } from '../../src/stores'
import { testAuthMiddleware } from '../helpers/auth'

// bookingId is UUID-validated at the route boundary, so it must be a real UUID.
const BOOKING_ID = '11111111-1111-4111-8111-111111111111'
const OPERATOR_ID = 'op-1'
const RENTER_ID = 'renter-1'
const OP_USER_ID = 'opuser-1'
const STRANGER_ID = 'stranger-1'
const VEHICLE_ID = 'veh-1'
const CLASS_ID = 'class-1'
// Anchored to wall-clock "just completed" so the 14-day reveal window is genuinely
// OPEN when the route reads with real `new Date()` — the blindness case below must not
// be silently revealed by an elapsed window (which a fixed past date would trigger).
const COMPLETED_AT = new Date()

let reviewRepo: InMemoryReviewRepository
let bookingRepo: InMemoryBookingRepository
let vehicleRepo: InMemoryVehicleRepository
let eventRepo: InMemoryBookingEventRepository
let memberRepo: InMemoryOperatorMembershipRepository

const booking: Booking = {
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
}

const completionEvent: BookingEvent = {
  id: 'evt-1',
  bookingId: BOOKING_ID,
  type: 'STATUS_CHANGED',
  payload: { type: 'STATUS_CHANGED', from: 'ACTIVE', to: 'COMPLETED' },
  actorId: null,
  createdAt: COMPLETED_AT,
}

const vehicle: Vehicle = {
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
}

const membership: OperatorMembership = {
  id: 'mem-1',
  userId: OP_USER_ID,
  operatorId: OPERATOR_ID,
  role: 'OPERATOR_OWNER',
  status: 'ACTIVE',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
}

function routes(): Hono {
  const a = new Hono()
  return a.route(
    '/',
    createReviewRoutes(
      new ReviewService(reviewRepo, bookingRepo, vehicleRepo, eventRepo, memberRepo),
    ),
  )
}

function appAs(userId: string, role: 'RENTER' | 'OPERATOR_OWNER'): Hono {
  const a = new Hono()
  a.use('*', testAuthMiddleware(userId, role, role === 'OPERATOR_OWNER' ? OPERATOR_ID : undefined))
  return a.route('/', routes())
}

function submit(app: Hono, subject: 'OPERATOR' | 'VEHICLE' | 'RENTER', extra: object = {}) {
  return app.request('/reviews', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bookingId: BOOKING_ID, subject, overall: 5, ...extra }),
  })
}

beforeEach(() => {
  reviewRepo = new InMemoryReviewRepository()
  bookingRepo = new InMemoryBookingRepository(new Map([[booking.id, booking]]))
  vehicleRepo = new InMemoryVehicleRepository(new Map([[vehicle.id, vehicle]]))
  eventRepo = new InMemoryBookingEventRepository([completionEvent])
  memberRepo = new InMemoryOperatorMembershipRepository(new Map([[membership.id, membership]]))
})

describe('Review routes — HTTP contract', () => {
  it('401s an unauthenticated submit (requireAuth gates the mount)', async () => {
    const res = await routes().request('/reviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookingId: BOOKING_ID, subject: 'OPERATOR', overall: 5 }),
    })
    expect(res.status).toBe(401)
  })

  it('201s a renter submission and returns the derived review', async () => {
    const res = await submit(appAs(RENTER_ID, 'RENTER'), 'OPERATOR', { comment: 'great' })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.review).toMatchObject({
      authorRole: 'RENTER',
      subject: 'OPERATOR',
      operatorId: OPERATOR_ID,
      publishedAt: null,
    })
  })

  it('400s a malformed body (unknown subject) at the Zod boundary', async () => {
    const res = await appAs(RENTER_ID, 'RENTER').request('/reviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookingId: BOOKING_ID, subject: 'BANANA', overall: 5 }),
    })
    expect(res.status).toBe(400)
  })

  it('keeps a review double-blind over HTTP until the counterpart submits', async () => {
    await submit(appAs(RENTER_ID, 'RENTER'), 'OPERATOR') // renter -> operator, hidden

    const hidden = await appAs(OP_USER_ID, 'OPERATOR_OWNER').request(
      `/bookings/${BOOKING_ID}/reviews`,
    )
    expect(hidden.status).toBe(200)
    expect((await hidden.json()).data.reviews).toHaveLength(0)

    await submit(appAs(OP_USER_ID, 'OPERATOR_OWNER'), 'RENTER') // counterpart submits -> reveal

    const revealed = await appAs(OP_USER_ID, 'OPERATOR_OWNER').request(
      `/bookings/${BOOKING_ID}/reviews`,
    )
    const rows = (await revealed.json()).data.reviews as Array<{
      authorRole: string
      publishedAt: string | null
    }>
    const renterRow = rows.find((r) => r.authorRole === 'RENTER')
    expect(renterRow?.publishedAt).not.toBeNull()
  })

  it('403s a non-participant reading the booking reviews', async () => {
    const res = await appAs(STRANGER_ID, 'RENTER').request(`/bookings/${BOOKING_ID}/reviews`)
    expect(res.status).toBe(403)
  })
})

describe('Review routes — report for moderation (#1086)', () => {
  // Reveal both sides so the renter review is published (publicly reportable).
  async function seedPublishedReviewId(): Promise<string> {
    await submit(appAs(RENTER_ID, 'RENTER'), 'OPERATOR')
    await submit(appAs(OP_USER_ID, 'OPERATOR_OWNER'), 'RENTER')
    const renter = (await reviewRepo.findByBookingId(BOOKING_ID)).find(
      (r) => r.authorRole === 'RENTER',
    )
    if (!renter) throw new Error('expected a renter review')
    return renter.id
  }

  function report(app: Hono, reviewId: string, reason = 'Abusive language') {
    return app.request(`/reviews/${reviewId}/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    })
  }

  it('401s an unauthenticated report (requireAuth gates the sub-path)', async () => {
    const reviewId = await seedPublishedReviewId()
    const res = await routes().request(`/reviews/${reviewId}/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'x' }),
    })
    expect(res.status).toBe(401)
  })

  it('201s a report against a published review and echoes it', async () => {
    const reviewId = await seedPublishedReviewId()
    const res = await report(appAs(STRANGER_ID, 'RENTER'), reviewId)
    expect(res.status).toBe(201)
    expect((await res.json()).data.report).toMatchObject({
      reviewId,
      reporterUserId: STRANGER_ID,
      reason: 'Abusive language',
    })
  })

  it('400s an empty reason at the Zod boundary', async () => {
    const reviewId = await seedPublishedReviewId()
    const res = await report(appAs(STRANGER_ID, 'RENTER'), reviewId, '')
    expect(res.status).toBe(400)
  })

  it('404s reporting a still-hidden double-blind review (no oracle)', async () => {
    await submit(appAs(RENTER_ID, 'RENTER'), 'OPERATOR') // lone submit -> stays hidden
    const hidden = (await reviewRepo.findByBookingId(BOOKING_ID))[0]
    if (!hidden) throw new Error('expected a review')
    const res = await report(appAs(STRANGER_ID, 'RENTER'), hidden.id)
    expect(res.status).toBe(404)
  })

  it('409s a duplicate report by the same user', async () => {
    const reviewId = await seedPublishedReviewId()
    await report(appAs(STRANGER_ID, 'RENTER'), reviewId)
    const res = await report(appAs(STRANGER_ID, 'RENTER'), reviewId)
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('ALREADY_REPORTED')
  })
})
