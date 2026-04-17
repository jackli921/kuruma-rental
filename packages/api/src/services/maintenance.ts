import type {
  MaintenanceLog,
  MaintenanceLogRepository,
  RunInTransaction,
  VehicleRepository,
} from '../repositories/types'
import type { Vehicle } from '../stores'

export type ToggleStatusResult =
  | { ok: true; vehicle: Vehicle; log?: MaintenanceLog }
  | { ok: false; status: 400 | 404 | 409; error: string }

export class MaintenanceService {
  constructor(
    private readonly vehicleRepo: VehicleRepository,
    private readonly maintenanceLogRepo: MaintenanceLogRepository,
    private readonly runInTransaction: RunInTransaction,
  ) {}

  async toggleStatus(
    vehicleId: string,
    status: Vehicle['status'],
    reason?: string,
    now: Date = new Date(),
  ): Promise<ToggleStatusResult> {
    // Reads + validation outside the transaction
    const existing = await this.vehicleRepo.findById(vehicleId)
    if (!existing) {
      return { ok: false, status: 404, error: 'Vehicle not found' }
    }

    if (status === 'MAINTENANCE' && !reason?.trim()) {
      return {
        ok: false,
        status: 400,
        error: 'Reason is required when setting status to MAINTENANCE',
      }
    }

    const newLogData =
      status === 'MAINTENANCE' && reason
        ? {
            vehicleId,
            reason: reason.trim(),
            notes: null,
            costJpy: null,
            startedAt: now,
            resolvedAt: null,
          }
        : undefined

    // Both writes inside a single transaction — if the log transition fails,
    // the vehicle status update is rolled back (Drizzle: DB transaction;
    // InMemory: simulated via snapshot/restore in tests).
    return this.runInTransaction(async ({ vehicleRepo, maintenanceLogRepo }) => {
      const updated = await vehicleRepo.update(
        vehicleId,
        { status },
        { expectedStatus: existing.status },
      )
      if (!updated) {
        return {
          ok: false as const,
          status: 409 as const,
          error: 'Vehicle status was modified concurrently',
        }
      }

      if (existing.status === 'MAINTENANCE' || newLogData) {
        const { created } = await maintenanceLogRepo.transitionLogs(vehicleId, now, newLogData)
        if (created) return { ok: true as const, vehicle: updated, log: created }
      }

      return { ok: true as const, vehicle: updated }
    })
  }

  async findLogsByVehicleId(vehicleId: string): Promise<MaintenanceLog[]> {
    return this.maintenanceLogRepo.findByVehicleId(vehicleId)
  }

  async findActiveLog(vehicleId: string): Promise<MaintenanceLog | undefined> {
    return this.maintenanceLogRepo.findActiveByVehicleId(vehicleId)
  }
}
