import type { BookingCreatedPayload, StatusChangedPayload } from '@kuruma/shared/db/schema'
import { describe, expect, it } from 'vitest'
import { SYSTEM_CONTEXT } from '../../src/middleware/auth'
import { InMemoryBookingEventRepository } from '../../src/repositories/in-memory/booking-event'

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
const statusPayload: StatusChangedPayload = { from: 'CONFIRMED', to: 'ACTIVE' }

describe('InMemoryBookingEventRepository', () => {
  it('append assigns an id + createdAt and preserves the event content', async () => {
    const repo = new InMemoryBookingEventRepository()
    const event = await repo.append(SYSTEM_CONTEXT, {
      bookingId: 'b1',
      type: 'BOOKING_CREATED',
      payload: createdPayload,
      actorId: 'renter-1',
    })
    expect(event.id).toMatch(/[0-9a-f-]{36}/)
    expect(event.createdAt).toBeInstanceOf(Date)
    expect(event.bookingId).toBe('b1')
    expect(event.type).toBe('BOOKING_CREATED')
    expect(event.actorId).toBe('renter-1')
    expect(event.payload).toEqual(createdPayload)
  })

  it('findByBookingId returns that booking events in append order', async () => {
    const repo = new InMemoryBookingEventRepository()
    await repo.append(SYSTEM_CONTEXT, {
      bookingId: 'b1',
      type: 'BOOKING_CREATED',
      payload: createdPayload,
      actorId: 'renter-1',
    })
    await repo.append(SYSTEM_CONTEXT, {
      bookingId: 'b1',
      type: 'STATUS_CHANGED',
      payload: statusPayload,
      actorId: null,
    })
    const events = await repo.findByBookingId(SYSTEM_CONTEXT, 'b1')
    expect(events.map((e) => e.type)).toEqual(['BOOKING_CREATED', 'STATUS_CHANGED'])
  })

  it('findByBookingId excludes events belonging to other bookings', async () => {
    const repo = new InMemoryBookingEventRepository()
    await repo.append(SYSTEM_CONTEXT, {
      bookingId: 'b1',
      type: 'BOOKING_CREATED',
      payload: createdPayload,
      actorId: 'renter-1',
    })
    await repo.append(SYSTEM_CONTEXT, {
      bookingId: 'b2',
      type: 'BOOKING_CREATED',
      payload: createdPayload,
      actorId: 'renter-2',
    })
    const events = await repo.findByBookingId(SYSTEM_CONTEXT, 'b1')
    expect(events).toHaveLength(1)
    expect(events[0]?.bookingId).toBe('b1')
  })

  it('is append-only: exposes no update or delete method', () => {
    const repo = new InMemoryBookingEventRepository()
    expect((repo as Record<string, unknown>).update).toBeUndefined()
    expect((repo as Record<string, unknown>).delete).toBeUndefined()
  })
})
