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

  describe('acrissCode', () => {
    it('accepts a valid 4-char code', () => {
      const result = createVehicleClassSchema.safeParse({ ...validInput(), acrissCode: 'CCAR' })
      expect(result.success).toBe(true)
      if (result.success) expect(result.data.acrissCode).toBe('CCAR')
    })

    it('uppercases a lowercase code', () => {
      const result = createVehicleClassSchema.safeParse({ ...validInput(), acrissCode: 'ccar' })
      expect(result.success).toBe(true)
      if (result.success) expect(result.data.acrissCode).toBe('CCAR')
    })

    it('trims surrounding whitespace before validating', () => {
      const result = createVehicleClassSchema.safeParse({ ...validInput(), acrissCode: '  ccar ' })
      expect(result.success).toBe(true)
      if (result.success) expect(result.data.acrissCode).toBe('CCAR')
    })

    it('rejects a 3-char code', () => {
      const result = createVehicleClassSchema.safeParse({ ...validInput(), acrissCode: 'CCA' })
      expect(result.success).toBe(false)
    })

    it('rejects a 5-char code', () => {
      const result = createVehicleClassSchema.safeParse({ ...validInput(), acrissCode: 'CCARX' })
      expect(result.success).toBe(false)
    })

    it('rejects a code with a hyphen', () => {
      const result = createVehicleClassSchema.safeParse({ ...validInput(), acrissCode: 'cc-r' })
      expect(result.success).toBe(false)
    })

    it('accepts null (operator-created class without a mapped code)', () => {
      const result = createVehicleClassSchema.safeParse({ ...validInput(), acrissCode: null })
      expect(result.success).toBe(true)
      if (result.success) expect(result.data.acrissCode).toBeNull()
    })

    it('accepts an omitted code', () => {
      const result = createVehicleClassSchema.safeParse(validInput())
      expect(result.success).toBe(true)
    })

    it('accepts a format-valid code outside the 8-code seed subset', () => {
      // The validator gates on format only, not the dictionary — operators may
      // legitimately enter codes we have not mapped yet.
      const result = createVehicleClassSchema.safeParse({ ...validInput(), acrissCode: 'IFAR' })
      expect(result.success).toBe(true)
      if (result.success) expect(result.data.acrissCode).toBe('IFAR')
    })
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

  it('accepts an acrissCode patch (flows from the base schema)', () => {
    const result = updateVehicleClassSchema.safeParse({ acrissCode: 'icar' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.acrissCode).toBe('ICAR')
  })

  it('rejects a malformed acrissCode patch', () => {
    const result = updateVehicleClassSchema.safeParse({ acrissCode: 'CCARX' })
    expect(result.success).toBe(false)
  })

  it('allows nullifying acrissCode', () => {
    const result = updateVehicleClassSchema.safeParse({ acrissCode: null })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.acrissCode).toBeNull()
  })

  it('drops operatorId — it is not patchable (cross-operator move guard)', () => {
    // operatorId lives only on the create .extend(), never the update schema.
    // A PATCH that smuggles it in must not reassign the class's tenant.
    const result = updateVehicleClassSchema.safeParse({ operatorId: 'op_other', name: 'X' })
    expect(result.success).toBe(true)
    if (result.success) expect('operatorId' in result.data).toBe(false)
  })

  it('does NOT inject photos/sortOrder defaults on a partial patch (issue #430)', () => {
    // .partial() does not strip .default(), so a name-only patch used to come
    // back as { name, photos: [], sortOrder: 0 } and wipe those columns on write.
    const result = updateVehicleClassSchema.safeParse({ name: 'Renamed' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toEqual({ name: 'Renamed' })
      expect('photos' in result.data).toBe(false)
      expect('sortOrder' in result.data).toBe(false)
    }
  })

  it('passes photos/sortOrder through when explicitly provided', () => {
    const result = updateVehicleClassSchema.safeParse({
      photos: ['https://cdn.example.com/a.jpg'],
      sortOrder: 7,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.photos).toEqual(['https://cdn.example.com/a.jpg'])
      expect(result.data.sortOrder).toBe(7)
    }
  })
})
