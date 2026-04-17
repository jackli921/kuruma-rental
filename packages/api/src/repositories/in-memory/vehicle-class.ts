import type { VehicleClass } from '../../stores'
import type { VehicleClassFilters, VehicleClassRepository } from '../types'

export class InMemoryVehicleClassRepository implements VehicleClassRepository {
  private readonly store: Map<string, VehicleClass>

  constructor(store?: Map<string, VehicleClass>) {
    this.store = store ?? new Map()
  }

  async findAll(filters?: VehicleClassFilters): Promise<VehicleClass[]> {
    const all = [...this.store.values()]
    if (filters?.status) return all.filter((vc) => vc.status === filters.status)
    if (filters?.includeArchived) return all
    return all.filter((vc) => vc.status !== 'ARCHIVED')
  }

  async findById(id: string): Promise<VehicleClass | undefined> {
    return this.store.get(id)
  }

  async findBySlug(slug: string): Promise<VehicleClass | undefined> {
    return [...this.store.values()].find((vc) => vc.slug === slug)
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

  async update(id: string, data: Partial<VehicleClass>): Promise<VehicleClass | undefined> {
    const existing = this.store.get(id)
    if (!existing) return undefined

    const updated: VehicleClass = {
      ...existing,
      ...data,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
    }
    this.store.set(updated.id, updated)
    return updated
  }

  async archive(id: string): Promise<VehicleClass | undefined> {
    const existing = this.store.get(id)
    if (!existing) return undefined

    const archived: VehicleClass = {
      ...existing,
      status: 'ARCHIVED',
      updatedAt: new Date(),
    }
    this.store.set(archived.id, archived)
    return archived
  }
}
