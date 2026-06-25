// CLASS_COMBO pricing ports (#464) live in their own module to keep the
// repositories/types.ts barrel under the file-size cap (#978); re-exported for
// callers from ./types.
import type { ClassRatePlan } from '../stores'

// Scopes the combo-deal read-side scan (#464). Mirrors the SPECIFIC availability
// scan's location/operator bounding; ACRISS class-filtering stays in the service.
export interface ClassRatePlanFilters {
  operatorId?: string
  locationIds?: string[]
}

// Prices CLASS_COMBO bookings (#464 §5.1). findActiveRate = the combo pricing
// lookup (ACTIVE rate per operator+class+pickupLocation, else undefined; caller
// passes a resolved operatorId). findActiveRatePlans = the read-side enumeration
// that surfaces combo cards in search. CRUD lands with slice 6; the DB UNIQUE seals it.
export interface ClassRatePlanRepository {
  findActiveRate(
    operatorId: string,
    classId: string,
    pickupLocationId: string,
  ): Promise<ClassRatePlan | undefined>
  findActiveRatePlans(filters?: ClassRatePlanFilters): Promise<ClassRatePlan[]>
  create(data: Omit<ClassRatePlan, 'id' | 'createdAt' | 'updatedAt'>): Promise<ClassRatePlan>
}
