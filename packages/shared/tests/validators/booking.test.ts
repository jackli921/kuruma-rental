import { describe, expect, it } from 'vitest'
import {
  cancelBookingSchema,
  createBookingSchema,
  updateBookingStatusSchema,
} from '../../src/validators/booking'

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000'
const PICKUP_UUID = '550e8400-e29b-41d4-a716-446655440002'
const DROPOFF_UUID = '550e8400-e29b-41d4-a716-446655440003'
const INSURANCE_UUID = '550e8400-e29b-41d4-a716-446655440004'
const RENTER_UUID = '550e8400-e29b-41d4-a716-446655440005'

// Slice 6 (#392): the renter books a CONCRETE vehicle selected in storefront
// (slice 5). The server derives operatorId/classId/assignedVehicleId/totalPrice
// from that vehicle — none of those are client fields (proposal §6.2, §4.1).
describe('createBookingSchema', () => {
  const validInput = {
    requestedVehicleId: VALID_UUID,
    pickupLocationId: PICKUP_UUID,
    dropoffLocationId: DROPOFF_UUID,
    startAt: '2026-04-10T09:00:00Z',
    endAt: '2026-04-10T17:00:00Z',
  }

  it('accepts the minimal required fields and defaults source to DIRECT', () => {
    const result = createBookingSchema.safeParse(validInput)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.requestedVehicleId).toBe(VALID_UUID)
      expect(result.data.pickupLocationId).toBe(PICKUP_UUID)
      expect(result.data.dropoffLocationId).toBe(DROPOFF_UUID)
      expect(result.data.source).toBe('DIRECT')
      expect(result.data.insuranceOptionId).toBeUndefined()
    }
  })

  it('accepts optional insuranceOptionId, renterId, notes, source, externalId', () => {
    const result = createBookingSchema.safeParse({
      ...validInput,
      insuranceOptionId: INSURANCE_UUID,
      renterId: RENTER_UUID,
      notes: 'Arriving at KIX',
      source: 'TRIP_COM',
      externalId: 'TC-12345',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.insuranceOptionId).toBe(INSURANCE_UUID)
      expect(result.data.renterId).toBe(RENTER_UUID)
      expect(result.data.source).toBe('TRIP_COM')
    }
  })

  it('rejects missing requestedVehicleId', () => {
    const { requestedVehicleId, ...rest } = validInput
    expect(createBookingSchema.safeParse(rest).success).toBe(false)
  })

  it('rejects non-UUID requestedVehicleId', () => {
    const result = createBookingSchema.safeParse({ ...validInput, requestedVehicleId: 'vehicle-1' })
    expect(result.success).toBe(false)
  })

  it('rejects missing pickupLocationId', () => {
    const { pickupLocationId, ...rest } = validInput
    expect(createBookingSchema.safeParse(rest).success).toBe(false)
  })

  it('rejects missing dropoffLocationId', () => {
    const { dropoffLocationId, ...rest } = validInput
    expect(createBookingSchema.safeParse(rest).success).toBe(false)
  })

  it('rejects non-UUID insuranceOptionId when provided', () => {
    const result = createBookingSchema.safeParse({ ...validInput, insuranceOptionId: 'ins-1' })
    expect(result.success).toBe(false)
  })

  it('rejects invalid datetime format', () => {
    expect(createBookingSchema.safeParse({ ...validInput, startAt: 'not-a-date' }).success).toBe(
      false,
    )
  })

  it('rejects endAt before startAt', () => {
    const result = createBookingSchema.safeParse({
      ...validInput,
      startAt: '2026-04-10T17:00:00Z',
      endAt: '2026-04-10T09:00:00Z',
    })
    expect(result.success).toBe(false)
  })

  it('rejects endAt equal to startAt', () => {
    const result = createBookingSchema.safeParse({
      ...validInput,
      startAt: '2026-04-10T09:00:00Z',
      endAt: '2026-04-10T09:00:00Z',
    })
    expect(result.success).toBe(false)
  })

  it('rejects invalid source enum', () => {
    expect(createBookingSchema.safeParse({ ...validInput, source: 'AIRBNB' }).success).toBe(false)
  })

  it('silently drops server-derived fields a malicious client may inject', () => {
    const result = createBookingSchema.safeParse({
      ...validInput,
      assignedVehicleId: VALID_UUID,
      operatorId: VALID_UUID,
      classId: VALID_UUID,
      totalPrice: 1,
      bookingCode: 'HACKED01',
      insuranceSnapshot: { name: 'x' },
      feeSnapshot: [{ feeType: 'CLEANING_FLAT' }],
      status: 'COMPLETED',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      const data = result.data as Record<string, unknown>
      expect(data.assignedVehicleId).toBeUndefined()
      expect(data.operatorId).toBeUndefined()
      expect(data.totalPrice).toBeUndefined()
      expect(data.bookingCode).toBeUndefined()
      expect(data.insuranceSnapshot).toBeUndefined()
      expect(data.feeSnapshot).toBeUndefined()
      expect(data.status).toBeUndefined()
    }
  })
})

describe('updateBookingStatusSchema', () => {
  it('accepts valid status', () => {
    const result = updateBookingStatusSchema.safeParse({ status: 'ACTIVE' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.status).toBe('ACTIVE')
    }
  })

  it('accepts all valid statuses', () => {
    for (const status of ['CONFIRMED', 'ACTIVE', 'COMPLETED', 'CANCELLED']) {
      expect(updateBookingStatusSchema.safeParse({ status }).success).toBe(true)
    }
  })

  it('rejects invalid status', () => {
    expect(updateBookingStatusSchema.safeParse({ status: 'BANANA' }).success).toBe(false)
  })

  it('rejects empty status', () => {
    expect(updateBookingStatusSchema.safeParse({ status: '' }).success).toBe(false)
  })
})

describe('cancelBookingSchema (#868 Slice 3b)', () => {
  it('accepts an empty body — the reason is always optional', () => {
    expect(cancelBookingSchema.safeParse({}).success).toBe(true)
  })

  it('accepts a reason code alone (note omitted)', () => {
    const result = cancelBookingSchema.safeParse({ reason: { code: 'CHANGE_OF_PLANS' } })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.reason).toEqual({ code: 'CHANGE_OF_PLANS' })
  })

  it('accepts a reason code with a freeform note, trimmed', () => {
    const result = cancelBookingSchema.safeParse({
      reason: { code: 'OTHER', note: '  found a cheaper car  ' },
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.reason?.note).toBe('found a cheaper car')
  })

  it('accepts a null note — the web sends note:null when the renter leaves it blank (#922)', () => {
    const result = cancelBookingSchema.safeParse({ reason: { code: 'OTHER', note: null } })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.reason).toEqual({ code: 'OTHER', note: null })
  })

  it('rejects a reason code outside the taxonomy', () => {
    expect(cancelBookingSchema.safeParse({ reason: { code: 'BANANA' } }).success).toBe(false)
  })

  it('rejects a note longer than 500 characters', () => {
    const note = 'x'.repeat(501)
    expect(cancelBookingSchema.safeParse({ reason: { code: 'OTHER', note } }).success).toBe(false)
  })
})

// Paid add-ons (#460): the renter selects 0+ of the operator's active add-ons in
// the wizard. The server validates each against the operator + snapshots them.
describe('createBookingSchema walk-in customer (#589 1c)', () => {
  const base = {
    requestedVehicleId: VALID_UUID,
    pickupLocationId: PICKUP_UUID,
    dropoffLocationId: DROPOFF_UUID,
    startAt: '2026-04-10T09:00:00Z',
    endAt: '2026-04-10T17:00:00Z',
  }

  it('accepts an inline walk-in customer (name + phone) in place of renterId', () => {
    const result = createBookingSchema.safeParse({
      ...base,
      source: 'MANUAL',
      walkInCustomer: { name: 'Taro Yamada', phone: '+81-90-1234-5678' },
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.walkInCustomer).toEqual({
        name: 'Taro Yamada',
        phone: '+81-90-1234-5678',
      })
      expect(result.data.renterId).toBeUndefined()
    }
  })

  it('rejects renterId and walkInCustomer together (one customer source, not both)', () => {
    const result = createBookingSchema.safeParse({
      ...base,
      source: 'MANUAL',
      renterId: RENTER_UUID,
      walkInCustomer: { name: 'Taro Yamada', phone: '+81-90-1234-5678' },
    })
    expect(result.success).toBe(false)
  })

  // The mutual-exclusion refine blocks BOTH sources; it must still permit NEITHER —
  // that is the renter self-serve case (the route defaults renterId to ctx.userId).
  it('accepts neither renterId nor walkInCustomer (renter self-serve books as themselves)', () => {
    const result = createBookingSchema.safeParse({ ...base, source: 'DIRECT' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.renterId).toBeUndefined()
      expect(result.data.walkInCustomer).toBeUndefined()
    }
  })

  it('strips an email injected into walkInCustomer (no create-by-email oracle)', () => {
    const result = createBookingSchema.safeParse({
      ...base,
      source: 'MANUAL',
      walkInCustomer: { name: 'Taro', phone: '+81-90-1234-5678', email: 'probe@victim.com' },
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.walkInCustomer).not.toHaveProperty('email')
    }
  })

  it('requires a non-empty phone on a walk-in customer', () => {
    const result = createBookingSchema.safeParse({
      ...base,
      source: 'MANUAL',
      walkInCustomer: { name: 'Taro', phone: '  ' },
    })
    expect(result.success).toBe(false)
  })
})

describe('createBookingSchema addOnIds (#460)', () => {
  const validInput = {
    requestedVehicleId: VALID_UUID,
    pickupLocationId: PICKUP_UUID,
    dropoffLocationId: DROPOFF_UUID,
    startAt: '2026-04-10T09:00:00Z',
    endAt: '2026-04-10T17:00:00Z',
  }
  const ADDON_A = '550e8400-e29b-41d4-a716-446655440010'
  const ADDON_B = '550e8400-e29b-41d4-a716-446655440011'

  it('defaults addOnIds to an empty array when absent', () => {
    const result = createBookingSchema.safeParse(validInput)
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.addOnIds).toEqual([])
  })

  it('accepts a list of add-on UUIDs', () => {
    const result = createBookingSchema.safeParse({ ...validInput, addOnIds: [ADDON_A, ADDON_B] })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.addOnIds).toEqual([ADDON_A, ADDON_B])
  })

  it('rejects a non-UUID add-on id', () => {
    const result = createBookingSchema.safeParse({ ...validInput, addOnIds: ['not-a-uuid'] })
    expect(result.success).toBe(false)
  })
})
