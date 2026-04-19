import { type CallerContext, requireStaffContext } from '../../middleware/auth'
import type { Vehicle } from '../../stores'
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

  async findAll(_ctx: CallerContext, filters?: VehicleFilters): Promise<PaginatedResult<Vehicle>> {
    const all = [...this.store.values()]
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

  async findById(_ctx: CallerContext, id: string): Promise<Vehicle | undefined> {
    return this.store.get(id)
  }

  async findByIds(_ctx: CallerContext, ids: string[]): Promise<Vehicle[]> {
    return ids.flatMap((id) => {
      const v = this.store.get(id)
      return v ? [v] : []
    })
  }

  async create(
    ctx: CallerContext,
    data: Omit<Vehicle, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<Vehicle> {
    requireStaffContext(ctx)
    const now = new Date()
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
    requireStaffContext(ctx)
    const existing = this.store.get(id)
    if (!existing) return undefined
    if (options?.expectedStatus && existing.status !== options.expectedStatus) return undefined

    const updated: Vehicle = {
      ...existing,
      ...data,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
    }
    this.store.set(updated.id, updated)
    return updated
  }

  async softDelete(ctx: CallerContext, id: string): Promise<Vehicle | undefined> {
    requireStaffContext(ctx)
    const existing = this.store.get(id)
    if (!existing) return undefined

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
    requireStaffContext(ctx)
    const now = new Date()
    const updated: Vehicle[] = []
    for (const id of ids) {
      const existing = this.store.get(id)
      if (!existing) continue
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
    requireStaffContext(ctx)
    const existing = this.store.get(id)
    if (!existing) return { outcome: 'not_found' }
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
    requireStaffContext(ctx)
    const existing = this.store.get(id)
    if (!existing) return undefined
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
