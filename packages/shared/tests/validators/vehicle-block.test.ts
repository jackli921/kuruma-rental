import { describe, expect, it } from 'vitest'
import { createVehicleBlockSchema } from '../../src/validators/vehicle-block'

const validInput = {
  kind: 'MAINTENANCE',
  reason: 'Annual shaken inspection',
  startAt: '2026-07-01T09:00:00.000Z',
  endAt: '2026-07-01T17:00:00.000Z',
  notes: 'Drop at Osaka depot',
}

describe('createVehicleBlockSchema', () => {
  it('parses a well-formed block and preserves every field', () => {
    const result = createVehicleBlockSchema.safeParse(validInput)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toEqual(validInput)
    }
  })

  it('drops a client-supplied operatorId/vehicleId (server-derived, never trusted)', () => {
    const result = createVehicleBlockSchema.safeParse({
      ...validInput,
      operatorId: 'attacker-operator',
      vehicleId: 'attacker-vehicle',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).not.toHaveProperty('operatorId')
      expect(result.data).not.toHaveProperty('vehicleId')
    }
  })

  it('accepts a block with no notes (optional)', () => {
    const { notes: _notes, ...withoutNotes } = validInput
    const result = createVehicleBlockSchema.safeParse(withoutNotes)
    expect(result.success).toBe(true)
  })

  it('rejects an unknown kind', () => {
    const result = createVehicleBlockSchema.safeParse({ ...validInput, kind: 'HOLIDAY' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.kind).toBeDefined()
    }
  })

  it('rejects an empty reason', () => {
    const result = createVehicleBlockSchema.safeParse({ ...validInput, reason: '   ' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.reason).toBeDefined()
    }
  })

  it('rejects a non-ISO startAt', () => {
    const result = createVehicleBlockSchema.safeParse({ ...validInput, startAt: '2026-07-01' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.startAt).toBeDefined()
    }
  })

  it('rejects endAt equal to or before startAt (the refine, reported on endAt)', () => {
    const equal = createVehicleBlockSchema.safeParse({ ...validInput, endAt: validInput.startAt })
    expect(equal.success).toBe(false)
    if (!equal.success) {
      expect(equal.error.flatten().fieldErrors.endAt).toBeDefined()
    }
  })
})
