import { describe, expect, it } from 'vitest'
import { cancelBookingSchema, createBookingSchema } from '../../src/validators/booking'

describe('createBookingSchema', () => {
  const validInput = {
    vehicleId: 'vehicle-123',
    startAt: '2026-04-10T09:00:00Z',
    endAt: '2026-04-10T17:00:00Z',
  }

  it('accepts valid input with required fields', () => {
    const result = createBookingSchema.safeParse(validInput)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.source).toBe('DIRECT') // default
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

describe('cancelBookingSchema', () => {
  it('accepts empty object', () => {
    const result = cancelBookingSchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it('accepts reason', () => {
    const result = cancelBookingSchema.safeParse({ reason: 'Flight cancelled' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.reason).toBe('Flight cancelled')
    }
  })
})
