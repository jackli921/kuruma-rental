import { describe, expect, it } from 'vitest'
import { createBookingSchema, updateBookingStatusSchema } from '../../src/validators/booking'

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000'
const VALID_CLASS_UUID = '550e8400-e29b-41d4-a716-446655440001'

describe('createBookingSchema', () => {
  const validInput = {
    classId: VALID_CLASS_UUID,
    startAt: '2026-04-10T09:00:00Z',
    endAt: '2026-04-10T17:00:00Z',
  }

  it('accepts valid input with required fields (classId only, no vehicleId)', () => {
    const result = createBookingSchema.safeParse(validInput)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.classId).toBe(VALID_CLASS_UUID)
      expect(result.data.vehicleId).toBeUndefined()
      expect(result.data.source).toBe('DIRECT')
    }
  })

  it('accepts valid input with classId + optional vehicleId', () => {
    const result = createBookingSchema.safeParse({
      ...validInput,
      vehicleId: VALID_UUID,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.vehicleId).toBe(VALID_UUID)
    }
  })

  it('accepts valid input with all fields', () => {
    const result = createBookingSchema.safeParse({
      ...validInput,
      vehicleId: VALID_UUID,
      notes: 'Arriving at KIX',
      source: 'TRIP_COM',
      externalId: 'TC-12345',
    })
    expect(result.success).toBe(true)
  })

  it('rejects non-UUID classId', () => {
    const result = createBookingSchema.safeParse({ ...validInput, classId: 'class-123' })
    expect(result.success).toBe(false)
  })

  it('rejects missing classId', () => {
    const { classId, ...rest } = validInput
    const result = createBookingSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })

  it('rejects non-UUID vehicleId when provided', () => {
    const result = createBookingSchema.safeParse({ ...validInput, vehicleId: 'vehicle-123' })
    expect(result.success).toBe(false)
  })

  it('rejects invalid datetime format', () => {
    const result = createBookingSchema.safeParse({ ...validInput, startAt: 'not-a-date' })
    expect(result.success).toBe(false)
  })

  it('rejects endAt before startAt', () => {
    const result = createBookingSchema.safeParse({
      ...validInput,
      startAt: '2026-04-10T17:00:00Z',
      endAt: '2026-04-10T09:00:00Z',
    })
    expect(result.success).toBe(false)
  })

  it('rejects invalid source enum', () => {
    const result = createBookingSchema.safeParse({ ...validInput, source: 'AIRBNB' })
    expect(result.success).toBe(false)
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
      const result = updateBookingStatusSchema.safeParse({ status })
      expect(result.success).toBe(true)
    }
  })

  it('rejects invalid status', () => {
    const result = updateBookingStatusSchema.safeParse({ status: 'BANANA' })
    expect(result.success).toBe(false)
  })

  it('rejects empty status', () => {
    const result = updateBookingStatusSchema.safeParse({ status: '' })
    expect(result.success).toBe(false)
  })
})
