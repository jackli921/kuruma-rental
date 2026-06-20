import { describe, expect, test } from 'vitest'
import { createVehicleSchema, updateVehicleSchema } from '../../src/validators/vehicle'

// §5.0 / #916: a marketplace listing must be a road-legal car, so a create now
// REQUIRES both shaken and insurance, each a valid YYYY-MM-DD that is not in
// the past. The DB column stays nullable (legacy/lapsed rows tolerated, gated
// out at runtime) — this is the create-time door, not a NOT NULL constraint.
const FUTURE_SHAKEN = '2099-06-15'
const FUTURE_INSURANCE = '2099-01-01'
const PAST_DATE = '2020-01-01'

const validCreate = {
  name: 'Test Car',
  seats: 5,
  transmission: 'AUTO' as const,
  dailyRateJpy: 5000,
  shakenExpiryDate: FUTURE_SHAKEN,
  insuranceExpiryDate: FUTURE_INSURANCE,
}

describe('vehicle create requires valid, future-dated shaken + insurance (§5.0)', () => {
  test('accepts a create with both documents future-dated', () => {
    const result = createVehicleSchema.safeParse(validCreate)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.shakenExpiryDate).toBe(FUTURE_SHAKEN)
      expect(result.data.insuranceExpiryDate).toBe(FUTURE_INSURANCE)
    }
  })

  test('rejects a create with shakenExpiryDate omitted', () => {
    const { shakenExpiryDate: _omit, ...noShaken } = validCreate
    expect(createVehicleSchema.safeParse(noShaken).success).toBe(false)
  })

  test('rejects a create with insuranceExpiryDate null', () => {
    expect(
      createVehicleSchema.safeParse({ ...validCreate, insuranceExpiryDate: null }).success,
    ).toBe(false)
  })

  test('rejects a create with a past-dated shaken', () => {
    expect(
      createVehicleSchema.safeParse({ ...validCreate, shakenExpiryDate: PAST_DATE }).success,
    ).toBe(false)
  })

  test('rejects a malformed date string', () => {
    expect(
      createVehicleSchema.safeParse({ ...validCreate, shakenExpiryDate: '2027/06/15' }).success,
    ).toBe(false)
  })
})

describe('vehicle update keeps documents editable but future-dated (renewal)', () => {
  test('accepts a partial patch renewing shaken to a future date', () => {
    expect(updateVehicleSchema.safeParse({ shakenExpiryDate: '2099-03-01' }).success).toBe(true)
  })

  test('rejects a renewal to a past-dated shaken', () => {
    expect(updateVehicleSchema.safeParse({ shakenExpiryDate: PAST_DATE }).success).toBe(false)
  })

  test('accepts a partial patch that omits the documents entirely', () => {
    expect(updateVehicleSchema.safeParse({ name: 'Renamed' }).success).toBe(true)
  })
})
