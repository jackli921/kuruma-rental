import type { MaintenanceLog } from '../../stores'
import type { MaintenanceLogRepository } from '../types'

export class InMemoryMaintenanceLogRepository implements MaintenanceLogRepository {
  private readonly store: Map<string, MaintenanceLog>
  private insertOrder = 0

  // Maps log id → insertion order for deterministic "most recent first" sort
  // when createdAt timestamps are identical (sub-ms test execution).
  private readonly orderMap = new Map<string, number>()

  constructor(store?: Map<string, MaintenanceLog>) {
    this.store = store ?? new Map()
  }

  async findByVehicleId(vehicleId: string): Promise<MaintenanceLog[]> {
    return [...this.store.values()]
      .filter((log) => log.vehicleId === vehicleId)
      .sort((a, b) => {
        const timeDiff = b.createdAt.getTime() - a.createdAt.getTime()
        if (timeDiff !== 0) return timeDiff
        return (this.orderMap.get(b.id) ?? 0) - (this.orderMap.get(a.id) ?? 0)
      })
  }

  async findActiveByVehicleId(vehicleId: string): Promise<MaintenanceLog | undefined> {
    return [...this.store.values()].find(
      (log) => log.vehicleId === vehicleId && log.resolvedAt === null,
    )
  }

  async create(
    data: Omit<MaintenanceLog, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<MaintenanceLog> {
    const now = new Date()
    const log: MaintenanceLog = {
      ...data,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    }
    this.store.set(log.id, log)
    this.orderMap.set(log.id, this.insertOrder++)
    return log
  }

  async resolve(id: string, resolvedAt: Date): Promise<MaintenanceLog | undefined> {
    const existing = this.store.get(id)
    if (!existing) return undefined

    const resolved: MaintenanceLog = {
      ...existing,
      resolvedAt,
      updatedAt: new Date(),
    }
    this.store.set(resolved.id, resolved)
    return resolved
  }
}
