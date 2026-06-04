import { describe, expect, it } from 'vitest'
import {
  createFeeScheduleSchema,
  platformAdminCreateFeeScheduleSchema,
  updateFeeScheduleSchema,
} from '../../src/validators/fee-schedule'

const overtime = () => ({ feeType: 'OVERTIME_HOURLY', unit: 'PER_HOUR', amountJpy: 500 }) as const
const cleaning = () => ({ feeType: 'CLEANING_FLAT', unit: 'FLAT', amountJpy: 3000 }) as const
const noFuel = () => ({ feeType: 'NO_FUEL_FLAT', unit: 'FLAT', amountJpy: 5000 }) as const

describe('createFeeScheduleSchema — fee-type ↔ unit coherence', () => {
  it('accepts OVERTIME_HOURLY with PER_HOUR', () => {
    expect(createFeeScheduleSchema.safeParse(overtime()).success).toBe(true)
  })

  it('accepts CLEANING_FLAT with FLAT', () => {
    expect(createFeeScheduleSchema.safeParse(cleaning()).success).toBe(true)
  })

  it('accepts NO_FUEL_FLAT with FLAT', () => {
    expect(createFeeScheduleSchema.safeParse(noFuel()).success).toBe(true)
  })

  it('rejects OVERTIME_HOURLY with FLAT', () => {
    const result = createFeeScheduleSchema.safeParse({ ...overtime(), unit: 'FLAT' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        'OVERTIME_HOURLY fees must use the PER_HOUR unit',
      )
      expect(result.error.issues[0]?.path).toEqual(['unit'])
    }
  })

  it('rejects CLEANING_FLAT with PER_HOUR', () => {
    const result = createFeeScheduleSchema.safeParse({ ...cleaning(), unit: 'PER_HOUR' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('CLEANING_FLAT fees must use the FLAT unit')
    }
  })

  it('rejects NO_FUEL_FLAT with PER_KM', () => {
    const result = createFeeScheduleSchema.safeParse({ ...noFuel(), unit: 'PER_KM' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('NO_FUEL_FLAT fees must use the FLAT unit')
    }
  })
})

describe('createFeeScheduleSchema — fields', () => {
  it('rejects a negative amount', () => {
    expect(createFeeScheduleSchema.safeParse({ ...cleaning(), amountJpy: -1 }).success).toBe(false)
  })

  it('rejects a non-integer amount', () => {
    expect(createFeeScheduleSchema.safeParse({ ...cleaning(), amountJpy: 100.5 }).success).toBe(
      false,
    )
  })

  it('accepts a zero amount (free)', () => {
    expect(createFeeScheduleSchema.safeParse({ ...cleaning(), amountJpy: 0 }).success).toBe(true)
  })

  it('rejects an unknown feeType', () => {
    expect(
      createFeeScheduleSchema.safeParse({ feeType: 'MYSTERY', unit: 'FLAT', amountJpy: 100 })
        .success,
    ).toBe(false)
  })

  it('rejects an unknown unit', () => {
    expect(
      createFeeScheduleSchema.safeParse({
        feeType: 'CLEANING_FLAT',
        unit: 'PER_YEAR',
        amountJpy: 1,
      }).success,
    ).toBe(false)
  })

  it('accepts an optional vehicleClassId (per-class fee)', () => {
    const result = createFeeScheduleSchema.safeParse({
      ...cleaning(),
      vehicleClassId: crypto.randomUUID(),
    })
    expect(result.success).toBe(true)
  })

  it('treats an omitted vehicleClassId as operator-wide', () => {
    const result = createFeeScheduleSchema.safeParse(cleaning())
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.vehicleClassId).toBeUndefined()
  })

  it('accepts a null vehicleClassId (operator-wide)', () => {
    const result = createFeeScheduleSchema.safeParse({ ...cleaning(), vehicleClassId: null })
    expect(result.success).toBe(true)
  })

  it('rejects a non-uuid vehicleClassId', () => {
    expect(
      createFeeScheduleSchema.safeParse({ ...cleaning(), vehicleClassId: 'not-a-uuid' }).success,
    ).toBe(false)
  })

  it('does not accept an operatorId in the operator-caller schema', () => {
    const result = createFeeScheduleSchema.safeParse({ ...cleaning(), operatorId: 'op_x' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect((result.data as Record<string, unknown>).operatorId).toBeUndefined()
    }
  })
})

describe('platformAdminCreateFeeScheduleSchema', () => {
  it('requires operatorId', () => {
    expect(platformAdminCreateFeeScheduleSchema.safeParse(cleaning()).success).toBe(false)
  })

  it('accepts when operatorId is present', () => {
    const result = platformAdminCreateFeeScheduleSchema.safeParse({
      ...cleaning(),
      operatorId: 'op_best_car_rental',
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.operatorId).toBe('op_best_car_rental')
  })

  it('rejects an empty operatorId', () => {
    expect(
      platformAdminCreateFeeScheduleSchema.safeParse({ ...cleaning(), operatorId: '' }).success,
    ).toBe(false)
  })
})

describe('updateFeeScheduleSchema', () => {
  it('accepts a partial update (amount only)', () => {
    const result = updateFeeScheduleSchema.safeParse({ amountJpy: 800 })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.amountJpy).toBe(800)
  })

  it('accepts an empty object without injecting defaults', () => {
    const result = updateFeeScheduleSchema.safeParse({})
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.feeType).toBeUndefined()
      expect(result.data.unit).toBeUndefined()
      expect(result.data.amountJpy).toBeUndefined()
    }
  })

  it('still validates coherence when BOTH feeType and unit are present', () => {
    const result = updateFeeScheduleSchema.safeParse({ feeType: 'OVERTIME_HOURLY', unit: 'FLAT' })
    expect(result.success).toBe(false)
  })

  it('CANNOT enforce coherence on a unit-only patch (service is the seal)', () => {
    // A { unit: 'FLAT' } patch against a stored OVERTIME_HOURLY row never sees
    // feeType, so .superRefine() can't fire. The schema passes; the service
    // validates the merged value. This documents the [P1] boundary.
    const result = updateFeeScheduleSchema.safeParse({ unit: 'FLAT' })
    expect(result.success).toBe(true)
  })

  it('still rejects a negative amount on update', () => {
    expect(updateFeeScheduleSchema.safeParse({ amountJpy: -5 }).success).toBe(false)
  })
})
