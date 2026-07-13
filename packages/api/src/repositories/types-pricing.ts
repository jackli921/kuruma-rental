// CLASS_COMBO pricing ports (#464) live in their own module to keep the
// repositories/types.ts barrel under the file-size cap (#978); re-exported for
// callers from ./types.
import type { CallerContext } from '../middleware/auth'
import type { ClassRatePlan } from '../stores'

// Scopes the combo-deal read-side scan (#464). Mirrors the SPECIFIC availability
// scan's location/operator bounding; ACRISS class-filtering stays in the service.
export interface ClassRatePlanFilters {
  operatorId?: string
  locationIds?: string[]
  classId?: string
  pickupLocationId?: string
  isActive?: boolean
}

// Prices CLASS_COMBO bookings (#464 §5.1). findActiveRate = the combo pricing
// lookup (ACTIVE rate per operator+class+pickupLocation, else undefined; caller
// passes a resolved operatorId). findActiveRatePlans = the read-side enumeration
// that surfaces combo cards in search. Operator CRUD lands in slice 6 (#464).
export interface ClassRatePlanRepository {
  // --- read/pricing (existing, unchanged) ---
  findActiveRate(
    operatorId: string,
    classId: string,
    pickupLocationId: string,
  ): Promise<ClassRatePlan | undefined>
  findActiveRatePlans(filters?: ClassRatePlanFilters): Promise<ClassRatePlan[]>
  create(data: Omit<ClassRatePlan, 'id' | 'createdAt' | 'updatedAt'>): Promise<ClassRatePlan>
  // --- operator CRUD (#464 slice 6) ---
  findAll(ctx: CallerContext, filters: ClassRatePlanFilters): Promise<ClassRatePlan[]>
  findById(ctx: CallerContext, id: string): Promise<ClassRatePlan | undefined>
  // Scope-only singleton lookup (ignores isActive) for the 409 pre-check.
  findByScope(
    operatorId: string,
    classId: string,
    pickupLocationId: string,
  ): Promise<ClassRatePlan | undefined>
  update(
    ctx: CallerContext,
    id: string,
    patch: Partial<
      Pick<ClassRatePlan, 'classId' | 'pickupLocationId' | 'dayRateJpy' | 'isActive' | 'label'>
    >,
  ): Promise<ClassRatePlan | undefined>
  remove(ctx: CallerContext, id: string): Promise<ClassRatePlan | undefined>
}
