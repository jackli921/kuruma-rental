import type { ErrorCode } from '@kuruma/shared/lib/error-codes'
import type { CreateVehicleBlockInput } from '@kuruma/shared/validators/vehicle-block'
import { type CallerContext, requireFleetWriteScope } from '../middleware/auth'
import { PG_ERROR, VEHICLE_BLOCKS_OVERLAP, pgConstraintName, pgErrorCode } from '../pg-errors'
import type {
  BookingRepository,
  VehicleBlock,
  VehicleBlockRepository,
  VehicleRepository,
} from '../repositories/types'
import {
  assertFleetWriteWithinOperator,
  narrowReadToOperator,
  vehicleBlockReadScope,
} from '../tenancy'

export type VehicleBlockResult =
  | { ok: true; block: VehicleBlock }
  | { ok: false; error: string; status: number; code?: ErrorCode }

const VEHICLE_NOT_FOUND_MESSAGE = 'Vehicle not found'
const OPERATOR_REQUIRED_MESSAGE = 'operatorId is required: specify the operator to act as'
const BLOCK_NOT_FOUND_MESSAGE = 'Block not found'
const OVERLAP_MESSAGE = 'This vehicle is already blocked for an overlapping window'
const BOOKING_CONFLICT_MESSAGE =
  'This vehicle has a confirmed or active booking in the requested window'

// #1260: map the acting-operator-binding denial to the service result. A missing
// pick is a 422 carrying the same OPERATOR_REQUIRED code the global
// OperatorRequiredError emits (so the web can discriminate it); a mismatch is a
// 404 — from the acting operator's fleet the vehicle does not exist (no oracle).
function denyFleetWrite(
  ctx: CallerContext,
  targetOperatorId: string,
  actingOperatorId: string | undefined,
): VehicleBlockResult | undefined {
  const denial = assertFleetWriteWithinOperator(ctx, targetOperatorId, actingOperatorId)
  if (!denial) return undefined
  return denial.kind === 'operator-required'
    ? { ok: false, error: OPERATOR_REQUIRED_MESSAGE, status: 422, code: 'OPERATOR_REQUIRED' }
    : { ok: false, error: VEHICLE_NOT_FOUND_MESSAGE, status: 404 }
}

// The GiST EXCLUDE is named `vehicle_blocks_no_overlap`; match the name (not the
// bare 23P01) so a block-vs-block clash is told apart from any other exclusion.
const isBlockOverlap = (err: unknown): boolean =>
  pgErrorCode(err) === PG_ERROR.EXCLUSION_VIOLATION &&
  pgConstraintName(err) === VEHICLE_BLOCKS_OVERLAP

/**
 * #1101: operator-scoped writes for scheduled vehicle blocks. Two independent
 * seals: `requireFleetWriteScope(ctx)` re-asserts the write role + operator scope
 * at this layer (defence in depth vs a forgotten route gate, #329 — the
 * VehicleBlockRepository takes no ctx, so the guard lives here rather than in the
 * repo like DrizzleVehicleRepository), and `vehicleRepo.findById(ctx, …)` is the
 * tenant boundary (a foreign-tenant or unknown vehicleId resolves to undefined →
 * 404). operatorId/createdBy are derived server-side from the resolved vehicle +
 * caller, never client input. Block-vs-block overlap is the DB GiST EXCLUDE,
 * surfaced as a 409; the validator already guarantees endAt > startAt so the
 * CHECK (23514) is a defence-in-depth 400.
 */
export class VehicleBlockService {
  constructor(
    private readonly vehicleRepo: VehicleRepository,
    private readonly vehicleBlockRepo: VehicleBlockRepository,
    // #1196: narrow read port (ISP) for the reverse block→booking guard. Only the
    // overlap lookup is needed, so the service can't reach into the rest of the
    // booking repo; the composition root injects the concrete BookingRepository.
    private readonly bookingRepo: Pick<BookingRepository, 'findActiveOverlappingForVehicle'>,
  ) {}

  async createBlock(
    ctx: CallerContext,
    vehicleId: string,
    input: CreateVehicleBlockInput,
    actingOperatorId?: string,
  ): Promise<VehicleBlockResult> {
    requireFleetWriteScope(ctx)

    const vehicle = await this.vehicleRepo.findById(ctx, vehicleId)
    if (!vehicle) return { ok: false, error: VEHICLE_NOT_FOUND_MESSAGE, status: 404 }

    // #1260: an admin/legacy caller resolves vehicles across all operators, so bind
    // the write to the operator it picked before deriving operatorId from the vehicle.
    const denied = denyFleetWrite(ctx, vehicle.operatorId, actingOperatorId)
    if (denied) return denied

    // #1196: reject a block that would silently take a car off the calendar while
    // a CONFIRMED/ACTIVE booking still holds it — the reverse of the booking→block
    // VEHICLE_BLOCKED guard, over the same turnaround-inclusive window. Like that
    // guard, this is a service-level NOT EXISTS (no single GiST EXCLUDE can span
    // bookings + vehicle_blocks); the residual schedule-during-checkout race is the
    // same tiny, operator-recoverable one documented on the booking side.
    const bookingConflicts = await this.bookingRepo.findActiveOverlappingForVehicle(
      vehicle.id,
      new Date(input.startAt),
      new Date(input.endAt),
    )
    if (bookingConflicts.length > 0) {
      return {
        ok: false,
        error: BOOKING_CONFLICT_MESSAGE,
        status: 409,
        code: 'BLOCK_BOOKING_CONFLICT' satisfies ErrorCode,
      }
    }

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
    actingOperatorId?: string,
  ): Promise<VehicleBlockResult> {
    requireFleetWriteScope(ctx)

    // Resolve the vehicle in the caller's tenant first: this both authorises the
    // caller and yields the operatorId the scoped delete keys on. A foreign or
    // unknown vehicleId → 404 before any write is attempted.
    const vehicle = await this.vehicleRepo.findById(ctx, vehicleId)
    if (!vehicle) return { ok: false, error: VEHICLE_NOT_FOUND_MESSAGE, status: 404 }

    // #1260: bind an admin/legacy delete to the operator it picked (see createBlock).
    const denied = denyFleetWrite(ctx, vehicle.operatorId, actingOperatorId)
    if (denied) return denied

    const removed = await this.vehicleBlockRepo.delete(blockId, vehicle.operatorId)
    if (!removed) return { ok: false, error: BLOCK_NOT_FOUND_MESSAGE, status: 404 }
    return { ok: true, block: removed }
  }

  /**
   * Fleet-wide read for the operator calendar. Row-scope is enforced in the repo
   * via `vehicleBlockReadScope(ctx)` (operator → own tenant, admin → all, else →
   * []), so this is a thin delegation — no separate scope check to drift.
   */
  async listBlocks(
    ctx: CallerContext,
    from: Date,
    to: Date,
    requestedOperatorId?: string,
  ): Promise<VehicleBlock[]> {
    // #1230 slice 5b: a picker admin narrows the fleet-wide read to one operator.
    // vehicleBlockReadScope's `all` is bypass-only, so only an admin's id survives.
    const operatorId = narrowReadToOperator(ctx, requestedOperatorId, vehicleBlockReadScope)
    return this.vehicleBlockRepo.findOverlappingInRange(ctx, from, to, operatorId)
  }
}
