import { type CallerContext, requireManagementRead } from '../../middleware/auth'
import { PG_ERROR } from '../../pg-errors'
import type { FeeSchedule } from '../../stores'
import { operatorReadScope } from '../../tenancy'
import type { FeeScheduleFilters, FeeScheduleRepository } from '../types'

export class InMemoryFeeScheduleRepository implements FeeScheduleRepository {
  private readonly store: Map<string, FeeSchedule>

  constructor(store?: Map<string, FeeSchedule>) {
    this.store = store ?? new Map()
  }

  // Mirror the DB's TWO partial-active-uniqueness indexes so this in-memory
  // double surfaces the same UNIQUE_VIOLATION the real Postgres would on a lost
  // create race — the service maps it to a friendly 409. Operator-wide rows
  // (vehicleClassId null) dedupe per (operator, type); per-class rows per
  // (operator, type, class). ARCHIVED rows never reserve a slot.
  private assertScopeFree(
    operatorId: string,
    feeType: FeeSchedule['feeType'],
    vehicleClassId: string | null,
    exceptId?: string,
  ): void {
    const clash = [...this.store.values()].some(
      (f) =>
        f.status === 'ACTIVE' &&
        f.operatorId === operatorId &&
        f.feeType === feeType &&
        f.vehicleClassId === vehicleClassId &&
        f.id !== exceptId,
    )
    if (clash) {
      throw Object.assign(new Error('duplicate key value violates unique constraint'), {
        code: PG_ERROR.UNIQUE_VIOLATION,
      })
    }
  }

  async findAll(ctx: CallerContext, filters?: FeeScheduleFilters): Promise<FeeSchedule[]> {
    // [P0] private config: reject RENTER/PARTNER BEFORE operatorReadScope, which
    // would otherwise map a renter to {kind:'all'} and leak every operator.
    requireManagementRead(ctx)
    const scope = operatorReadScope(ctx)
    if (scope.kind === 'none') return []

    const all = [...this.store.values()].filter((f) => {
      // Operator scope is absolute; a stray filters.operatorId can never widen
      // it. The explicit filter only narrows bypass-role ('all') reads.
      if (scope.kind === 'operator') return f.operatorId === scope.operatorId
      if (filters?.operatorId) return f.operatorId === filters.operatorId
      // scope is 'all' (bypass role): read across tenants ONLY when the route
      // explicitly opted in. Absent that, read nothing — the safe default lives
      // here, so a forgotten route guard cannot enumerate every tenant (#1107).
      return filters?.includeAllOperators === true
    })

    const byStatus = filters?.status
      ? all.filter((f) => f.status === filters.status)
      : filters?.includeArchived
        ? all
        : all.filter((f) => f.status !== 'ARCHIVED')

    return byStatus.filter((f) => {
      if (filters?.feeType && f.feeType !== filters.feeType) return false
      if (filters?.vehicleClassId && f.vehicleClassId !== filters.vehicleClassId) return false
      return true
    })
  }

  async findById(ctx: CallerContext, id: string): Promise<FeeSchedule | undefined> {
    requireManagementRead(ctx)
    const scope = operatorReadScope(ctx)
    if (scope.kind === 'none') return undefined
    const fee = this.store.get(id)
    if (!fee) return undefined
    if (scope.kind === 'operator' && fee.operatorId !== scope.operatorId) return undefined
    return fee
  }

  async findActiveByScope(
    operatorId: string,
    feeType: FeeSchedule['feeType'],
    vehicleClassId: string | null,
  ): Promise<FeeSchedule | undefined> {
    return [...this.store.values()].find(
      (f) =>
        f.status === 'ACTIVE' &&
        f.operatorId === operatorId &&
        f.feeType === feeType &&
        f.vehicleClassId === vehicleClassId,
    )
  }

  async create(data: Omit<FeeSchedule, 'id' | 'createdAt' | 'updatedAt'>): Promise<FeeSchedule> {
    if (data.status === 'ACTIVE') {
      this.assertScopeFree(data.operatorId, data.feeType, data.vehicleClassId)
    }
    const now = new Date()
    const fee: FeeSchedule = { ...data, id: crypto.randomUUID(), createdAt: now, updatedAt: now }
    this.store.set(fee.id, fee)
    return fee
  }

  async update(id: string, data: Partial<FeeSchedule>): Promise<FeeSchedule | undefined> {
    const existing = this.store.get(id)
    if (!existing) return undefined

    const merged: FeeSchedule = {
      ...existing,
      ...data,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
    }
    // Re-seal if the merged row is ACTIVE and any uniqueness key changed.
    if (merged.status === 'ACTIVE') {
      this.assertScopeFree(merged.operatorId, merged.feeType, merged.vehicleClassId, id)
    }
    this.store.set(merged.id, merged)
    return merged
  }

  async archive(id: string): Promise<FeeSchedule | undefined> {
    const existing = this.store.get(id)
    if (!existing) return undefined
    const archived: FeeSchedule = { ...existing, status: 'ARCHIVED', updatedAt: new Date() }
    this.store.set(archived.id, archived)
    return archived
  }
}
