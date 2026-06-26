import type {
  ClassComboSearchResult,
  ResultLocation,
  SearchResultItem,
  SearchResultsData,
  SpecificSearchResult,
} from '@kuruma/shared/types/search-result'
import type { CallerContext } from '../middleware/auth'
import type {
  AvailabilityFilters,
  AvailabilityRepository,
  ClassRatePlanFilters,
  ClassRatePlanRepository,
  RegionRepository,
  Storefront,
  StorefrontFilters,
  StorefrontRepository,
  Vehicle,
  VehicleClass,
  VehicleClassRepository,
} from '../repositories/types'
import type { ClassRatePlan } from '../stores'
import { clampLimit, decodeCursor, encodeCursor } from './search-paging'

export type FlatSearchResult =
  | { ok: true; data: SearchResultsData }
  | { ok: false; error: string; status: number }

export interface FlatSearchParams {
  from: Date
  to: Date
  /** Narrow to a single storefront. */
  pickupLocationId?: string
  /** #394: keep results in this region node + its recursive descendants. */
  regionId?: string
  /** Narrow to one operator's inventory. */
  operatorId?: string
  /** ACRISS codes to keep; an item with no matching code is dropped. */
  classes?: string[]
  limit?: number
  cursor?: string
}

/**
 * Public cross-operator flat vehicle search (#458). A new presentation over the
 * slice-5 availability data: instead of grouping the single availability scan
 * into per-store cards (StorefrontSearchService), it flattens it into one
 * `SpecificSearchResult` per physical car, each pinned to its pickup location's
 * real coordinates (D2). Auth-agnostic — the route builds PUBLIC_CONTEXT.
 * Renter-safe: builds the DTO from whitelisted columns only (no licence plate,
 * no operator internals — D3). Reuses the exact same `findAvailableVehicles`
 * scan as slice 5; no new availability model.
 *
 * #464: a SECOND producer runs over the same page scope — each active class rate
 * plan at an in-scope storefront becomes one `ClassComboSearchResult` (an exact car
 * assigned on pickup day), sized by road-legal supply minus overlapping demand.
 * Both producers merge into one ordered, cursor-paginated list.
 */
export class FlatSearchService {
  constructor(
    private readonly storefrontRepo: StorefrontRepository,
    private readonly availabilityRepo: AvailabilityRepository,
    private readonly classRepo: VehicleClassRepository,
    private readonly regionRepo: RegionRepository,
    private readonly classRatePlanRepo: ClassRatePlanRepository,
  ) {}

  async search(ctx: CallerContext, params: FlatSearchParams): Promise<FlatSearchResult> {
    const { from, to, pickupLocationId, regionId, operatorId, classes, cursor } = params
    const limit = clampLimit(params.limit)

    // Resolve the region selection to a flat descendant-id list (recursion lives
    // in RegionRepository, §D6); narrowing the storefront set narrows the map
    // results, since an unmapped vehicle is dropped below.
    const sfFilters: StorefrontFilters = {}
    if (pickupLocationId) sfFilters.pickupLocationId = pickupLocationId
    if (regionId) sfFilters.regionIds = await this.regionRepo.findDescendantIds(regionId)

    const storefronts = await this.storefrontRepo.findActiveStorefronts(
      ctx,
      regionId || pickupLocationId ? sfFilters : undefined,
    )
    // locationId -> ResultLocation (carries operatorName + real coords, D2). A
    // vehicle whose pickup location is absent here (archived/unknown) is not
    // mappable and is dropped below.
    const locationById = new Map<string, ResultLocation>(
      storefronts.map((sf) => [sf.id, toResultLocation(sf)]),
    )

    // ONE availability scan per page — the same call slice 5 makes (N+1 guard).
    // Bound the scan to the in-region storefronts (#651 §1c): `storefronts` is
    // already region-filtered, so its ids are the exact location set to scan
    // instead of the whole platform fleet (out-of-region cars get dropped below).
    const filters: AvailabilityFilters = {}
    if (pickupLocationId) filters.locationId = pickupLocationId
    if (operatorId) filters.operatorId = operatorId
    if (regionId) filters.locationIds = storefronts.map((sf) => sf.id)
    const available = await this.availabilityRepo.findAvailableVehicles(
      from,
      to,
      pickupLocationId || operatorId || regionId ? filters : undefined,
    )

    const classById = new Map(
      (await this.classRepo.findAll(ctx, { includeArchived: true })).map((vc) => [vc.id, vc]),
    )

    const requested = classes && classes.length > 0 ? new Set(classes) : null

    // Pagination bound (#727, deferred): the page is built in memory — sort the
    // whole availability scan, then findIndex(cursor)+slice. Each page is O(total):
    // full sort + linear cursor walk, re-done per request. Fine at MVP scale
    // (40-50 cars; default browse-all already scans the whole fleet, sort is
    // microseconds). Not pushed into SQL because the sort key spans joined
    // operator/location columns the vehicles-only availability query can't ORDER
    // BY without a join restructure. Revisit if inventory reaches the hundreds or
    // search p95 regresses: ORDER BY + keyset + LIMIT n+1 on a joined query.
    const specificItems = available
      .map((v) => toSpecific(v, locationById, classById, requested))
      .filter((i): i is SpecificSearchResult => i !== null)

    // #464: combo deals are a SECOND producer over the same page scope. Bound the
    // active-rate-plan scan to the in-scope storefronts (mirrors locationById), then
    // price + size each surviving plan into a CLASS_COMBO card and merge both
    // producers into one ordered, paginated list.
    const planFilters: ClassRatePlanFilters = { locationIds: storefronts.map((sf) => sf.id) }
    if (operatorId) planFilters.operatorId = operatorId
    const comboItems = await this.findComboItems(
      planFilters,
      from,
      to,
      locationById,
      classById,
      requested,
    )

    const items: SearchResultItem[] = [...specificItems, ...comboItems].sort(compareItems)

    let start = 0
    if (cursor) {
      const decoded = decodeCursor(cursor)
      if (decoded === undefined) return { ok: false, error: 'Invalid cursor', status: 400 }
      start = items.findIndex((i) => itemKey(i) === decoded) + 1
    }
    const page = items.slice(start, start + limit)
    const last = page.at(-1)
    const nextCursor = last && start + limit < items.length ? encodeCursor(itemKey(last)) : null

    return { ok: true, data: { items: page, nextCursor } }
  }

  // #464: one CLASS_COMBO card per active rate plan whose pickup location is an
  // in-scope storefront and whose road-legal supply currently exceeds demand.
  // N+1 note (bounded): two count queries per plan, fired concurrently. A combo is
  // one row per (operator, class, location) offered, so P stays small at MVP scale;
  // collapse to one grouped query if plan volume ever grows — the same deferral the
  // SPECIFIC pagination comment records.
  private async findComboItems(
    planFilters: ClassRatePlanFilters,
    from: Date,
    to: Date,
    locationById: Map<string, ResultLocation>,
    classById: Map<string, VehicleClass>,
    requested: Set<string> | null,
  ): Promise<ClassComboSearchResult[]> {
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
        to,
        from,
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

function toResultLocation(sf: Storefront): ResultLocation {
  return {
    locationId: sf.id,
    operatorId: sf.operatorId,
    operatorName: sf.operatorName,
    name: sf.name,
    address: sf.address,
    latitude: sf.latitude,
    longitude: sf.longitude,
  }
}

/**
 * One available vehicle -> a renter-safe SPECIFIC result, or null when the car
 * is not mappable (no pickup location / location not an active storefront) or is
 * excluded by the ACRISS class filter. Only whitelisted columns are read — never
 * the raw row (no licensePlate, no operator internals).
 */
function toSpecific(
  vehicle: Vehicle,
  locationById: Map<string, ResultLocation>,
  classById: Map<string, VehicleClass>,
  requested: Set<string> | null,
): SpecificSearchResult | null {
  // A null pickupLocationId belongs to no storefront (§9 item 8) — not mappable.
  if (!vehicle.pickupLocationId) return null
  const location = locationById.get(vehicle.pickupLocationId)
  if (!location) return null

  const vc = vehicle.classId ? classById.get(vehicle.classId) : undefined
  const acrissCode = vc?.acrissCode ?? null
  if (requested && (acrissCode == null || !requested.has(acrissCode))) return null

  return {
    kind: 'SPECIFIC',
    location,
    dailyRateJpy: vehicle.dailyRateJpy,
    hourlyRateJpy: vehicle.hourlyRateJpy,
    classLabel: vc?.name ?? '',
    acrissCode,
    seats: vehicle.seats,
    photos: vehicle.photos,
    vehicleId: vehicle.id,
    name: vehicle.name,
    make: vehicle.make,
    model: vehicle.model,
    year: vehicle.year,
    transmission: vehicle.transmission,
  }
}

/** Stable total order across the result union so cursor pagination is deterministic
 *  (§3.2 step 5). Ties break on the globally-unique itemKey. */
function compareItems(a: SearchResultItem, b: SearchResultItem): number {
  return (
    a.location.operatorName.localeCompare(b.location.operatorName) ||
    a.location.name.localeCompare(b.location.name) ||
    itemKey(a).localeCompare(itemKey(b))
  )
}

// Globally-unique, stable sort + cursor key over the union. SPECIFIC is keyed by
// its renter-safe vehicleId; CLASS_COMBO by (locationId, classId) — a class offered
// at several storefronts is several cards, so classId alone would collide. The kind
// prefix also stops a vehicleId and a classId that share a string from aliasing.
function itemKey(item: SearchResultItem): string {
  return item.kind === 'SPECIFIC'
    ? `v:${item.vehicleId}`
    : `c:${item.location.locationId}:${item.classId}`
}
