import type { VehicleBlock } from '../../stores'
import type { VehicleBlockRepository } from '../types'

export class InMemoryVehicleBlockRepository implements VehicleBlockRepository {
  private readonly store: Map<string, VehicleBlock>

  constructor(store?: Map<string, VehicleBlock>) {
    this.store = store ?? new Map()
  }

  async create(data: Omit<VehicleBlock, 'id' | 'createdAt'>): Promise<VehicleBlock> {
    const block: VehicleBlock = {
      ...data,
      id: crypto.randomUUID(),
      createdAt: new Date(),
    }
    this.store.set(block.id, block)
    return block
  }

  async findById(id: string): Promise<VehicleBlock | undefined> {
    return this.store.get(id)
  }

  async findOverlapping(vehicleId: string, from: Date, to: Date): Promise<VehicleBlock[]> {
    // Half-open [start, end) overlap on both ranges: startAt < to AND endAt > from.
    // Adjacent windows (block.endAt === from, or block.startAt === to) do NOT
    // overlap — mirrors the GiST `&&` on tstzrange and the booking exclusion.
    return [...this.store.values()].filter(
      (b) => b.vehicleId === vehicleId && b.startAt < to && b.endAt > from,
    )
  }

  async delete(id: string, operatorId: string): Promise<VehicleBlock | undefined> {
    const existing = this.store.get(id)
    // Operator-scoped: a foreign tenant's block (or an unknown id) is a no-op,
    // so a forgotten route-level scope check cannot delete across tenants.
    if (!existing || existing.operatorId !== operatorId) return undefined
    this.store.delete(id)
    return existing
  }
}
