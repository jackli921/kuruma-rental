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

  it('rejects turnaround below the 60-minute floor', () => {
    for (const minutes of [0, 30, 59]) {
      const result = createLocationSchema.safeParse({
        ...validInput(),
        defaultTurnaroundMinutes: minutes,
      })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0]?.message).toBe('Turnaround must be at least 60 minutes')
      }
    }
  })

  it('accepts turnaround at the 60-minute floor', () => {
    const result = createLocationSchema.safeParse({ ...validInput(), defaultTurnaroundMinutes: 60 })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.defaultTurnaroundMinutes).toBe(60)
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

  it('rejects an inverted operating-hours range (close before open)', () => {
    // The MVP shape is a single same-day pair; overnight/wrap-around is not
    // modeled yet, so 20:00 -> 08:00 is a typo, not an overnight window.
    const result = createLocationSchema.safeParse({
      ...validInput(),
      operatingHours: { openTime: '20:00', closeTime: '08:00' },
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('closeTime must be after openTime')
    }
  })

  it('rejects an empty operating-hours range (open equals close)', () => {
    const result = createLocationSchema.safeParse({
      ...validInput(),
      operatingHours: { openTime: '09:00', closeTime: '09:00' },
    })
    expect(result.success).toBe(false)
  })

  it('attaches the inverted-range error to operatingHours.closeTime', () => {
    // The form renders child errors under openTime/closeTime, not at the object
    // level, so the cross-field message must land on a rendered subfield (#387
    // PR review) or it fails silently.
    const result = createLocationSchema.safeParse({
      ...validInput(),
      operatingHours: { openTime: '20:00', closeTime: '08:00' },
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['operatingHours', 'closeTime'])
    }
  })

  it('defaults regionId to null when omitted (#394)', () => {
    const result = createLocationSchema.safeParse(validInput())
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.regionId).toBeNull()
  })

  it('accepts a valid uuid regionId (#394)', () => {
    const regionId = '11111111-1111-4111-8111-111111111111'
    const result = createLocationSchema.safeParse({ ...validInput(), regionId })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.regionId).toBe(regionId)
  })

  it('accepts an explicit null regionId (#394)', () => {
    const result = createLocationSchema.safeParse({ ...validInput(), regionId: null })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.regionId).toBeNull()
  })

  it('rejects a non-uuid regionId (#394)', () => {
    const result = createLocationSchema.safeParse({ ...validInput(), regionId: 'reg_osaka' })
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

  it('rejects an inverted operating-hours range on update', () => {
    const result = updateLocationSchema.safeParse({
      operatingHours: { openTime: '22:00', closeTime: '06:00' },
    })
    expect(result.success).toBe(false)
  })

  it('still rejects negative turnaround on update', () => {
    const result = updateLocationSchema.safeParse({ defaultTurnaroundMinutes: -5 })
    expect(result.success).toBe(false)
  })

  it('accepts a regionId update (#394)', () => {
    const regionId = '22222222-2222-4222-8222-222222222222'
    const result = updateLocationSchema.safeParse({ regionId })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.regionId).toBe(regionId)
  })

  it('accepts a null regionId to clear the region (#394)', () => {
    const result = updateLocationSchema.safeParse({ regionId: null })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.regionId).toBeNull()
  })

  it('leaves regionId undefined on an empty patch — no reset (#394)', () => {
    const result = updateLocationSchema.safeParse({})
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.regionId).toBeUndefined()
  })

  it('rejects a non-uuid regionId on update (#394)', () => {
    const result = updateLocationSchema.safeParse({ regionId: 'not-a-uuid' })
    expect(result.success).toBe(false)
  })
})

describe('location coordinates (#531)', () => {
  const NAMBA = { latitude: 34.6659, longitude: 135.5018 }

  describe('on create', () => {
    it('accepts a valid lat/lng pair and exposes both', () => {
      const result = createLocationSchema.safeParse({ ...validInput(), ...NAMBA })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.latitude).toBe(34.6659)
        expect(result.data.longitude).toBe(135.5018)
      }
    })

    it('rejects a latitude without a longitude (pair rule)', () => {
      const result = createLocationSchema.safeParse({ ...validInput(), latitude: 34.6659 })
      expect(result.success).toBe(false)
    })

    it('rejects a longitude without a latitude (pair rule)', () => {
      const result = createLocationSchema.safeParse({ ...validInput(), longitude: 135.5018 })
      expect(result.success).toBe(false)
    })

    it('rejects one-null-one-number as a broken pair', () => {
      const result = createLocationSchema.safeParse({
        ...validInput(),
        latitude: 34.6659,
        longitude: null,
      })
      expect(result.success).toBe(false)
    })

    it('rejects latitude above 90', () => {
      const result = createLocationSchema.safeParse({
        ...validInput(),
        latitude: 90.1,
        longitude: 0,
      })
      expect(result.success).toBe(false)
    })

    it('rejects latitude below -90', () => {
      const result = createLocationSchema.safeParse({
        ...validInput(),
        latitude: -90.1,
        longitude: 0,
      })
      expect(result.success).toBe(false)
    })

    it('rejects longitude above 180', () => {
      const result = createLocationSchema.safeParse({
        ...validInput(),
        latitude: 0,
        longitude: 180.1,
      })
      expect(result.success).toBe(false)
    })

    it('rejects longitude below -180', () => {
      const result = createLocationSchema.safeParse({
        ...validInput(),
        latitude: 0,
        longitude: -180.1,
      })
      expect(result.success).toBe(false)
    })

    it('rejects NaN latitude', () => {
      const result = createLocationSchema.safeParse({
        ...validInput(),
        latitude: Number.NaN,
        longitude: 135,
      })
      expect(result.success).toBe(false)
    })

    it('rejects non-finite longitude', () => {
      const result = createLocationSchema.safeParse({
        ...validInput(),
        latitude: 34,
        longitude: Number.POSITIVE_INFINITY,
      })
      expect(result.success).toBe(false)
    })

    it('accepts an explicit null pair (no coords)', () => {
      const result = createLocationSchema.safeParse({
        ...validInput(),
        latitude: null,
        longitude: null,
      })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.latitude).toBeNull()
        expect(result.data.longitude).toBeNull()
      }
    })

    it('strips a client-sent coordinateSource (server-derived only)', () => {
      const result = createLocationSchema.safeParse({
        ...validInput(),
        ...NAMBA,
        coordinateSource: 'MANUAL',
      })
      expect(result.success).toBe(true)
      if (result.success) {
        expect((result.data as Record<string, unknown>).coordinateSource).toBeUndefined()
      }
    })
  })

  describe('on update', () => {
    it('accepts a coord pair', () => {
      const result = updateLocationSchema.safeParse({ ...NAMBA })
      expect(result.success).toBe(true)
      if (result.success) expect(result.data.latitude).toBe(34.6659)
    })

    it('rejects a half pair (latitude only)', () => {
      const result = updateLocationSchema.safeParse({ latitude: 34.6659 })
      expect(result.success).toBe(false)
    })

    it('accepts a null pair to clear coords', () => {
      const result = updateLocationSchema.safeParse({ latitude: null, longitude: null })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.latitude).toBeNull()
        expect(result.data.longitude).toBeNull()
      }
    })

    it('accepts regeocode:true', () => {
      const result = updateLocationSchema.safeParse({ regeocode: true })
      expect(result.success).toBe(true)
      if (result.success) expect(result.data.regeocode).toBe(true)
    })

    it('strips a client-sent coordinateSource', () => {
      const result = updateLocationSchema.safeParse({ coordinateSource: 'GEOCODED' })
      expect(result.success).toBe(true)
      if (result.success) {
        expect((result.data as Record<string, unknown>).coordinateSource).toBeUndefined()
      }
    })
  })
})
