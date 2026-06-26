import { PG_ERROR, VEHICLE_BLOCKS_OVERLAP } from '../../pg-errors'
import type { VehicleBlock } from '../../stores'
import type { VehicleBlockRepository } from '../types'

// Faithful mirror of the `vehicle_blocks_no_overlap` GiST EXCLUDE (#1101, same
// policy as the booking repo's bookings_no_overlap mirror, #1106): postgres-js
// exposes the violated constraint as `constraint_name`, so the service that maps
// 23P01 → 409 behaves identically against InMemory and Drizzle.
function exclusionViolation(): Error & { code: string; constraint_name: string } {
  return Object.assign(
    new Error(`conflicting key value violates exclusion constraint "${VEHICLE_BLOCKS_OVERLAP}"`),
    { code: PG_ERROR.EXCLUSION_VIOLATION, constraint_name: VEHICLE_BLOCKS_OVERLAP },
  )
}

export class InMemoryVehicleBlockRepository implements VehicleBlockRepository {
  private readonly store: Map<string, VehicleBlock>

  constructor(store?: Map<string, VehicleBlock>) {
    this.store = store ?? new Map()
  }

  async create(data: Omit<VehicleBlock, 'id' | 'createdAt'>): Promise<VehicleBlock> {
    // The GiST EXCLUDE keys on (operatorId, vehicleId, [startAt,endAt)); a vehicle
    // has exactly one operator, so matching vehicleId + half-open range overlap is
    // equivalent. Adjacent windows (endAt === startAt) do NOT collide.
    const overlaps = [...this.store.values()].some(
      (b) => b.vehicleId === data.vehicleId && b.startAt < data.endAt && b.endAt > data.startAt,
    )
    if (overlaps) throw exclusionViolation()

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
