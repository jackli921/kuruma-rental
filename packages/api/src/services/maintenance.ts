import type {
  MaintenanceLog,
  MaintenanceLogRepository,
  VehicleRepository,
} from '../repositories/types'
import type { Vehicle } from '../stores'

export type ToggleStatusResult =
  | { ok: true; vehicle: Vehicle; log?: MaintenanceLog }
  | { ok: false; status: 400 | 404; error: string }

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

    // Always resolve any active log before creating a new one.
    // Handles both MAINTENANCE→AVAILABLE and MAINTENANCE→MAINTENANCE (H3 fix).
    if (existing.status === 'MAINTENANCE') {
      const activeLog = await this.maintenanceLogRepo.findActiveByVehicleId(vehicleId)
      if (activeLog) {
        await this.maintenanceLogRepo.resolve(activeLog.id, now)
      }
    }

    const updated = await this.vehicleRepo.update(vehicleId, { status })
    if (!updated) {
      return { ok: false, status: 404, error: 'Vehicle not found' }
    }

    // Create a log entry when entering MAINTENANCE
    if (status === 'MAINTENANCE' && reason) {
      const log = await this.maintenanceLogRepo.create({
        vehicleId,
        reason: reason.trim(),
        notes: null,
        costJpy: null,
        startedAt: now,
        resolvedAt: null,
      })
      return { ok: true, vehicle: updated, log }
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
