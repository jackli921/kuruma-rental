import { describe, expect, test } from 'vitest'
import { createVehicleSchema, updateVehicleSchema } from '../../src/validators/vehicle'

const validBase = {
  name: 'Test Car',
  seats: 5,
  transmission: 'AUTO' as const,
  dailyRateJpy: 5000,
}

describe('vehicle expiry date validation', () => {
  test('createVehicleSchema accepts valid YYYY-MM-DD shakenExpiryDate', () => {
    const result = createVehicleSchema.safeParse({
      ...validBase,
      shakenExpiryDate: '2027-06-15',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.shakenExpiryDate).toBe('2027-06-15')
    }
  })

  test('createVehicleSchema accepts null shakenExpiryDate', () => {
    const result = createVehicleSchema.safeParse({
      ...validBase,
      shakenExpiryDate: null,
    })
    expect(result.success).toBe(true)
  })

  test('createVehicleSchema accepts omitted shakenExpiryDate (undefined)', () => {
    const result = createVehicleSchema.safeParse(validBase)
    expect(result.success).toBe(true)
  })

  test('createVehicleSchema rejects malformed date string', () => {
    const result = createVehicleSchema.safeParse({
      ...validBase,
      shakenExpiryDate: '2027/06/15',
    })
    expect(result.success).toBe(false)
  })

  test('createVehicleSchema accepts valid insuranceExpiryDate', () => {
    const result = createVehicleSchema.safeParse({
      ...validBase,
      insuranceExpiryDate: '2027-01-01',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.insuranceExpiryDate).toBe('2027-01-01')
    }
  })

  test('createVehicleSchema rejects malformed insuranceExpiryDate', () => {
    const result = createVehicleSchema.safeParse({
      ...validBase,
      insuranceExpiryDate: 'Jan 1 2027',
    })
    expect(result.success).toBe(false)
  })

  test('updateVehicleSchema accepts partial patch with only shakenExpiryDate', () => {
    const result = updateVehicleSchema.safeParse({
      shakenExpiryDate: '2028-03-01',
    })
    expect(result.success).toBe(true)
  })
})
