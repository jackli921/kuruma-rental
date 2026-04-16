import type {
  MaintenanceLog,
  MaintenanceLogRepository,
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
  ) {}

  async toggleStatus(
    vehicleId: string,
    status: Vehicle['status'],
    reason?: string,
    now: Date = new Date(),
  ): Promise<ToggleStatusResult> {
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

    // Conditional update — fails if another request already changed the status
    const updated = await this.vehicleRepo.update(
      vehicleId,
      { status },
      { expectedStatus: existing.status },
    )
    if (!updated) {
      return { ok: false, status: 409, error: 'Vehicle status was modified concurrently' }
    }

    // Atomic log transition: resolve active log + optionally create new one
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

    if (existing.status === 'MAINTENANCE' || newLogData) {
      const { created } = await this.maintenanceLogRepo.transitionLogs(vehicleId, now, newLogData)
      if (created) return { ok: true, vehicle: updated, log: created }
    }

    return { ok: true, vehicle: updated }
  }

  async findLogsByVehicleId(vehicleId: string): Promise<MaintenanceLog[]> {
    return this.maintenanceLogRepo.findByVehicleId(vehicleId)
  }

  async findActiveLog(vehicleId: string): Promise<MaintenanceLog | undefined> {
    return this.maintenanceLogRepo.findActiveByVehicleId(vehicleId)
  }
}
