import { describe, expect, test } from 'vitest'
import type { CallerContext } from '../../middleware/auth'
import { PG_ERROR } from '../../pg-errors'
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

  // Operator CRUD — slice 6 (#464)
  const OP = 'op-1'
  const CLS = 'cls-1'
  const LOC = 'loc-1'
  const LOC2 = 'loc-2'
  const ctx: CallerContext = { userId: 'u-1', role: 'OPERATOR_OWNER', operatorId: OP }
  const ctxOther: CallerContext = { userId: 'u-2', role: 'OPERATOR_OWNER', operatorId: 'op-2' }

  test('findByScope returns the singleton regardless of isActive', async () => {
    const repo = new InMemoryClassRatePlanRepository()
    const created = await repo.create({
      operatorId: OP,
      classId: CLS,
      pickupLocationId: LOC,
      dayRateJpy: 8000,
      isActive: false,
      label: null,
    })
    const found = await repo.findByScope(OP, CLS, LOC)
    expect(found?.id).toBe(created.id)
  })

  test('create twice on the same scope throws a 23505', async () => {
    const repo = new InMemoryClassRatePlanRepository()
    const base = {
      operatorId: OP,
      classId: CLS,
      pickupLocationId: LOC,
      dayRateJpy: 8000,
      isActive: true,
      label: null,
    }
    await repo.create(base)
    await expect(repo.create(base)).rejects.toMatchObject({ code: PG_ERROR.UNIQUE_VIOLATION })
  })

  test('update patches dayRateJpy in place', async () => {
    const repo = new InMemoryClassRatePlanRepository()
    const c = await repo.create({
      operatorId: OP,
      classId: CLS,
      pickupLocationId: LOC,
      dayRateJpy: 8000,
      isActive: true,
      label: null,
    })
    const u = await repo.update(ctx, c.id, { dayRateJpy: 9500 })
    expect(u?.dayRateJpy).toBe(9500)
  })

  test('remove deletes the row (findById -> undefined after)', async () => {
    const repo = new InMemoryClassRatePlanRepository()
    const c = await repo.create({
      operatorId: OP,
      classId: CLS,
      pickupLocationId: LOC,
      dayRateJpy: 8000,
      isActive: true,
      label: null,
    })
    await repo.remove(ctx, c.id)
    expect(await repo.findById(ctx, c.id)).toBeUndefined()
  })

  test('update returns undefined for another operator plan and leaves it unchanged', async () => {
    const repo = new InMemoryClassRatePlanRepository()
    const plan = await repo.create({
      operatorId: OP,
      classId: CLS,
      pickupLocationId: LOC,
      dayRateJpy: 8000,
      isActive: true,
      label: null,
    })
    const result = await repo.update(ctxOther, plan.id, { dayRateJpy: 1 })
    expect(result).toBeUndefined()
    const unchanged = await repo.findById(ctx, plan.id)
    expect(unchanged?.dayRateJpy).toBe(8000)
  })

  test('remove returns undefined for another operator plan and leaves it present', async () => {
    const repo = new InMemoryClassRatePlanRepository()
    const plan = await repo.create({
      operatorId: OP,
      classId: CLS,
      pickupLocationId: LOC,
      dayRateJpy: 8000,
      isActive: true,
      label: null,
    })
    const result = await repo.remove(ctxOther, plan.id)
    expect(result).toBeUndefined()
    const stillPresent = await repo.findById(ctx, plan.id)
    expect(stillPresent?.id).toBe(plan.id)
  })

  test('findAll filters by isActive', async () => {
    const repo = new InMemoryClassRatePlanRepository()
    const active = await repo.create({
      operatorId: OP,
      classId: CLS,
      pickupLocationId: LOC,
      dayRateJpy: 8000,
      isActive: true,
      label: null,
    })
    const inactive = await repo.create({
      operatorId: OP,
      classId: CLS,
      pickupLocationId: LOC2,
      dayRateJpy: 5000,
      isActive: false,
      label: null,
    })
    const activeOnly = await repo.findAll(ctx, { isActive: true })
    expect(activeOnly).toHaveLength(1)
    expect(activeOnly[0]?.id).toBe(active.id)
    expect(activeOnly[0]?.isActive).toBe(true)

    const inactiveOnly = await repo.findAll(ctx, { isActive: false })
    expect(inactiveOnly).toHaveLength(1)
    expect(inactiveOnly[0]?.id).toBe(inactive.id)
    expect(inactiveOnly[0]?.isActive).toBe(false)
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
