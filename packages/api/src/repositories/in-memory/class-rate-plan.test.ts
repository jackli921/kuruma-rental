import { describe, expect, test } from 'vitest'
import { InMemoryClassRatePlanRepository } from './class-rate-plan'

// A CLASS_COMBO is priced off its class rate plan, keyed per
// (operator, class, pickupLocation) — see #464 design §5.1.
const baseRate = {
  operatorId: 'op-1',
  classId: 'cls-compact',
  pickupLocationId: 'loc-namba',
  dayRateJpy: 6000,
  isActive: true,
  label: 'Weekend Compact Deal',
}

describe('InMemoryClassRatePlanRepository', () => {
  test('create stamps id + timestamps and preserves the rate fields', async () => {
    const repo = new InMemoryClassRatePlanRepository()
    const plan = await repo.create(baseRate)

    expect(plan.id).toMatch(/[0-9a-f-]{36}/)
    expect(plan.operatorId).toBe('op-1')
    expect(plan.dayRateJpy).toBe(6000)
    expect(plan.isActive).toBe(true)
    expect(plan.label).toBe('Weekend Compact Deal')
    expect(plan.createdAt).toBeInstanceOf(Date)
    expect(plan.updatedAt).toBeInstanceOf(Date)
  })

  test('findActiveRate returns the active plan for (operator, class, location)', async () => {
    const repo = new InMemoryClassRatePlanRepository()
    const created = await repo.create(baseRate)

    const found = await repo.findActiveRate('op-1', 'cls-compact', 'loc-namba')
    expect(found?.id).toBe(created.id)
    expect(found?.dayRateJpy).toBe(6000)
  })

  test('findActiveRate ignores an inactive plan (a deal toggled off is not offered)', async () => {
    const repo = new InMemoryClassRatePlanRepository()
    await repo.create({ ...baseRate, isActive: false })

    expect(await repo.findActiveRate('op-1', 'cls-compact', 'loc-namba')).toBeUndefined()
  })

  test('findActiveRate is per-location — a plan at another location does not match', async () => {
    const repo = new InMemoryClassRatePlanRepository()
    await repo.create(baseRate)

    expect(await repo.findActiveRate('op-1', 'cls-compact', 'loc-other')).toBeUndefined()
  })

  test('findActiveRate is per-class — a different class at the same location does not match', async () => {
    const repo = new InMemoryClassRatePlanRepository()
    await repo.create(baseRate)

    expect(await repo.findActiveRate('op-1', 'cls-suv', 'loc-namba')).toBeUndefined()
  })

  // findActiveRatePlans enumerates the combo deals a renter search should surface
  // (#464 read-side). It mirrors the SPECIFIC availability scan: scoped to a
  // location/operator set, ACTIVE-only; the service applies the ACRISS class filter.
  describe('findActiveRatePlans', () => {
    test('returns every active plan and excludes inactive ones (unfiltered browse-all)', async () => {
      const repo = new InMemoryClassRatePlanRepository()
      const compact = await repo.create(baseRate)
      const suv = await repo.create({ ...baseRate, classId: 'cls-suv', dayRateJpy: 9000 })
      await repo.create({ ...baseRate, classId: 'cls-van', isActive: false })

      const plans = await repo.findActiveRatePlans()
      expect(plans.map((p) => p.id).sort()).toEqual([compact.id, suv.id].sort())
    })

    test('scopes to the given locationIds (a plan at another location is dropped)', async () => {
      const repo = new InMemoryClassRatePlanRepository()
      const namba = await repo.create(baseRate)
      await repo.create({ ...baseRate, pickupLocationId: 'loc-kyoto' })

      const plans = await repo.findActiveRatePlans({ locationIds: ['loc-namba'] })
      expect(plans.map((p) => p.id)).toEqual([namba.id])
    })

    test('scopes to a single operator', async () => {
      const repo = new InMemoryClassRatePlanRepository()
      const mine = await repo.create(baseRate)
      await repo.create({ ...baseRate, operatorId: 'op-2' })

      const plans = await repo.findActiveRatePlans({ operatorId: 'op-1' })
      expect(plans.map((p) => p.id)).toEqual([mine.id])
    })
  })
})
