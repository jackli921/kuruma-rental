import type { ErrorCode } from '@kuruma/shared/lib/error-codes'
import type { CallerContext } from '../middleware/auth'
import {
  CLASS_RATE_PLANS_CLASS_FK,
  CLASS_RATE_PLANS_LOCATION_FK,
  PG_ERROR,
  pgConstraintName,
  pgErrorCode,
} from '../pg-errors'
import type {
  ClassRatePlanFilters,
  ClassRatePlanRepository,
  LocationRepository,
  VehicleClassRepository,
} from '../repositories/types'
import type { ClassRatePlan, Location, VehicleClass } from '../stores'
import {
  type CrossOperatorRead,
  applyCrossOperatorReadScope,
  assertFleetWriteWithinOperator,
  fleetWriteDenialResult,
} from '../tenancy'

export type ClassRatePlanResult =
  | { ok: true; plan: ClassRatePlan }
  | { ok: false; error: string; status: number; code?: string }

export type ClassRatePlanUpdate = Partial<
  Pick<ClassRatePlan, 'classId' | 'pickupLocationId' | 'dayRateJpy' | 'isActive' | 'label'>
>

const DUPLICATE_SCOPE_MESSAGE = 'A rate plan for this operator/class/location scope already exists.'
const NOT_FOUND_MESSAGE = 'Class rate plan not found'
const INVALID_VEHICLE_CLASS_MESSAGE = 'Invalid vehicle class'
const INVALID_LOCATION_MESSAGE = 'Invalid location'

const isDuplicateScope = (err: unknown): boolean => pgErrorCode(err) === PG_ERROR.UNIQUE_VIOLATION

const isInvalidVehicleClassFk = (err: unknown): boolean =>
  pgErrorCode(err) === PG_ERROR.FOREIGN_KEY_VIOLATION &&
  pgConstraintName(err) === CLASS_RATE_PLANS_CLASS_FK

const isInvalidLocationFk = (err: unknown): boolean =>
  pgErrorCode(err) === PG_ERROR.FOREIGN_KEY_VIOLATION &&
  pgConstraintName(err) === CLASS_RATE_PLANS_LOCATION_FK

const invalidVehicleClassResult = (): ClassRatePlanResult => ({
  ok: false,
  error: INVALID_VEHICLE_CLASS_MESSAGE,
  status: 400,
  code: 'INVALID_VEHICLE_CLASS' satisfies ErrorCode,
})

const invalidLocationResult = (): ClassRatePlanResult => ({
  ok: false,
  error: INVALID_LOCATION_MESSAGE,
  status: 400,
  code: 'INVALID_LOCATION' satisfies ErrorCode,
})

/**
 * Publishability check: a rate plan is publishable (can be created or
 * activated) only when its class and location are both ACTIVE and belong to
 * the same operator. Deactivation (isActive=false) is always allowed — the
 * operator may want to wind down a deal for an archived class.
 *
 * Returns an error result when the constraint is violated, or null when clean.
 */
function assertPublishable(
  cls: VehicleClass | undefined,
  loc: Location | undefined,
  operatorId: string,
): ClassRatePlanResult | null {
  if (!cls || cls.status === 'ARCHIVED' || cls.operatorId !== operatorId) {
    return invalidVehicleClassResult()
  }
  if (!loc || loc.status === 'ARCHIVED' || loc.operatorId !== operatorId) {
    return invalidLocationResult()
  }
  return null
}

export class ClassRatePlanService {
  constructor(
    private readonly repo: ClassRatePlanRepository,
    private readonly classRepo: Pick<VehicleClassRepository, 'findById'>,
    private readonly locationRepo: Pick<LocationRepository, 'findById'>,
  ) {}

  async findAll(
    ctx: CallerContext,
    read: CrossOperatorRead,
    filters: ClassRatePlanFilters = {},
  ): Promise<ClassRatePlan[]> {
    return this.repo.findAll(ctx, applyCrossOperatorReadScope(ctx, read, filters))
  }

  async findById(ctx: CallerContext, id: string): Promise<ClassRatePlan | undefined> {
    return this.repo.findById(ctx, id)
  }

  async create(
    ctx: CallerContext,
    data: Omit<ClassRatePlan, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ClassRatePlanResult> {
    // Publishability: always check — reject creating a deal whose class or
    // location is archived or cross-operator, regardless of isActive (Q-B).
    const [cls, loc] = await Promise.all([
      this.classRepo.findById(ctx, data.classId),
      this.locationRepo.findById(ctx, data.pickupLocationId),
    ])
    const denial = assertPublishable(cls, loc, data.operatorId)
    if (denial) return denial

    const existing = await this.repo.findByScope(
      data.operatorId,
      data.classId,
      data.pickupLocationId,
    )
    if (existing) return { ok: false, error: DUPLICATE_SCOPE_MESSAGE, status: 409 }

    try {
      const plan = await this.repo.create(data)
      return { ok: true, plan }
    } catch (err) {
      if (isDuplicateScope(err)) return { ok: false, error: DUPLICATE_SCOPE_MESSAGE, status: 409 }
      if (isInvalidVehicleClassFk(err)) return invalidVehicleClassResult()
      if (isInvalidLocationFk(err)) return invalidLocationResult()
      throw err
    }
  }

  async update(
    ctx: CallerContext,
    id: string,
    patch: ClassRatePlanUpdate,
    actingOperatorId?: string,
  ): Promise<ClassRatePlanResult> {
    const existing = await this.repo.findById(ctx, id)
    if (!existing) return { ok: false, error: NOT_FOUND_MESSAGE, status: 404 }

    const denial = assertFleetWriteWithinOperator(ctx, existing.operatorId, actingOperatorId)
    if (denial) return fleetWriteDenialResult(denial, NOT_FOUND_MESSAGE)

    // Q-B publishability rule:
    // - Deactivation (isActive: false) is always allowed.
    // - A rate/label-only edit of an already-active plan is allowed even if
    //   the class is now archived (the deal is already live; locking out edits
    //   would prevent the operator from correcting the price or winding it down).
    // - Publishability check runs only when:
    //   (a) activating (false -> true), OR
    //   (b) retargeting class/location while the deal is (or will be) active.
    const willBeActive = patch.isActive !== undefined ? patch.isActive : existing.isActive
    const isActivating = !existing.isActive && willBeActive === true
    const retargetingClass = patch.classId !== undefined && patch.classId !== existing.classId
    const retargetingLocation =
      patch.pickupLocationId !== undefined && patch.pickupLocationId !== existing.pickupLocationId
    const needsPublishabilityCheck =
      isActivating || ((retargetingClass || retargetingLocation) && willBeActive)

    const mergedClassId = patch.classId ?? existing.classId
    const mergedLocationId = patch.pickupLocationId ?? existing.pickupLocationId
    const targetChanged = retargetingClass || retargetingLocation

    if (needsPublishabilityCheck) {
      const [cls, loc] = await Promise.all([
        this.classRepo.findById(ctx, mergedClassId),
        this.locationRepo.findById(ctx, mergedLocationId),
      ])
      const publishDenial = assertPublishable(cls, loc, existing.operatorId)
      if (publishDenial) return publishDenial
    }

    if (targetChanged) {
      const clash = await this.repo.findByScope(
        existing.operatorId,
        mergedClassId,
        mergedLocationId,
      )
      if (clash && clash.id !== id)
        return { ok: false, error: DUPLICATE_SCOPE_MESSAGE, status: 409 }
    }

    try {
      const updated = await this.repo.update(ctx, id, patch)
      if (!updated) return { ok: false, error: NOT_FOUND_MESSAGE, status: 404 }
      return { ok: true, plan: updated }
    } catch (err) {
      if (isDuplicateScope(err)) return { ok: false, error: DUPLICATE_SCOPE_MESSAGE, status: 409 }
      if (isInvalidVehicleClassFk(err)) return invalidVehicleClassResult()
      if (isInvalidLocationFk(err)) return invalidLocationResult()
      throw err
    }
  }

  async remove(
    ctx: CallerContext,
    id: string,
    actingOperatorId?: string,
  ): Promise<ClassRatePlanResult> {
    const existing = await this.repo.findById(ctx, id)
    if (!existing) return { ok: false, error: NOT_FOUND_MESSAGE, status: 404 }

    const denial = assertFleetWriteWithinOperator(ctx, existing.operatorId, actingOperatorId)
    if (denial) return fleetWriteDenialResult(denial, NOT_FOUND_MESSAGE)

    const removed = await this.repo.remove(ctx, id)
    if (!removed) return { ok: false, error: NOT_FOUND_MESSAGE, status: 404 }
    return { ok: true, plan: removed }
  }
}
