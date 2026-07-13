import { type CallerContext, requireManagementRead } from '../../middleware/auth'
import { PG_ERROR } from '../../pg-errors'
import type { ClassRatePlan } from '../../stores'
import { operatorReadScope } from '../../tenancy'
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
    if (await this.findByScope(data.operatorId, data.classId, data.pickupLocationId)) {
      throw Object.assign(new Error('duplicate key value violates unique constraint'), {
        code: PG_ERROR.UNIQUE_VIOLATION,
      })
    }
    const now = new Date()
    const plan: ClassRatePlan = { ...data, id: crypto.randomUUID(), createdAt: now, updatedAt: now }
    this.store.set(plan.id, plan)
    return plan
  }

  async findAll(ctx: CallerContext, filters: ClassRatePlanFilters): Promise<ClassRatePlan[]> {
    requireManagementRead(ctx)
    const scope = operatorReadScope(ctx)
    if (scope.kind === 'none') return []
    return [...this.store.values()].filter((p) => {
      // Operator scope is absolute; a stray filters.operatorId can never widen
      // it. The explicit filter only narrows bypass-role ('all') reads.
      if (scope.kind === 'operator') {
        if (p.operatorId !== scope.operatorId) return false
      } else if (filters.operatorId && p.operatorId !== filters.operatorId) {
        return false
      }
      if (filters.classId && p.classId !== filters.classId) return false
      if (filters.pickupLocationId && p.pickupLocationId !== filters.pickupLocationId) return false
      if (filters.isActive !== undefined && p.isActive !== filters.isActive) return false
      return true
    })
  }

  async findById(ctx: CallerContext, id: string): Promise<ClassRatePlan | undefined> {
    requireManagementRead(ctx)
    const scope = operatorReadScope(ctx)
    if (scope.kind === 'none') return undefined
    const plan = this.store.get(id)
    if (!plan) return undefined
    if (scope.kind === 'operator' && plan.operatorId !== scope.operatorId) return undefined
    return plan
  }

  // NOT ctx-scoped: service passes an already-resolved operatorId; DB UNIQUE is the seal.
  // Never wire to a route directly.
  async findByScope(
    operatorId: string,
    classId: string,
    pickupLocationId: string,
  ): Promise<ClassRatePlan | undefined> {
    return [...this.store.values()].find(
      (p) =>
        p.operatorId === operatorId &&
        p.classId === classId &&
        p.pickupLocationId === pickupLocationId,
    )
  }

  async update(
    ctx: CallerContext,
    id: string,
    patch: Partial<
      Pick<ClassRatePlan, 'classId' | 'pickupLocationId' | 'dayRateJpy' | 'isActive' | 'label'>
    >,
  ): Promise<ClassRatePlan | undefined> {
    requireManagementRead(ctx)
    const scope = operatorReadScope(ctx)
    if (scope.kind === 'none') return undefined
    const current = this.store.get(id)
    if (!current) return undefined
    if (scope.kind === 'operator' && current.operatorId !== scope.operatorId) return undefined
    const next: ClassRatePlan = {
      ...current,
      ...patch,
      id: current.id,
      operatorId: current.operatorId,
      createdAt: current.createdAt,
      updatedAt: new Date(),
    }
    if (
      [...this.store.values()].some(
        (p) =>
          p.id !== id &&
          p.operatorId === next.operatorId &&
          p.classId === next.classId &&
          p.pickupLocationId === next.pickupLocationId,
      )
    ) {
      throw Object.assign(new Error('duplicate key value violates unique constraint'), {
        code: PG_ERROR.UNIQUE_VIOLATION,
      })
    }
    this.store.set(id, next)
    return next
  }

  async remove(ctx: CallerContext, id: string): Promise<ClassRatePlan | undefined> {
    requireManagementRead(ctx)
    const scope = operatorReadScope(ctx)
    if (scope.kind === 'none') return undefined
    const current = this.store.get(id)
    if (!current) return undefined
    if (scope.kind === 'operator' && current.operatorId !== scope.operatorId) return undefined
    this.store.delete(id)
    return current
  }
}
