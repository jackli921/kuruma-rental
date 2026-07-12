import { describe, expect, test } from 'vitest'
import {
  createClassRatePlanSchema,
  platformAdminCreateClassRatePlanSchema,
  updateClassRatePlanSchema,
} from './class-rate-plan'

const uuid = '11111111-1111-1111-1111-111111111111'

describe('createClassRatePlanSchema', () => {
  test('accepts a well-formed deal', () => {
    const r = createClassRatePlanSchema.safeParse({
      classId: uuid,
      pickupLocationId: uuid,
      dayRateJpy: 8000,
    })
    expect(r.success).toBe(true)
  })

  test('rejects a negative day rate', () => {
    const r = createClassRatePlanSchema.safeParse({
      classId: uuid,
      pickupLocationId: uuid,
      dayRateJpy: -1,
    })
    expect(r.success).toBe(false)
  })

  test('rejects a non-uuid classId', () => {
    const r = createClassRatePlanSchema.safeParse({
      classId: 'not-a-uuid',
      pickupLocationId: uuid,
      dayRateJpy: 8000,
    })
    expect(r.success).toBe(false)
  })
})

describe('platformAdminCreateClassRatePlanSchema', () => {
  test('requires operatorId', () => {
    const r = platformAdminCreateClassRatePlanSchema.safeParse({
      classId: uuid,
      pickupLocationId: uuid,
      dayRateJpy: 8000,
    })
    expect(r.success).toBe(false)
  })
})

describe('updateClassRatePlanSchema', () => {
  test('accepts a partial patch (isActive only)', () => {
    const r = updateClassRatePlanSchema.safeParse({ isActive: false })
    expect(r.success).toBe(true)
  })
})
