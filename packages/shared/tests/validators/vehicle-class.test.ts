import { describe, expect, it } from 'vitest'
import {
  createVehicleClassSchema,
  updateVehicleClassSchema,
} from '../../src/validators/vehicle-class'

function validInput() {
  return {
    name: 'Compact',
    slug: 'compact',
    seats: 5,
    luggageCapacity: 2,
    transmission: 'AUTO' as const,
    dailyRateJpy: 5500,
  }
}

describe('createVehicleClassSchema', () => {
  it('accepts valid input with required fields only', () => {
    const result = createVehicleClassSchema.safeParse(validInput())
    expect(result.success).toBe(true)
  })

  it('defaults photos to empty array', () => {
    const result = createVehicleClassSchema.safeParse(validInput())
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.photos).toEqual([])
  })

  it('defaults sortOrder to 0', () => {
    const result = createVehicleClassSchema.safeParse(validInput())
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.sortOrder).toBe(0)
  })

  it('rejects empty name', () => {
    const result = createVehicleClassSchema.safeParse({ ...validInput(), name: '' })
    expect(result.success).toBe(false)
  })

  it('rejects slug with uppercase', () => {
    const result = createVehicleClassSchema.safeParse({ ...validInput(), slug: 'Compact' })
    expect(result.success).toBe(false)
  })

  it('rejects slug with spaces', () => {
    const result = createVehicleClassSchema.safeParse({ ...validInput(), slug: 'my class' })
    expect(result.success).toBe(false)
  })

  it('rejects slug with trailing hyphen', () => {
    const result = createVehicleClassSchema.safeParse({ ...validInput(), slug: 'compact-' })
    expect(result.success).toBe(false)
  })

  it('accepts valid slug with hyphens', () => {
    const result = createVehicleClassSchema.safeParse({ ...validInput(), slug: 'k-car' })
    expect(result.success).toBe(true)
  })

  it('rejects zero seats', () => {
    const result = createVehicleClassSchema.safeParse({ ...validInput(), seats: 0 })
    expect(result.success).toBe(false)
  })

  it('rejects negative luggage capacity', () => {
    const result = createVehicleClassSchema.safeParse({ ...validInput(), luggageCapacity: -1 })
    expect(result.success).toBe(false)
  })

  it('rejects when both rates are missing', () => {
    const input = { ...validInput(), dailyRateJpy: undefined, hourlyRateJpy: undefined }
    const result = createVehicleClassSchema.safeParse(input)
    expect(result.success).toBe(false)
  })

  it('accepts when only hourly rate is set', () => {
    const input = { ...validInput(), dailyRateJpy: undefined, hourlyRateJpy: 1000 }
    const result = createVehicleClassSchema.safeParse(input)
    expect(result.success).toBe(true)
  })

  it('accepts zero rate (free promo)', () => {
    const result = createVehicleClassSchema.safeParse({ ...validInput(), dailyRateJpy: 0 })
    expect(result.success).toBe(true)
  })

  it('rejects negative rate', () => {
    const result = createVehicleClassSchema.safeParse({ ...validInput(), dailyRateJpy: -100 })
    expect(result.success).toBe(false)
  })

  it('rejects non-integer rate', () => {
    const result = createVehicleClassSchema.safeParse({ ...validInput(), dailyRateJpy: 55.5 })
    expect(result.success).toBe(false)
  })
})

describe('updateVehicleClassSchema', () => {
  it('accepts partial update', () => {
    const result = updateVehicleClassSchema.safeParse({ name: 'SUV' })
    expect(result.success).toBe(true)
  })

  it('accepts empty object', () => {
    const result = updateVehicleClassSchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it('rejects both rates null when both keys present', () => {
    const result = updateVehicleClassSchema.safeParse({
      dailyRateJpy: null,
      hourlyRateJpy: null,
    })
    expect(result.success).toBe(false)
  })

  it('allows nullifying one rate when other not present', () => {
    const result = updateVehicleClassSchema.safeParse({ dailyRateJpy: null })
    expect(result.success).toBe(true)
  })
})
