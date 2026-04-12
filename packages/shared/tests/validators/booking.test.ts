import { describe, expect, it } from 'vitest'
import { createBookingSchema, updateBookingStatusSchema } from '../../src/validators/booking'

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000'

describe('createBookingSchema', () => {
  const validInput = {
    vehicleId: VALID_UUID,
    startAt: '2026-04-10T09:00:00Z',
    endAt: '2026-04-10T17:00:00Z',
  }

  it('accepts valid input with required fields', () => {
    const result = createBookingSchema.safeParse(validInput)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.source).toBe('DIRECT')
    }
  })

  it('accepts valid input with all fields', () => {
    const result = createBookingSchema.safeParse({
      ...validInput,
      notes: 'Arriving at KIX',
      source: 'TRIP_COM',
      externalId: 'TC-12345',
    })
    expect(result.success).toBe(true)
  })

  it('rejects non-UUID vehicleId', () => {
    const result = createBookingSchema.safeParse({ ...validInput, vehicleId: 'vehicle-123' })
    expect(result.success).toBe(false)
  })

  it('rejects missing vehicleId', () => {
    const { vehicleId, ...rest } = validInput
    const result = createBookingSchema.safeParse(rest)
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
