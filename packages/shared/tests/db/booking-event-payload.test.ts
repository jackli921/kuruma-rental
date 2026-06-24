import { describe, expect, it } from 'vitest'
import type { BookingCreatedPayload } from '../../src/db/booking-types'

// #464 slice 2d.0: pin that BookingCreatedPayload accepts null for both vehicle
// id fields — the load-bearing widening that lets slice 2d.3's combo-create path
// stamp a BOOKING_CREATED event without an assigned car. The SPECIFIC path keeps
// stamping concrete ids; this is purely additive. The CHECK constraint
// bookings_specific_requires_*_vehicle (packages/shared/src/db/booking.ts) keeps
// the DB-side invariant that SPECIFIC bookings always carry both ids.
describe('BookingCreatedPayload (#464)', () => {
  it('accepts null requestedVehicleId + assignedVehicleId for CLASS_COMBO', () => {
    const payload: BookingCreatedPayload = {
      type: 'BOOKING_CREATED',
      requestedVehicleId: null,
      assignedVehicleId: null,
      classId: '00000000-0000-0000-0000-000000000001',
      fulfillmentMode: 'CLASS_COMBO',
      startAt: '2026-07-01T10:00:00.000Z',
      endAt: '2026-07-02T10:00:00.000Z',
      totalPrice: 12000,
      insuranceSnapshot: null,
      feeSnapshot: [],
      addOnSnapshot: [],
    }
    expect(payload.requestedVehicleId).toBeNull()
    expect(payload.assignedVehicleId).toBeNull()
  })

  it('still accepts concrete ids for SPECIFIC', () => {
    const payload: BookingCreatedPayload = {
      type: 'BOOKING_CREATED',
      requestedVehicleId: '00000000-0000-0000-0000-0000000000aa',
      assignedVehicleId: '00000000-0000-0000-0000-0000000000aa',
      classId: '00000000-0000-0000-0000-000000000001',
      fulfillmentMode: 'SPECIFIC',
      startAt: '2026-07-01T10:00:00.000Z',
      endAt: '2026-07-02T10:00:00.000Z',
      totalPrice: 12000,
      insuranceSnapshot: null,
      feeSnapshot: [],
      addOnSnapshot: [],
    }
    expect(payload.assignedVehicleId).toBe(payload.requestedVehicleId)
  })
})
