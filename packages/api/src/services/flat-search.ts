import type {
  ResultLocation,
  SearchResultsData,
  SpecificSearchResult,
} from '@kuruma/shared/types/search-result'
import type { CallerContext } from '../middleware/auth'
import type {
  AvailabilityFilters,
  AvailabilityRepository,
  RegionRepository,
  Storefront,
  StorefrontFilters,
  StorefrontRepository,
  Vehicle,
  VehicleClass,
  VehicleClassRepository,
} from '../repositories/types'

const DEFAULT_LIMIT = 25
const MAX_LIMIT = 50

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
 */
export class FlatSearchService {
  constructor(
    private readonly storefrontRepo: StorefrontRepository,
    private readonly availabilityRepo: AvailabilityRepository,
    private readonly classRepo: VehicleClassRepository,
    private readonly regionRepo: RegionRepository,
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
    const filters: AvailabilityFilters = {}
    if (pickupLocationId) filters.locationId = pickupLocationId
    if (operatorId) filters.operatorId = operatorId
    const available = await this.availabilityRepo.findAvailableVehicles(
      from,
      to,
      pickupLocationId || operatorId ? filters : undefined,
    )

    const classById = new Map(
      (await this.classRepo.findAll(ctx, { includeArchived: true })).map((vc) => [vc.id, vc]),
    )

    const requested = classes && classes.length > 0 ? new Set(classes) : null

    const items = available
      .map((v) => toSpecific(v, locationById, classById, requested))
      .filter((i): i is SpecificSearchResult => i !== null)
      .sort(compareItems)

    let start = 0
    if (cursor) {
      const decoded = decodeCursor(cursor)
      if (decoded === undefined) return { ok: false, error: 'Invalid cursor', status: 400 }
      start = items.findIndex((i) => i.vehicleId === decoded) + 1
    }
    const page = items.slice(start, start + limit)
    const nextCursor =
      start + limit < items.length ? encodeCursor(page[page.length - 1]?.vehicleId ?? '') : null

    return { ok: true, data: { items: page, nextCursor } }
  }
}

function clampLimit(limit: number | undefined): number {
  if (!limit || limit < 1) return DEFAULT_LIMIT
  return Math.min(limit, MAX_LIMIT)
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

/** Stable total order so cursor pagination is deterministic (§3.2 step 5). */
function compareItems(a: SpecificSearchResult, b: SpecificSearchResult): number {
  return (
    a.location.operatorName.localeCompare(b.location.operatorName) ||
    a.location.name.localeCompare(b.location.name) ||
    a.vehicleId.localeCompare(b.vehicleId)
  )
}

// Opaque base64 cursor over vehicleId (§3.2 step 6). btoa/atob are Web-standard
// globals on CF Workers and Bun.
const encodeCursor = (vehicleId: string): string => btoa(vehicleId)
// Returns undefined for a malformed (non-base64) cursor so the caller can answer
// 400 instead of letting atob() throw into a 500 on a public endpoint.
const decodeCursor = (cursor: string): string | undefined => {
  try {
    return atob(cursor)
  } catch {
    return undefined
  }
}
