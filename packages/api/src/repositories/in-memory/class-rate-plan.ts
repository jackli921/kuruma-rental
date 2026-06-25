import type { ClassRatePlan } from '../../stores'
import type { ClassRatePlanFilters, ClassRatePlanRepository } from '../types'

export class InMemoryClassRatePlanRepository implements ClassRatePlanRepository {
  private readonly store: Map<string, ClassRatePlan>

  constructor(store?: Map<string, ClassRatePlan>) {
    this.store = store ?? new Map()
  }

  async findActiveRate(
    operatorId: string,
    classId: string,
    pickupLocationId: string,
  ): Promise<ClassRatePlan | undefined> {
    return [...this.store.values()].find(
      (p) =>
        p.isActive &&
        p.operatorId === operatorId &&
        p.classId === classId &&
        p.pickupLocationId === pickupLocationId,
    )
  }

  async findActiveRatePlans(filters?: ClassRatePlanFilters): Promise<ClassRatePlan[]> {
    const locationIds = filters?.locationIds ? new Set(filters.locationIds) : null
    return [...this.store.values()].filter(
      (p) =>
        p.isActive &&
        (!filters?.operatorId || p.operatorId === filters.operatorId) &&
        (!locationIds || locationIds.has(p.pickupLocationId)),
    )
  }

  async create(
    data: Omit<ClassRatePlan, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ClassRatePlan> {
    const now = new Date()
    const plan: ClassRatePlan = { ...data, id: crypto.randomUUID(), createdAt: now, updatedAt: now }
    this.store.set(plan.id, plan)
    return plan
  }
}
