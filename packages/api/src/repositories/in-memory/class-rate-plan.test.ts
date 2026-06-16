import { beforeEach, describe, expect, it } from 'vitest'
import type { ClassRatePlan } from '../../stores'
import { InMemoryClassRatePlanRepository } from './class-rate-plan'

const baseInput = (): Omit<ClassRatePlan, 'id' | 'createdAt' | 'updatedAt'> => ({
  operatorId: 'op-1',
  classId: 'class-compact',
  pickupLocationId: 'loc-osaka',
  dayRateJpy: 6000,
  isActive: true,
  label: 'Weekend Compact Deal',
})

describe('InMemoryClassRatePlanRepository (#464 slice 0)', () => {
  let repo: InMemoryClassRatePlanRepository

  beforeEach(() => {
    repo = new InMemoryClassRatePlanRepository()
  })

  it('create returns the row with a generated id, timestamps, and the input fields', async () => {
    const plan = await repo.create(baseInput())

    expect(plan.id).toMatch(/.+/)
    expect(plan).toMatchObject({
      operatorId: 'op-1',
      classId: 'class-compact',
      pickupLocationId: 'loc-osaka',
      dayRateJpy: 6000,
      isActive: true,
      label: 'Weekend Compact Deal',
    })
    expect(plan.createdAt).toBeInstanceOf(Date)
    expect(plan.updatedAt).toBeInstanceOf(Date)
  })

  it('findActiveByClassAndLocation returns the active plan for the matching triple', async () => {
    const created = await repo.create(baseInput())

    const found = await repo.findActiveByClassAndLocation('op-1', 'class-compact', 'loc-osaka')

    expect(found?.id).toBe(created.id)
    expect(found?.dayRateJpy).toBe(6000)
  })

  it('findActiveByClassAndLocation returns undefined when the plan is inactive', async () => {
    await repo.create({ ...baseInput(), isActive: false })

    const found = await repo.findActiveByClassAndLocation('op-1', 'class-compact', 'loc-osaka')

    expect(found).toBeUndefined()
  })

  it('findActiveByClassAndLocation scopes by operator, class, AND location', async () => {
    await repo.create(baseInput())

    expect(
      await repo.findActiveByClassAndLocation('op-2', 'class-compact', 'loc-osaka'),
    ).toBeUndefined()
    expect(
      await repo.findActiveByClassAndLocation('op-1', 'class-suv', 'loc-osaka'),
    ).toBeUndefined()
    expect(
      await repo.findActiveByClassAndLocation('op-1', 'class-compact', 'loc-kyoto'),
    ).toBeUndefined()
  })
})
