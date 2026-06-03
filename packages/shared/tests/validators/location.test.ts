import { describe, expect, it } from 'vitest'
import {
  createLocationSchema,
  platformAdminCreateLocationSchema,
  updateLocationSchema,
} from '../../src/validators/location'

function validInput() {
  return {
    name: 'Osaka Namba',
    address: '1-2-3 Namba, Chuo-ku, Osaka',
  }
}

describe('createLocationSchema', () => {
  it('accepts valid input with required fields only', () => {
    const result = createLocationSchema.safeParse(validInput())
    expect(result.success).toBe(true)
  })

  it('defaults timezone to Asia/Tokyo', () => {
    const result = createLocationSchema.safeParse(validInput())
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.timezone).toBe('Asia/Tokyo')
  })

  it('defaults turnaround to 2880 (48h)', () => {
    const result = createLocationSchema.safeParse(validInput())
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.defaultTurnaroundMinutes).toBe(2880)
  })

  it('defaults operatingHours to null when omitted', () => {
    const result = createLocationSchema.safeParse(validInput())
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.operatingHours).toBeNull()
  })

  it('rejects empty name', () => {
    const result = createLocationSchema.safeParse({ ...validInput(), name: '' })
    expect(result.success).toBe(false)
  })

  it('rejects name over 200 chars', () => {
    const result = createLocationSchema.safeParse({ ...validInput(), name: 'a'.repeat(201) })
    expect(result.success).toBe(false)
  })

  it('rejects empty address', () => {
    const result = createLocationSchema.safeParse({ ...validInput(), address: '' })
    expect(result.success).toBe(false)
  })

  it('rejects address over 500 chars', () => {
    const result = createLocationSchema.safeParse({ ...validInput(), address: 'a'.repeat(501) })
    expect(result.success).toBe(false)
  })

  it('rejects negative turnaround', () => {
    const result = createLocationSchema.safeParse({ ...validInput(), defaultTurnaroundMinutes: -1 })
    expect(result.success).toBe(false)
  })

  it('rejects non-integer turnaround', () => {
    const result = createLocationSchema.safeParse({
      ...validInput(),
      defaultTurnaroundMinutes: 30.5,
    })
    expect(result.success).toBe(false)
  })

  it('accepts zero turnaround (no cooldown)', () => {
    const result = createLocationSchema.safeParse({ ...validInput(), defaultTurnaroundMinutes: 0 })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.defaultTurnaroundMinutes).toBe(0)
  })

  it('rejects an invalid IANA timezone', () => {
    const result = createLocationSchema.safeParse({ ...validInput(), timezone: 'Mars/Phobos' })
    expect(result.success).toBe(false)
  })

  it('accepts a valid non-default IANA timezone', () => {
    const result = createLocationSchema.safeParse({ ...validInput(), timezone: 'America/New_York' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.timezone).toBe('America/New_York')
  })

  it('accepts a well-formed operating-hours pair', () => {
    const result = createLocationSchema.safeParse({
      ...validInput(),
      operatingHours: { openTime: '09:00', closeTime: '20:00' },
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.operatingHours).toEqual({ openTime: '09:00', closeTime: '20:00' })
    }
  })

  it('accepts null operating hours explicitly', () => {
    const result = createLocationSchema.safeParse({ ...validInput(), operatingHours: null })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.operatingHours).toBeNull()
  })

  it('rejects operating hours with malformed openTime', () => {
    const result = createLocationSchema.safeParse({
      ...validInput(),
      operatingHours: { openTime: '9am', closeTime: '20:00' },
    })
    expect(result.success).toBe(false)
  })

  it('rejects operating hours with out-of-range closeTime', () => {
    const result = createLocationSchema.safeParse({
      ...validInput(),
      operatingHours: { openTime: '09:00', closeTime: '24:00' },
    })
    expect(result.success).toBe(false)
  })

  it('rejects operating hours missing closeTime', () => {
    const result = createLocationSchema.safeParse({
      ...validInput(),
      operatingHours: { openTime: '09:00' },
    })
    expect(result.success).toBe(false)
  })

  it('does not accept an operatorId in the operator-caller schema', () => {
    const result = createLocationSchema.safeParse({ ...validInput(), operatorId: 'op_x' })
    // operatorId is stripped (not part of the schema) — the route stamps it.
    expect(result.success).toBe(true)
    if (result.success) {
      expect((result.data as Record<string, unknown>).operatorId).toBeUndefined()
    }
  })
})

describe('platformAdminCreateLocationSchema', () => {
  it('requires operatorId', () => {
    const result = platformAdminCreateLocationSchema.safeParse(validInput())
    expect(result.success).toBe(false)
  })

  it('accepts when operatorId is present', () => {
    const result = platformAdminCreateLocationSchema.safeParse({
      ...validInput(),
      operatorId: 'op_best_car_rental',
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.operatorId).toBe('op_best_car_rental')
  })

  it('rejects an empty operatorId', () => {
    const result = platformAdminCreateLocationSchema.safeParse({ ...validInput(), operatorId: '' })
    expect(result.success).toBe(false)
  })
})

describe('updateLocationSchema', () => {
  it('accepts a partial update', () => {
    const result = updateLocationSchema.safeParse({ name: 'Osaka Umeda' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.name).toBe('Osaka Umeda')
  })

  it('accepts an empty object without injecting defaults', () => {
    const result = updateLocationSchema.safeParse({})
    expect(result.success).toBe(true)
    if (result.success) {
      // PATCH must not silently reset unspecified fields.
      expect(result.data.timezone).toBeUndefined()
      expect(result.data.defaultTurnaroundMinutes).toBeUndefined()
      expect(result.data.operatingHours).toBeUndefined()
    }
  })

  it('still validates HH:mm on operating hours when present', () => {
    const result = updateLocationSchema.safeParse({
      operatingHours: { openTime: '99:99', closeTime: '20:00' },
    })
    expect(result.success).toBe(false)
  })

  it('still rejects negative turnaround on update', () => {
    const result = updateLocationSchema.safeParse({ defaultTurnaroundMinutes: -5 })
    expect(result.success).toBe(false)
  })
})
