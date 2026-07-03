import type { ClassComboSearchResult, ResultLocation } from '@kuruma/shared/types/search-result'
import type {
  AvailabilityRepository,
  ClassRatePlanFilters,
  ClassRatePlanRepository,
  VehicleClass,
} from '../repositories/types'
import type { ClassRatePlan } from '../stores'

export interface FindOfferingsArgs {
  planFilters: ClassRatePlanFilters
  from: Date
  to: Date
  locationById: Map<string, ResultLocation>
  classById: Map<string, VehicleClass>
  requested: Set<string> | null
}

/**
 * The CLASS_COMBO producer (#464): each active class rate plan whose pickup
 * location is an in-scope, mappable storefront and whose road-legal supply
 * currently exceeds demand becomes one `ClassComboSearchResult` (an exact car
 * assigned on pickup day), sized by supply minus overlapping demand.
 *
 * Extracted from `FlatSearchService` so cross-operator flat search and a single
 * storefront's detail page can share one producer. It stays agnostic to caller
 * context: the caller pre-builds the `locationById`/`classById` maps (flat search
 * and storefront-detail build them differently) and passes the scan scope in.
 */
export class ClassOfferingService {
  constructor(
    private readonly classRatePlanRepo: ClassRatePlanRepository,
    private readonly availabilityRepo: AvailabilityRepository,
  ) {}

  // #464: one CLASS_COMBO card per active rate plan whose pickup location is an
  // in-scope storefront and whose road-legal supply currently exceeds demand.
  // N+1 note (bounded): two count queries per plan, fired concurrently. A combo is
  // one row per (operator, class, location) offered, so P stays small at MVP scale;
  // collapse to one grouped query if plan volume ever grows — the same deferral the
  // SPECIFIC pagination comment records.
  async findOfferings({
    planFilters,
    from,
    to,
    locationById,
    classById,
    requested,
  }: FindOfferingsArgs): Promise<ClassComboSearchResult[]> {
    const plans = await this.classRatePlanRepo.findActiveRatePlans(planFilters)
    const cards = await Promise.all(
      plans.map((plan) => this.toCombo(plan, from, to, locationById, classById, requested)),
    )
    return cards.filter((c): c is ClassComboSearchResult => c !== null)
  }

  private async toCombo(
    plan: ClassRatePlan,
    from: Date,
    to: Date,
    locationById: Map<string, ResultLocation>,
    classById: Map<string, VehicleClass>,
    requested: Set<string> | null,
  ): Promise<ClassComboSearchResult | null> {
    // The plan's pickup location must be an in-scope active storefront (mappable).
    const location = locationById.get(plan.pickupLocationId)
    if (!location) return null

    const vc = classById.get(plan.classId)
    const acrissCode = vc?.acrissCode ?? null
    // Same ACRISS class filter the SPECIFIC producer applies (toSpecific).
    if (requested && (acrissCode == null || !requested.has(acrissCode))) return null

    // availableCount = road-legal supply − overlapping demand (floating + specific),
    // both keyed on the (operator, class, location) triple. asOf = the return date,
    // so a combo never surfaces a class whose only cars lapse before `to` (§5.2).
    const [capacity, demand] = await Promise.all([
      this.availabilityRepo.countClassCapacity(
        plan.operatorId,
        plan.classId,
        plan.pickupLocationId,
        from,
        to,
        to,
      ),
      this.availabilityRepo.countClassDemand(
        plan.operatorId,
        plan.classId,
        plan.pickupLocationId,
        from,
        to,
      ),
    ])
    const availableCount = Math.max(0, capacity - demand)
    if (availableCount <= 0) return null

    return {
      kind: 'CLASS_COMBO',
      location,
      dailyRateJpy: plan.dayRateJpy,
      hourlyRateJpy: null,
      classLabel: vc?.name ?? '',
      acrissCode,
      seats: vc?.seats ?? 0,
      photos: vc?.photos ?? [],
      classId: plan.classId,
      availableCount,
    }
  }
}
