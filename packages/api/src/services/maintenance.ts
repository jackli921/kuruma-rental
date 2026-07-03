import type { ErrorCode } from '@kuruma/shared/lib/error-codes'
import type { CallerContext } from '../middleware/auth'
import type {
  MaintenanceLog,
  MaintenanceLogRepository,
  RunInTransaction,
  VehicleRepository,
} from '../repositories/types'
import type { Vehicle } from '../stores'
import { assertFleetWriteWithinOperator, fleetWriteDenialResult } from '../tenancy'

export type ToggleStatusResult =
  | { ok: true; vehicle: Vehicle; log?: MaintenanceLog }
  | { ok: false; status: 400 | 404 | 409 | 422; error: string; code?: ErrorCode }

export class MaintenanceService {
  constructor(
    private readonly vehicleRepo: VehicleRepository,
    private readonly maintenanceLogRepo: MaintenanceLogRepository,
    private readonly runInTransaction: RunInTransaction,
  ) {}

  async toggleStatus(
    ctx: CallerContext,
    vehicleId: string,
    status: Vehicle['status'],
    reason?: string,
    actingOperatorId?: string,
    now: Date = new Date(),
  ): Promise<ToggleStatusResult> {
    // Reads + validation outside the transaction
    const existing = await this.vehicleRepo.findById(ctx, vehicleId)
    if (!existing) {
      return { ok: false, status: 404, error: 'Vehicle not found' }
    }

    // #1260: an all-scope caller (PLATFORM_ADMIN / legacy STAFF) reads every
    // operator's vehicles, so bind this status write to the operator it picked —
    // no pick -> 422, wrong pick -> 404 (mirrors VehicleService.update).
    const denial = assertFleetWriteWithinOperator(ctx, existing.operatorId, actingOperatorId)
    if (denial) return fleetWriteDenialResult(denial, 'Vehicle not found')

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
        ctx,
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

  async findLogsByVehicleId(ctx: CallerContext, vehicleId: string): Promise<MaintenanceLog[]> {
    // Tenant boundary (#705, mirrors vehicle-detail): the scoped findById is the
    // join on vehicles.operatorId — it returns undefined for a foreign-tenant
    // (or scope-less OPERATOR_*) caller, so we return [] rather than leaking
    // another operator's maintenance history. maintenance_logs has no operatorId
    // column, so scoping flows through the already-authorised vehicle row.
    const vehicle = await this.vehicleRepo.findById(ctx, vehicleId)
    if (!vehicle) return []

    return this.maintenanceLogRepo.findByVehicleId(vehicleId)
  }

  async findActiveLog(vehicleId: string): Promise<MaintenanceLog | undefined> {
    return this.maintenanceLogRepo.findActiveByVehicleId(vehicleId)
  }
}
