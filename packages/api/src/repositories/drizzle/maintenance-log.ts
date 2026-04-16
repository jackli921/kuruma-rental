import { maintenanceLogs } from '@kuruma/shared/db/schema'
import { and, desc, eq, isNull } from 'drizzle-orm'
import type { MaintenanceLog } from '../../stores'
import type { MaintenanceLogRepository, TransitionLogsResult } from '../types'
import { type Db, maintenanceLogColumns, toMaintenanceLog } from './shared'

export class DrizzleMaintenanceLogRepository implements MaintenanceLogRepository {
  constructor(private readonly db: Db) {}

  async findByVehicleId(vehicleId: string): Promise<MaintenanceLog[]> {
    const rows = await this.db
      .select(maintenanceLogColumns)
      .from(maintenanceLogs)
      .where(eq(maintenanceLogs.vehicleId, vehicleId))
      .orderBy(desc(maintenanceLogs.createdAt))
    return rows.map(toMaintenanceLog)
  }

  async findActiveByVehicleId(vehicleId: string): Promise<MaintenanceLog | undefined> {
    const rows = await this.db
      .select(maintenanceLogColumns)
      .from(maintenanceLogs)
      .where(and(eq(maintenanceLogs.vehicleId, vehicleId), isNull(maintenanceLogs.resolvedAt)))
      .limit(1)
    const row = rows[0]
    return row ? toMaintenanceLog(row) : undefined
  }

  async create(
    data: Omit<MaintenanceLog, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<MaintenanceLog> {
    const rows = await this.db
      .insert(maintenanceLogs)
      .values({
        vehicleId: data.vehicleId,
        reason: data.reason,
        notes: data.notes,
        costJpy: data.costJpy,
        startedAt: data.startedAt,
        resolvedAt: data.resolvedAt,
      })
      .returning(maintenanceLogColumns)
    return toMaintenanceLog(rows[0]!)
  }

  async resolve(id: string, resolvedAt: Date): Promise<MaintenanceLog | undefined> {
    const rows = await this.db
      .update(maintenanceLogs)
      .set({ resolvedAt, updatedAt: new Date() })
      .where(eq(maintenanceLogs.id, id))
      .returning(maintenanceLogColumns)
    const row = rows[0]
    return row ? toMaintenanceLog(row) : undefined
  }

  async transitionLogs(
    vehicleId: string,
    resolvedAt: Date,
    newLogData?: Omit<MaintenanceLog, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<TransitionLogsResult> {
    return this.db.transaction(async (tx) => {
      const result: TransitionLogsResult = {}

      // Resolve any active log
      const [activeRow] = await tx
        .select(maintenanceLogColumns)
        .from(maintenanceLogs)
        .where(and(eq(maintenanceLogs.vehicleId, vehicleId), isNull(maintenanceLogs.resolvedAt)))
        .limit(1)

      if (activeRow) {
        const [resolved] = await tx
          .update(maintenanceLogs)
          .set({ resolvedAt, updatedAt: new Date() })
          .where(eq(maintenanceLogs.id, activeRow.id))
          .returning(maintenanceLogColumns)
        if (resolved) result.resolved = toMaintenanceLog(resolved)
      }

      // Create new log if entering MAINTENANCE
      if (newLogData) {
        const [created] = await tx
          .insert(maintenanceLogs)
          .values({
            vehicleId: newLogData.vehicleId,
            reason: newLogData.reason,
            notes: newLogData.notes,
            costJpy: newLogData.costJpy,
            startedAt: newLogData.startedAt,
            resolvedAt: newLogData.resolvedAt,
          })
          .returning(maintenanceLogColumns)
        if (created) result.created = toMaintenanceLog(created)
      }

      return result
    })
  }
}
