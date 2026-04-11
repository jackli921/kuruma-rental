import { describe, expect, it } from 'vitest'
import { createVehicleSchema, updateVehicleSchema } from '../../src/validators/vehicle'

describe('createVehicleSchema', () => {
  const validInput = {
    name: 'Toyota Prius 2022',
    seats: 5,
    transmission: 'AUTO' as const,
    // Issue #48: at least one of dailyRateJpy / hourlyRateJpy is required,
    // so the canonical "valid" fixture must include a rate.
    dailyRateJpy: 8000,
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

  // Issue #48: pricing rules.
  describe('pricing (dailyRateJpy / hourlyRateJpy)', () => {
    // Strip the rate from validInput so we can add rates per-test.
    const { dailyRateJpy: _d, ...noRate } = validInput

    it('rejects when both rates are missing', () => {
      const result = createVehicleSchema.safeParse(noRate)
      expect(result.success).toBe(false)
      if (!result.success) {
        const messages = result.error.issues.map((i) => i.message).join(' ')
        expect(messages).toMatch(/rate/i)
      }
    })

    it('rejects when both rates are explicitly null', () => {
      const result = createVehicleSchema.safeParse({
        ...noRate,
        dailyRateJpy: null,
        hourlyRateJpy: null,
      })
      expect(result.success).toBe(false)
    })

    it('accepts when only dailyRateJpy is set', () => {
      const result = createVehicleSchema.safeParse({ ...noRate, dailyRateJpy: 8000 })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.dailyRateJpy).toBe(8000)
        expect(result.data.hourlyRateJpy).toBeUndefined()
      }
    })

    it('accepts when only hourlyRateJpy is set', () => {
      const result = createVehicleSchema.safeParse({ ...noRate, hourlyRateJpy: 1200 })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.hourlyRateJpy).toBe(1200)
        expect(result.data.dailyRateJpy).toBeUndefined()
      }
    })

    it('accepts when both rates are set', () => {
      const result = createVehicleSchema.safeParse({
        ...noRate,
        dailyRateJpy: 8000,
        hourlyRateJpy: 1200,
      })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.dailyRateJpy).toBe(8000)
        expect(result.data.hourlyRateJpy).toBe(1200)
      }
    })

    it('accepts zero as a valid rate (free promo)', () => {
      const result = createVehicleSchema.safeParse({ ...noRate, dailyRateJpy: 0 })
      expect(result.success).toBe(true)
    })

    it('rejects negative dailyRateJpy', () => {
      const result = createVehicleSchema.safeParse({ ...noRate, dailyRateJpy: -100 })
      expect(result.success).toBe(false)
    })

    it('rejects negative hourlyRateJpy', () => {
      const result = createVehicleSchema.safeParse({ ...noRate, hourlyRateJpy: -50 })
      expect(result.success).toBe(false)
    })

    it('rejects non-integer rates', () => {
      const result = createVehicleSchema.safeParse({ ...noRate, dailyRateJpy: 8000.5 })
      expect(result.success).toBe(false)
    })
  })

  // Issue #50: rental rules.
  describe('rental rules (minRentalHours / maxRentalHours / advanceBookingHours)', () => {
    it('accepts when all three are unset', () => {
      const result = createVehicleSchema.safeParse(validInput)
      expect(result.success).toBe(true)
    })

    it('accepts minRentalHours set without maxRentalHours', () => {
      const result = createVehicleSchema.safeParse({ ...validInput, minRentalHours: 4 })
      expect(result.success).toBe(true)
    })

    it('accepts maxRentalHours set without minRentalHours', () => {
      const result = createVehicleSchema.safeParse({ ...validInput, maxRentalHours: 72 })
      expect(result.success).toBe(true)
    })

    it('accepts advanceBookingHours set alone', () => {
      const result = createVehicleSchema.safeParse({ ...validInput, advanceBookingHours: 24 })
      expect(result.success).toBe(true)
    })

    it('accepts when min <= max', () => {
      const result = createVehicleSchema.safeParse({
        ...validInput,
        minRentalHours: 4,
        maxRentalHours: 72,
      })
      expect(result.success).toBe(true)
    })

    it('accepts when min equals max (exact boundary)', () => {
      const result = createVehicleSchema.safeParse({
        ...validInput,
        minRentalHours: 24,
        maxRentalHours: 24,
      })
      expect(result.success).toBe(true)
    })

    it('rejects when minRentalHours > maxRentalHours', () => {
      const result = createVehicleSchema.safeParse({
        ...validInput,
        minRentalHours: 10,
        maxRentalHours: 5,
      })
      expect(result.success).toBe(false)
      if (!result.success) {
        const messages = result.error.issues.map((i) => i.message).join(' ')
        expect(messages).toMatch(/minimum/i)
        expect(messages).toMatch(/maximum/i)
        // Error should be attached to a rental-rules field, not a pricing field.
        const paths = result.error.issues.map((i) => i.path.join('.'))
        expect(
          paths.some((p) => p.includes('minRentalHours') || p.includes('maxRentalHours')),
        ).toBe(true)
      }
    })

    it('rejects zero minRentalHours (must be at least 1 hour)', () => {
      const result = createVehicleSchema.safeParse({ ...validInput, minRentalHours: 0 })
      expect(result.success).toBe(false)
    })

    it('rejects negative advanceBookingHours', () => {
      const result = createVehicleSchema.safeParse({ ...validInput, advanceBookingHours: -1 })
      expect(result.success).toBe(false)
    })

    it('rejects non-integer minRentalHours', () => {
      const result = createVehicleSchema.safeParse({ ...validInput, minRentalHours: 4.5 })
      expect(result.success).toBe(false)
    })
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
