import { describe, expect, it } from 'vitest'
import { createVehicleSchema, updateVehicleSchema } from '../../src/validators/vehicle'

describe('createVehicleSchema', () => {
  const validInput = {
    name: 'Toyota Prius 2022',
    seats: 5,
    transmission: 'AUTO' as const,
  }

  it('accepts valid input with required fields only', () => {
    const result = createVehicleSchema.safeParse(validInput)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.bufferMinutes).toBe(60) // default
    }
  })

  it('accepts valid input with all fields', () => {
    const result = createVehicleSchema.safeParse({
      ...validInput,
      description: 'Compact hybrid',
      fuelType: 'Hybrid',
      bufferMinutes: 90,
      minRentalHours: 2,
      maxRentalHours: 168,
      advanceBookingHours: 24,
    })
    expect(result.success).toBe(true)
  })

  it('rejects empty name', () => {
    const result = createVehicleSchema.safeParse({ ...validInput, name: '' })
    expect(result.success).toBe(false)
  })

  it('rejects zero seats', () => {
    const result = createVehicleSchema.safeParse({ ...validInput, seats: 0 })
    expect(result.success).toBe(false)
  })

  it('rejects invalid transmission', () => {
    const result = createVehicleSchema.safeParse({ ...validInput, transmission: 'CVT' })
    expect(result.success).toBe(false)
  })

  it('accepts valid photo URLs', () => {
    const result = createVehicleSchema.safeParse({
      ...validInput,
      photos: ['https://example.com/car.jpg', 'https://cdn.kuruma.jp/photo.png'],
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.photos).toEqual([
        'https://example.com/car.jpg',
        'https://cdn.kuruma.jp/photo.png',
      ])
    }
  })

  it('defaults photos to empty array when omitted', () => {
    const result = createVehicleSchema.safeParse(validInput)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.photos).toEqual([])
    }
  })

  it('rejects non-URL strings in photos array', () => {
    const result = createVehicleSchema.safeParse({
      ...validInput,
      photos: ['not-a-url'],
    })
    expect(result.success).toBe(false)
  })

  it('rejects negative bufferMinutes', () => {
    const result = createVehicleSchema.safeParse({ ...validInput, bufferMinutes: -10 })
    expect(result.success).toBe(false)
  })
})

describe('updateVehicleSchema', () => {
  it('accepts partial input', () => {
    const result = updateVehicleSchema.safeParse({ name: 'Updated Name' })
    expect(result.success).toBe(true)
  })

  it('accepts empty object', () => {
    const result = updateVehicleSchema.safeParse({})
    expect(result.success).toBe(true)
  })
})
