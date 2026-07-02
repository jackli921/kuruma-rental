import { jstDateString } from '@kuruma/shared/lib/compliance'
import { type ExpiryStatus, computeExpiryStatus } from '@kuruma/shared/lib/expiry'
import type { VehicleComplianceCounts } from '@kuruma/shared/types/operator-summary'
import { type CallerContext, requireFleetWriteScope } from '../../middleware/auth'
import type { Vehicle } from '../../stores'
import { operatorReadScope } from '../../tenancy'
import type {
  PaginatedResult,
  VehicleFilters,
  VehicleRepository,
  VehicleUpdateOptions,
} from '../types'

export class InMemoryVehicleRepository implements VehicleRepository {
  private readonly store: Map<string, Vehicle>

  constructor(store?: Map<string, Vehicle>) {
    this.store = store ?? new Map()
  }

  async findAll(ctx: CallerContext, filters?: VehicleFilters): Promise<PaginatedResult<Vehicle>> {
    const scope = operatorReadScope(ctx)
    if (scope.kind === 'none') return { data: [], total: 0 }
    const all = [...this.store.values()].filter((v) => {
      if (scope.kind === 'operator') return v.operatorId === scope.operatorId
      // scope.kind === 'all': apply the service-resolved picker narrow when present.
      if (filters?.operatorId) return v.operatorId === filters.operatorId
      return true
    })
    let filtered: Vehicle[]
    if (filters?.status) {
      filtered = all.filter((v) => v.status === filters.status)
    } else if (filters?.includeRetired) {
      filtered = all
    } else {
      filtered = all.filter((v) => v.status !== 'RETIRED')
    }
    if (filters?.classId !== undefined) {
      filtered = filtered.filter((v) => v.classId === filters.classId)
    }
    const total = filtered.length
    const offset = filters?.offset ?? 0
    const limit = filters?.limit
    const data = limit != null ? filtered.slice(offset, offset + limit) : filtered.slice(offset)
    return { data, total }
  }

  async findById(ctx: CallerContext, id: string): Promise<Vehicle | undefined> {
    const scope = operatorReadScope(ctx)
    if (scope.kind === 'none') return undefined
    const v = this.store.get(id)
    if (!v) return undefined
    if (scope.kind === 'operator' && v.operatorId !== scope.operatorId) return undefined
    return v
  }

  async findByIds(ctx: CallerContext, ids: string[]): Promise<Vehicle[]> {
    const scope = operatorReadScope(ctx)
    if (scope.kind === 'none') return []
    return ids.flatMap((id) => {
      const v = this.store.get(id)
      if (!v) return []
      if (scope.kind === 'operator' && v.operatorId !== scope.operatorId) return []
      return [v]
    })
  }

  // #1087: platform-overview live-fleet count across all operators (unscoped).
  async countActive(): Promise<number> {
    let n = 0
    for (const v of this.store.values()) {
      if (v.status !== 'RETIRED') n++
    }
    return n
  }

  // #1088: live (non-RETIRED) fleet size per operator. Mirrors the Drizzle
  // grouped COUNT — operators with no live vehicles never appear in the Map.
  async countByOperator(operatorIds: string[]): Promise<Map<string, number>> {
    const wanted = new Set(operatorIds)
    const counts = new Map<string, number>()
    for (const v of this.store.values()) {
      if (v.status === 'RETIRED') continue
      if (!wanted.has(v.operatorId)) continue
      counts.set(v.operatorId, (counts.get(v.operatorId) ?? 0) + 1)
    }
    return counts
  }

  // #1120: per-operator compliance roll-up over the live fleet. Classifies each
  // vehicle through the single compliance seam so the buckets agree with the
  // dashboard banner / fleet facet / digest, and keeps the two attention buckets
  // mutually exclusive (a needing-docs car is never also counted as expiring-soon).
  async countComplianceForOperator(
    operatorId: string,
    asOf: Date,
  ): Promise<VehicleComplianceCounts> {
    const todayIso = jstDateString(asOf)
    const counts: VehicleComplianceCounts = { total: 0, needingDocs: 0, expiringSoon: 0 }
    for (const v of this.store.values()) {
      if (v.status === 'RETIRED') continue
      if (v.operatorId !== operatorId) continue
      counts.total++
      const shaken = computeExpiryStatus(v.shakenExpiryDate, todayIso)
      const insurance = computeExpiryStatus(v.insuranceExpiryDate, todayIso)
      const needsDocs = (s: ExpiryStatus) => s === 'EXPIRED' || s === 'UNKNOWN'
      if (needsDocs(shaken) || needsDocs(insurance)) counts.needingDocs++
      else if (shaken === 'EXPIRING_SOON' || insurance === 'EXPIRING_SOON') counts.expiringSoon++
    }
    return counts
  }

  async create(
    ctx: CallerContext,
    data: Omit<Vehicle, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<Vehicle> {
    requireFleetWriteScope(ctx)
    const now = new Date()
    // operatorId arrives already resolved by the route's write-operator
    // resolver (#401); the repo trusts it. requireFleetWriteScope above is the
    // repo-layer authz seal.
    const vehicle: Vehicle = {
      ...data,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    }
    this.store.set(vehicle.id, vehicle)
    return vehicle
  }

  async update(
    ctx: CallerContext,
    id: string,
    data: Partial<Vehicle>,
    options?: VehicleUpdateOptions,
  ): Promise<Vehicle | undefined> {
    requireFleetWriteScope(ctx)
    const scope = operatorReadScope(ctx)
    const existing = this.store.get(id)
    if (!existing) return undefined
    if (scope.kind === 'operator' && existing.operatorId !== scope.operatorId) return undefined
    if (options?.expectedStatus && existing.status !== options.expectedStatus) return undefined

    const updated: Vehicle = {
      ...existing,
      ...data,
      id: existing.id,
      // Tenant anchor is immutable on update — mirrors the Drizzle repo (#386 F2).
      operatorId: existing.operatorId,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
    }
    this.store.set(updated.id, updated)
    return updated
  }

  async softDelete(ctx: CallerContext, id: string): Promise<Vehicle | undefined> {
    requireFleetWriteScope(ctx)
    const scope = operatorReadScope(ctx)
    const existing = this.store.get(id)
    if (!existing) return undefined
    if (scope.kind === 'operator' && existing.operatorId !== scope.operatorId) return undefined

    const retired: Vehicle = {
      ...existing,
      status: 'RETIRED',
      updatedAt: new Date(),
    }
    this.store.set(retired.id, retired)
    return retired
  }

  async bulkUpdateStatus(
    ctx: CallerContext,
    ids: string[],
    status: 'AVAILABLE' | 'MAINTENANCE',
  ): Promise<Vehicle[]> {
    requireFleetWriteScope(ctx)
    const scope = operatorReadScope(ctx)
    const now = new Date()
    const updated: Vehicle[] = []
    for (const id of ids) {
      const existing = this.store.get(id)
      if (!existing) continue
      if (scope.kind === 'operator' && existing.operatorId !== scope.operatorId) continue
      const vehicle: Vehicle = { ...existing, status, updatedAt: now }
      this.store.set(vehicle.id, vehicle)
      updated.push(vehicle)
    }
    return updated
  }

  async appendPhotos(
    ctx: CallerContext,
    id: string,
    urls: string[],
    maxPhotos: number,
  ): Promise<
    { outcome: 'ok'; vehicle: Vehicle } | { outcome: 'cap_exceeded' } | { outcome: 'not_found' }
  > {
    requireFleetWriteScope(ctx)
    const scope = operatorReadScope(ctx)
    const existing = this.store.get(id)
    if (!existing) return { outcome: 'not_found' }
    if (scope.kind === 'operator' && existing.operatorId !== scope.operatorId) {
      return { outcome: 'not_found' }
    }
    if (existing.photos.length + urls.length > maxPhotos) return { outcome: 'cap_exceeded' }
    const updated: Vehicle = {
      ...existing,
      photos: [...existing.photos, ...urls],
      updatedAt: new Date(),
    }
    this.store.set(updated.id, updated)
    return { outcome: 'ok', vehicle: updated }
  }

  async removePhotoByUrl(
    ctx: CallerContext,
    id: string,
    url: string,
  ): Promise<Vehicle | undefined> {
    requireFleetWriteScope(ctx)
    const scope = operatorReadScope(ctx)
    const existing = this.store.get(id)
    if (!existing) return undefined
    if (scope.kind === 'operator' && existing.operatorId !== scope.operatorId) return undefined
    if (!existing.photos.includes(url)) return undefined
    const updated: Vehicle = {
      ...existing,
      photos: existing.photos.filter((u) => u !== url),
      updatedAt: new Date(),
    }
    this.store.set(updated.id, updated)
    return updated
  }
}
