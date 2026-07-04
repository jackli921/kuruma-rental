import type { ErrorCode } from '@kuruma/shared/lib/error-codes'
import {
  type FeeType,
  type FeeUnit,
  feeUnitCoherenceMessage,
  isCoherentFeeUnit,
} from '@kuruma/shared/validators/fee-schedule'
import type { CallerContext } from '../middleware/auth'
import { FEE_SCHEDULES_CLASS_FK, PG_ERROR, pgConstraintName, pgErrorCode } from '../pg-errors'
import type { FeeSchedule, FeeScheduleFilters, FeeScheduleRepository } from '../repositories/types'
import {
  type CrossOperatorRead,
  applyCrossOperatorReadScope,
  assertFleetWriteWithinOperator,
  fleetWriteDenialResult,
} from '../tenancy'

export type FeeScheduleResult =
  | { ok: true; feeSchedule: FeeSchedule }
  | { ok: false; error: string; status: number; code?: string }

/**
 * The writable surface of a fee-schedule PATCH. Owned by the service so a route
 * passes an intent DTO instead of the persistence entity (#1213 — routes never
 * import from ../stores). Server-derived columns (id/operatorId/timestamps) are
 * absent; every field is optional because a PATCH is partial.
 */
export type FeeScheduleUpdate = Partial<
  Pick<FeeSchedule, 'vehicleClassId' | 'feeType' | 'unit' | 'amountJpy'>
>

const DUPLICATE_SCOPE_MESSAGE =
  'An active fee of this type already exists for this scope. Archive it first.'
const NOT_FOUND_MESSAGE = 'Fee schedule not found'
const INVALID_VEHICLE_CLASS_MESSAGE = 'Invalid vehicle class'

const isDuplicateScope = (err: unknown): boolean => pgErrorCode(err) === PG_ERROR.UNIQUE_VIOLATION

// The composite FK rejects a per-class fee whose vehicleClassId doesn't exist or
// belongs to another operator. Match the constraint name (not the bare 23503) so
// a bad operatorId is not misreported as a bad class. Mapped to 400 + a stable
// code (plan §2: well-formed-but-semantically-invalid stays 400, distinguished by
// the code field — not a new HTTP status).
const isInvalidVehicleClass = (err: unknown): boolean =>
  pgErrorCode(err) === PG_ERROR.FOREIGN_KEY_VIOLATION &&
  pgConstraintName(err) === FEE_SCHEDULES_CLASS_FK

const invalidVehicleClassResult = (): FeeScheduleResult => ({
  ok: false,
  error: INVALID_VEHICLE_CLASS_MESSAGE,
  status: 400,
  code: 'INVALID_VEHICLE_CLASS' satisfies ErrorCode,
})

export class FeeScheduleService {
  constructor(private readonly repo: FeeScheduleRepository) {}

  async findAll(
    ctx: CallerContext,
    read: CrossOperatorRead,
    filters: FeeScheduleFilters = {},
  ): Promise<FeeSchedule[]> {
    return this.repo.findAll(ctx, applyCrossOperatorReadScope(ctx, read, filters))
  }

  async findById(ctx: CallerContext, id: string): Promise<FeeSchedule | undefined> {
    return this.repo.findById(ctx, id)
  }

  /**
   * `data.operatorId` is resolved by the route, so the service stays
   * auth-mechanism-agnostic. The service is the coherence + active-uniqueness
   * seal: it validates fee-type↔unit on the full payload and rejects a second
   * ACTIVE fee of the same (operator, type, scope) with 409. The DB partial
   * unique indexes are the real seal — a lost race maps to the same 409.
   */
  async create(
    _ctx: CallerContext,
    data: Omit<FeeSchedule, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<FeeScheduleResult> {
    const coherence = checkCoherence(data.feeType, data.unit)
    if (coherence) return coherence

    const existing = await this.repo.findActiveByScope(
      data.operatorId,
      data.feeType,
      data.vehicleClassId,
    )
    if (existing) return { ok: false, error: DUPLICATE_SCOPE_MESSAGE, status: 409 }

    try {
      const feeSchedule = await this.repo.create(data)
      return { ok: true, feeSchedule }
    } catch (err) {
      if (isDuplicateScope(err)) return { ok: false, error: DUPLICATE_SCOPE_MESSAGE, status: 409 }
      if (isInvalidVehicleClass(err)) return invalidVehicleClassResult()
      throw err
    }
  }

  /**
   * Merge-then-validate (mirrors VehicleClassService.update): a unit-only PATCH
   * never sees feeType, so the schema's `.superRefine()` can't enforce
   * coherence. Fetch the caller-scoped row, merge the patch, then validate
   * coherence on the MERGED feeType+unit (400) and active-uniqueness on the
   * merged scope EXCLUDING the current row id (409) — so bumping only amountJpy
   * never self-collides. A cross-tenant id reads as undefined -> 404.
   */
  async update(
    ctx: CallerContext,
    id: string,
    data: FeeScheduleUpdate,
    actingOperatorId?: string,
  ): Promise<FeeScheduleResult> {
    const existing = await this.repo.findById(ctx, id)
    if (!existing) return { ok: false, error: NOT_FOUND_MESSAGE, status: 404 }

    // #1442: a bypass admin reads every operator's fees by raw id, so bind this
    // write to the operator it picked — no pick -> 422, wrong pick -> 404. An
    // operator session is already tenant-clamped, so it passes through.
    const denial = assertFleetWriteWithinOperator(ctx, existing.operatorId, actingOperatorId)
    if (denial) return fleetWriteDenialResult(denial, NOT_FOUND_MESSAGE)

    const mergedFeeType = data.feeType ?? existing.feeType
    const mergedUnit = data.unit ?? existing.unit
    const coherence = checkCoherence(mergedFeeType, mergedUnit)
    if (coherence) return coherence

    const mergedClassId =
      data.vehicleClassId !== undefined ? data.vehicleClassId : existing.vehicleClassId
    const keyChanged =
      mergedFeeType !== existing.feeType || mergedClassId !== existing.vehicleClassId
    if (keyChanged) {
      const clash = await this.repo.findActiveByScope(
        existing.operatorId,
        mergedFeeType,
        mergedClassId,
      )
      if (clash && clash.id !== id) {
        return { ok: false, error: DUPLICATE_SCOPE_MESSAGE, status: 409 }
      }
    }

    try {
      const updated = await this.repo.update(ctx, id, data)
      if (!updated) return { ok: false, error: NOT_FOUND_MESSAGE, status: 404 }
      return { ok: true, feeSchedule: updated }
    } catch (err) {
      if (isDuplicateScope(err)) return { ok: false, error: DUPLICATE_SCOPE_MESSAGE, status: 409 }
      if (isInvalidVehicleClass(err)) return invalidVehicleClassResult()
      throw err
    }
  }

  async archive(
    ctx: CallerContext,
    id: string,
    actingOperatorId?: string,
  ): Promise<FeeScheduleResult> {
    const existing = await this.repo.findById(ctx, id)
    if (!existing) return { ok: false, error: NOT_FOUND_MESSAGE, status: 404 }

    // #1442: bind the archive to the picked operator (see update()).
    const denial = assertFleetWriteWithinOperator(ctx, existing.operatorId, actingOperatorId)
    if (denial) return fleetWriteDenialResult(denial, NOT_FOUND_MESSAGE)

    const archived = await this.repo.archive(ctx, id)
    if (!archived) return { ok: false, error: NOT_FOUND_MESSAGE, status: 404 }
    return { ok: true, feeSchedule: archived }
  }
}

/** Returns a 400 failure result when the type/unit pair is incoherent, else null. */
function checkCoherence(
  feeType: FeeType,
  unit: FeeUnit,
): { ok: false; error: string; status: number } | null {
  if (isCoherentFeeUnit(feeType, unit)) return null
  return { ok: false, error: feeUnitCoherenceMessage(feeType), status: 400 }
}
