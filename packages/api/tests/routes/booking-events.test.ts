import type { BookingCreatedPayload, StatusChangedPayload } from '@kuruma/shared/db/schema'
import { Hono } from 'hono'
import { beforeEach, describe, expect, it } from 'vitest'
import { SYSTEM_CONTEXT } from '../../src/middleware/auth'
import {
  InMemoryBookingEventRepository,
  InMemoryBookingRepository,
} from '../../src/repositories/in-memory'
import type { RunInTransaction } from '../../src/repositories/types'
import { createBookingRoutes } from '../../src/routes/bookings'
import { BookingService } from '../../src/services/booking'
import type { BookingEvent } from '../../src/stores'
import { testAuthMiddleware } from '../helpers/auth'
import { bookingInput } from '../helpers/booking'
import { makeInertConsentGate } from '../helpers/consent'

// #549 slice 1: the operator trip-detail page reads a booking's lifecycle log
// via GET /bookings/:id/events. The endpoint is operator/management-only — the
// events expose actorId, internal vehicle ids and the substitution reason, none
// of which a renter UI consumes today. Tenant read-scope (findById) means an
// operator still only ever reads its OWN tenant's events (404, no cross-leak).

const OP_A = '00000000-0000-4000-8000-0000000000a0'
const OP_B = '00000000-0000-4000-8000-0000000000b0'
const OPA_USER = '00000000-0000-4000-8000-0000000000a1'
const OPB_USER = '00000000-0000-4000-8000-0000000000b1'
const RENTER = '00000000-0000-4000-8000-0000000000c1'

const createdPayload: BookingCreatedPayload = {
  requestedVehicleId: 'veh-1',
  assignedVehicleId: 'veh-1',
  classId: 'class-1',
  fulfillmentMode: 'SPECIFIC',
  startAt: '2026-04-10T09:00:00Z',
  endAt: '2026-04-10T17:00:00Z',
  totalPrice: 12000,
  insuranceSnapshot: null,
  feeSnapshot: [],
  addOnSnapshot: [],
}
const toActive: StatusChangedPayload = { from: 'CONFIRMED', to: 'ACTIVE' }
const toCompleted: StatusChangedPayload = { from: 'ACTIVE', to: 'COMPLETED' }

// The runInTransaction seam is never exercised by these read-only tests.
const unusedRunInTransaction: RunInTransaction = async () => {
  throw new Error('runInTransaction must not be called by findEvents')
}

let bookingRepo: InMemoryBookingRepository
let eventRepo: InMemoryBookingEventRepository
let service: BookingService
let bookingId: string

function eventsApp(
  userId: string,
  role: Parameters<typeof testAuthMiddleware>[1],
  operatorId?: string,
) {
  const app = new Hono()
  app.use('*', testAuthMiddleware(userId, role, operatorId))
  app.route('/', createBookingRoutes(service, makeInertConsentGate()))
  return app
}

describe('GET /bookings/:id/events', () => {
  beforeEach(async () => {
    bookingRepo = new InMemoryBookingRepository()
    const booking = await bookingRepo.create(
      SYSTEM_CONTEXT,
      bookingInput({ operatorId: OP_A, renterId: RENTER }),
    )
    bookingId = booking.id

    // Seeded OUT of chronological order so a passing test proves the endpoint
    // sorts by createdAt ascending rather than echoing insertion order.
    const seed: BookingEvent[] = [
      {
        id: 'evt-2',
        bookingId,
        type: 'STATUS_CHANGED',
        payload: toCompleted,
        actorId: OPA_USER,
        createdAt: new Date('2026-04-10T09:00:02Z'),
      },
      {
        id: 'evt-0',
        bookingId,
        type: 'BOOKING_CREATED',
        payload: createdPayload,
        actorId: RENTER,
        createdAt: new Date('2026-04-10T09:00:00Z'),
      },
      {
        id: 'evt-1',
        bookingId,
        type: 'STATUS_CHANGED',
        payload: toActive,
        actorId: OPA_USER,
        createdAt: new Date('2026-04-10T09:00:01Z'),
      },
    ]
    eventRepo = new InMemoryBookingEventRepository(seed)
    service = new BookingService(
      bookingRepo,
      unusedRunInTransaction,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      eventRepo,
    )
  })

  it('rejects a renter caller with 403 (operator/management-only)', async () => {
    const res = await eventsApp(RENTER, 'RENTER').request(`/bookings/${bookingId}/events`)

    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.success).toBe(false)
  })

  it('returns the events oldest-to-newest for the owning operator', async () => {
    const res = await eventsApp(OPA_USER, 'OPERATOR_OWNER', OP_A).request(
      `/bookings/${bookingId}/events`,
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.map((e: BookingEvent) => e.id)).toEqual(['evt-0', 'evt-1', 'evt-2'])
    expect(body.data.map((e: BookingEvent) => e.type)).toEqual([
      'BOOKING_CREATED',
      'STATUS_CHANGED',
      'STATUS_CHANGED',
    ])
    expect(body.data[0]).toMatchObject({
      id: 'evt-0',
      actorId: RENTER,
      createdAt: '2026-04-10T09:00:00.000Z',
    })
  })

  it("returns 404 when another operator reads this tenant's booking events", async () => {
    const res = await eventsApp(OPB_USER, 'OPERATOR_OWNER', OP_B).request(
      `/bookings/${bookingId}/events`,
    )

    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.success).toBe(false)
  })

  it('returns 404 for a booking that does not exist', async () => {
    const missing = '00000000-0000-4000-8000-0000000000ff'
    const res = await eventsApp(OPA_USER, 'OPERATOR_OWNER', OP_A).request(
      `/bookings/${missing}/events`,
    )

    expect(res.status).toBe(404)
  })
})
