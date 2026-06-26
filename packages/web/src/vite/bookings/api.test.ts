import { bookingEventSchema, operatorBookingDetailSchema } from '@/vite/operator-bookings/schema'
import { describe, expect, it } from 'vitest'
import { bookingDtoSchema } from './api'

// Minimal valid SPECIFIC booking — all required fields, both vehicle ids present.
const baseBooking = {
  id: '00000000-0000-0000-0000-000000000001',
  bookingCode: 'KRM-0001',
  renterId: '00000000-0000-0000-0000-000000000002',
  classId: null,
  requestedVehicleId: '00000000-0000-0000-0000-000000000010',
  assignedVehicleId: '00000000-0000-0000-0000-000000000010',
  pickupLocationId: '00000000-0000-0000-0000-000000000020',
  dropoffLocationId: '00000000-0000-0000-0000-000000000020',
  startAt: '2026-07-01T09:00:00.000Z',
  endAt: '2026-07-03T09:00:00.000Z',
  effectiveEndAt: '2026-07-03T09:00:00.000Z',
  status: 'CONFIRMED' as const,
  source: 'WEB',
  insuranceOptionId: null,
  insuranceSnapshot: null,
  feeSnapshot: [],
  addOnSnapshot: [],
  totalPrice: 20000,
  notes: null,
  createdAt: '2026-07-01T08:00:00.000Z',
  updatedAt: '2026-07-01T08:00:00.000Z',
}

// CLASS_COMBO float: renter picked class + location; vehicle ids are null until assigned.
const comboBooking = {
  ...baseBooking,
  requestedVehicleId: null,
  assignedVehicleId: null,
  classId: '00000000-0000-0000-0000-000000000099',
}

describe('bookingDtoSchema — #464 CLASS_COMBO null vehicle ids', () => {
  it('parses a SPECIFIC booking with non-null vehicle ids', () => {
    const result = bookingDtoSchema.parse(baseBooking)
    expect(result.requestedVehicleId).toBe(baseBooking.requestedVehicleId)
    expect(result.assignedVehicleId).toBe(baseBooking.assignedVehicleId)
  })

  it('parses a CLASS_COMBO booking with null vehicle ids', () => {
    expect(() => bookingDtoSchema.parse(comboBooking)).not.toThrow()
    const result = bookingDtoSchema.parse(comboBooking)
    expect(result.requestedVehicleId).toBeNull()
    expect(result.assignedVehicleId).toBeNull()
  })
})

describe('operatorBookingDetailSchema — #464 CLASS_COMBO null vehicle ids', () => {
  it('parses a CLASS_COMBO detail booking with null vehicle ids', () => {
    expect(() => operatorBookingDetailSchema.parse(comboBooking)).not.toThrow()
    const result = operatorBookingDetailSchema.parse(comboBooking)
    expect(result.requestedVehicleId).toBeNull()
    expect(result.assignedVehicleId).toBeNull()
  })
})

describe('bookingEventSchema — BOOKING_CREATED payload with null vehicle ids (#464)', () => {
  const baseEvent = {
    id: '00000000-0000-0000-0000-000000000050',
    type: 'BOOKING_CREATED' as const,
    actorId: null,
    createdAt: '2026-07-01T08:00:00.000Z',
  }

  it('parses a BOOKING_CREATED event for a CLASS_COMBO booking with null vehicle ids', () => {
    const event = {
      ...baseEvent,
      payload: {
        type: 'BOOKING_CREATED' as const,
        requestedVehicleId: null,
        assignedVehicleId: null,
        classId: '00000000-0000-0000-0000-000000000099',
        fulfillmentMode: 'CLASS_COMBO' as const,
        startAt: '2026-07-01T09:00:00.000Z',
        endAt: '2026-07-03T09:00:00.000Z',
        totalPrice: 20000,
        insuranceSnapshot: null,
        feeSnapshot: [],
        addOnSnapshot: [],
      },
    }
    expect(() => bookingEventSchema.parse(event)).not.toThrow()
    const result = bookingEventSchema.parse(event)
    expect(result.payload.type).toBe('BOOKING_CREATED')
    if (result.payload.type === 'BOOKING_CREATED') {
      expect(result.payload.requestedVehicleId).toBeNull()
      expect(result.payload.assignedVehicleId).toBeNull()
    }
  })
})
