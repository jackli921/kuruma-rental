import type { Vehicle } from '../../stores'
import type { VehicleRepository } from '../types'

export class InMemoryVehicleRepository implements VehicleRepository {
  private readonly store: Map<string, Vehicle>

  constructor(store?: Map<string, Vehicle>) {
    this.store = store ?? new Map()
  }

  async findAll(filters?: { status?: string }): Promise<Vehicle[]> {
    const vehicles = [...this.store.values()]
    if (!filters?.status) return vehicles
    return vehicles.filter((v) => v.status === filters.status)
  }

  async findById(id: string): Promise<Vehicle | undefined> {
    return this.store.get(id)
  }

  async create(data: Omit<Vehicle, 'id' | 'createdAt' | 'updatedAt'>): Promise<Vehicle> {
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

  async update(id: string, data: Partial<Vehicle>): Promise<Vehicle | undefined> {
    const existing = this.store.get(id)
    if (!existing) return undefined

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

  async softDelete(id: string): Promise<Vehicle | undefined> {
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
}
