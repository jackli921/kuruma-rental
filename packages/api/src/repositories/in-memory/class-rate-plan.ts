import type { ClassRatePlan } from '../../stores'
import type { ClassRatePlanRepository } from '../types'

export class InMemoryClassRatePlanRepository implements ClassRatePlanRepository {
  private readonly store: Map<string, ClassRatePlan>

  constructor(store?: Map<string, ClassRatePlan>) {
    this.store = store ?? new Map()
  }

  async findActiveByClassAndLocation(
    operatorId: string,
    classId: string,
    pickupLocationId: string,
  ): Promise<ClassRatePlan | undefined> {
    return [...this.store.values()].find(
      (p) =>
        p.operatorId === operatorId &&
        p.classId === classId &&
        p.pickupLocationId === pickupLocationId &&
        p.isActive,
    )
  }

  async create(
    data: Omit<ClassRatePlan, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ClassRatePlan> {
    const now = new Date()
    const plan: ClassRatePlan = {
      ...data,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    }
    this.store.set(plan.id, plan)
    return plan
  }
}
