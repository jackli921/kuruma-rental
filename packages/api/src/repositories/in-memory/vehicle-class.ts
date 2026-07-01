import { type CallerContext, requireFleetWriteScope } from '../../middleware/auth'
import type { VehicleClass } from '../../stores'
import { operatorReadScope } from '../../tenancy'
import type { VehicleClassFilters, VehicleClassRepository } from '../types'

export class InMemoryVehicleClassRepository implements VehicleClassRepository {
  private readonly store: Map<string, VehicleClass>

  constructor(store?: Map<string, VehicleClass>) {
    this.store = store ?? new Map()
  }

  async findAll(ctx: CallerContext, filters?: VehicleClassFilters): Promise<VehicleClass[]> {
    const scope = operatorReadScope(ctx)
    if (scope.kind === 'none') return []
    const all = [...this.store.values()].filter((vc) =>
      scope.kind === 'operator' ? vc.operatorId === scope.operatorId : true,
    )
    const scoped = filters?.operatorId
      ? all.filter((vc) => vc.operatorId === filters.operatorId)
      : all
    if (filters?.status) return scoped.filter((vc) => vc.status === filters.status)
    if (filters?.includeArchived) return scoped
    return scoped.filter((vc) => vc.status !== 'ARCHIVED')
  }

  async findById(ctx: CallerContext, id: string): Promise<VehicleClass | undefined> {
    const scope = operatorReadScope(ctx)
    if (scope.kind === 'none') return undefined
    const vc = this.store.get(id)
    if (!vc) return undefined
    if (scope.kind === 'operator' && vc.operatorId !== scope.operatorId) return undefined
    return vc
  }

  async findBySlug(ctx: CallerContext, slug: string): Promise<VehicleClass | undefined> {
    const scope = operatorReadScope(ctx)
    if (scope.kind === 'none') return undefined
    const vc = [...this.store.values()].find((v) => v.slug === slug)
    if (!vc) return undefined
    if (scope.kind === 'operator' && vc.operatorId !== scope.operatorId) return undefined
    return vc
  }

  async create(data: Omit<VehicleClass, 'id' | 'createdAt' | 'updatedAt'>): Promise<VehicleClass> {
    const now = new Date()
    const vehicleClass: VehicleClass = {
      ...data,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    }
    this.store.set(vehicleClass.id, vehicleClass)
    return vehicleClass
  }

  async update(
    ctx: CallerContext,
    id: string,
    data: Partial<VehicleClass>,
  ): Promise<VehicleClass | undefined> {
    // #1288: reject non-fleet-write roles + fail closed on a tenant-less operator
    // (mirrors vehicle.ts) — else a bypassing RENTER/PARTNER maps to {kind:'all'}
    // and could write any operator's catalog.
    requireFleetWriteScope(ctx)
    const scope = operatorReadScope(ctx)
    const existing = this.store.get(id)
    if (!existing) return undefined
    // #1288: tenant-scope the write so a caller reaching the repo without the
    // service's findById guard can't mutate another operator's row by id.
    if (scope.kind === 'operator' && existing.operatorId !== scope.operatorId) return undefined

    const updated: VehicleClass = {
      ...existing,
      ...data,
      id: existing.id,
      // operatorId is an immutable tenant anchor (#1279): pin it like id so an
      // update payload can never migrate the row to another operator.
      operatorId: existing.operatorId,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
    }
    this.store.set(updated.id, updated)
    return updated
  }

  async archive(ctx: CallerContext, id: string): Promise<VehicleClass | undefined> {
    requireFleetWriteScope(ctx)
    const scope = operatorReadScope(ctx)
    const existing = this.store.get(id)
    if (!existing) return undefined
    // #1288: tenant-scope the archive (see update()).
    if (scope.kind === 'operator' && existing.operatorId !== scope.operatorId) return undefined

    const archived: VehicleClass = {
      ...existing,
      status: 'ARCHIVED',
      updatedAt: new Date(),
    }
    this.store.set(archived.id, archived)
    return archived
  }
}
