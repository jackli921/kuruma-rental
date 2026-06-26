import type { ErrorCode } from '@kuruma/shared/lib/error-codes'
import type { CreateVehicleBlockInput } from '@kuruma/shared/validators/vehicle-block'
import type { CallerContext } from '../middleware/auth'
import { PG_ERROR, VEHICLE_BLOCKS_OVERLAP, pgConstraintName, pgErrorCode } from '../pg-errors'
import type { VehicleBlock, VehicleBlockRepository, VehicleRepository } from '../repositories/types'

export type VehicleBlockResult =
  | { ok: true; block: VehicleBlock }
  | { ok: false; error: string; status: number; code?: string }

const VEHICLE_NOT_FOUND_MESSAGE = 'Vehicle not found'
const BLOCK_NOT_FOUND_MESSAGE = 'Block not found'
const OVERLAP_MESSAGE = 'This vehicle is already blocked for an overlapping window'

// The GiST EXCLUDE is named `vehicle_blocks_no_overlap`; match the name (not the
// bare 23P01) so a block-vs-block clash is told apart from any other exclusion.
const isBlockOverlap = (err: unknown): boolean =>
  pgErrorCode(err) === PG_ERROR.EXCLUSION_VIOLATION &&
  pgConstraintName(err) === VEHICLE_BLOCKS_OVERLAP

/**
 * #1101: operator-scoped writes for scheduled vehicle blocks. The vehicle is the
 * tenant anchor — `vehicleRepo.findById(ctx, …)` is the authorisation boundary
 * (a foreign-tenant or unknown vehicleId resolves to undefined → 404), and
 * operatorId/createdBy are derived server-side from the resolved vehicle + caller,
 * never client input. Block-vs-block overlap is the DB GiST EXCLUDE, surfaced as a
 * 409; the validator already guarantees endAt > startAt so the CHECK (23514) is a
 * defence-in-depth 400.
 */
export class VehicleBlockService {
  constructor(
    private readonly vehicleRepo: VehicleRepository,
    private readonly vehicleBlockRepo: VehicleBlockRepository,
  ) {}

  async createBlock(
    ctx: CallerContext,
    vehicleId: string,
    input: CreateVehicleBlockInput,
  ): Promise<VehicleBlockResult> {
    const vehicle = await this.vehicleRepo.findById(ctx, vehicleId)
    if (!vehicle) return { ok: false, error: VEHICLE_NOT_FOUND_MESSAGE, status: 404 }

    try {
      const block = await this.vehicleBlockRepo.create({
        operatorId: vehicle.operatorId,
        vehicleId: vehicle.id,
        startAt: new Date(input.startAt),
        endAt: new Date(input.endAt),
        kind: input.kind,
        reason: input.reason,
        notes: input.notes ?? null,
        createdBy: ctx.userId,
      })
      return { ok: true, block }
    } catch (err) {
      if (isBlockOverlap(err)) {
        return {
          ok: false,
          error: OVERLAP_MESSAGE,
          status: 409,
          code: 'VEHICLE_BLOCK_OVERLAP' satisfies ErrorCode,
        }
      }
      // Defence-in-depth: the validator already rejects endAt <= startAt, so a
      // CHECK violation here means a malformed write slipped past — still a 400.
      if (pgErrorCode(err) === PG_ERROR.CHECK_VIOLATION) {
        return { ok: false, error: 'endAt must be after startAt', status: 400 }
      }
      throw err
    }
  }

  async deleteBlock(
    ctx: CallerContext,
    vehicleId: string,
    blockId: string,
  ): Promise<VehicleBlockResult> {
    // Resolve the vehicle in the caller's tenant first: this both authorises the
    // caller and yields the operatorId the scoped delete keys on. A foreign or
    // unknown vehicleId → 404 before any write is attempted.
    const vehicle = await this.vehicleRepo.findById(ctx, vehicleId)
    if (!vehicle) return { ok: false, error: VEHICLE_NOT_FOUND_MESSAGE, status: 404 }

    const removed = await this.vehicleBlockRepo.delete(blockId, vehicle.operatorId)
    if (!removed) return { ok: false, error: BLOCK_NOT_FOUND_MESSAGE, status: 404 }
    return { ok: true, block: removed }
  }
}
