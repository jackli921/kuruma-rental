import type { LuggageSize } from '@kuruma/shared/lib/luggage'
import type { LocationOperatingHours } from '@kuruma/shared/types/location'
import type { CallerContext } from '../middleware/auth'
import type {
  AvailabilityRepository,
  Storefront,
  StorefrontRepository,
  Vehicle,
  VehicleClass,
  VehicleClassRepository,
} from '../repositories/types'

const DEFAULT_LIMIT = 25
const MAX_LIMIT = 50
const REPRESENTATIVE_PHOTO_CAP = 4

export interface ClassSummary {
  /** ACRISS taxonomy code, or null when the class has no mapped code (#388). */
  acrissCode: string | null
  /** Operator-entered class name. The web layer localizes via acrissCode (§3). */
  label: string
  // #457 D6: class-default luggage so search cards can be compared on luggage,
  // not just seats/price. Null only defensively (a summary always has its class).
  luggageCapacity: number | null
  luggageSize: LuggageSize | null
  availableCount: number
}

export interface StorefrontCard {
  locationId: string
  operatorId: string
  operatorName: string
  name: string
  address: string
  operatingHours: LocationOperatingHours
  /** #551: operator turnaround buffer, surfaced on the card so renters see the
   *  ~Nh service-quality floor between rentals at this store. */
  turnaroundMinutes: number
  classSummaries: ClassSummary[]
  /** min dailyRateJpy over available vehicles, or null when none are daily-priced. */
  fromDailyPriceJpy: number | null
  /** min hourlyRateJpy over available vehicles, or null when none are hourly-priced. */
  fromHourlyPriceJpy: number | null
  representativePhotos: string[]
}

export interface StorefrontSearchData {
  storefronts: StorefrontCard[]
  nextCursor: string | null
}

export type StorefrontSearchResult =
  | { ok: true; data: StorefrontSearchData }
  | { ok: false; error: string; status: number }

export interface StorefrontSearchParams {
  from: Date
  to: Date
  /** Narrow to a single storefront (degenerate single-card search). */
  pickupLocationId?: string
  /** ACRISS codes to keep; trims classSummaries and drops stores with none. */
  classes?: string[]
  limit?: number
  cursor?: string
}

/**
 * Public renter-facing storefront search (#391). Aggregates the single
 * availability scan into per-store cards: class summaries grouped by ACRISS
 * class, from-prices, representative photos. Auth-agnostic — the route builds
 * PUBLIC_CONTEXT. Returns a discriminated result, never throws on bad data.
 */
export class StorefrontSearchService {
  constructor(
    private readonly storefrontRepo: StorefrontRepository,
    private readonly availabilityRepo: AvailabilityRepository,
    private readonly classRepo: VehicleClassRepository,
  ) {}

  async search(
    ctx: CallerContext,
    params: StorefrontSearchParams,
  ): Promise<StorefrontSearchResult> {
    const { from, to, pickupLocationId, classes, cursor } = params
    const limit = clampLimit(params.limit)

    const storefronts = await this.storefrontRepo.findActiveStorefronts(
      ctx,
      pickupLocationId ? { pickupLocationId } : undefined,
    )
    // ONE availability scan per page — group in memory, never a query per store (N+1 guard, §3).
    const available = await this.availabilityRepo.findAvailableVehicles(
      from,
      to,
      pickupLocationId ? { locationId: pickupLocationId } : undefined,
    )
    const classById = new Map(
      (await this.classRepo.findAll(ctx, { includeArchived: true })).map((vc) => [vc.id, vc]),
    )

    const vehiclesByLocation = groupByLocation(available)
    const requested = classes && classes.length > 0 ? new Set(classes) : null

    const cards = storefronts
      .map((sf) => buildCard(sf, vehiclesByLocation.get(sf.id) ?? [], classById, requested))
      .filter((c): c is StorefrontCard => c !== null)
      .sort(compareCards)

    let start = 0
    if (cursor) {
      const decoded = decodeCursor(cursor)
      if (decoded === undefined) return { ok: false, error: 'Invalid cursor', status: 400 }
      start = cards.findIndex((c) => c.locationId === decoded) + 1
    }
    const page = cards.slice(start, start + limit)
    const nextCursor =
      start + limit < cards.length ? encodeCursor(page[page.length - 1]?.locationId ?? '') : null

    return { ok: true, data: { storefronts: page, nextCursor } }
  }
}

function clampLimit(limit: number | undefined): number {
  if (!limit || limit < 1) return DEFAULT_LIMIT
  return Math.min(limit, MAX_LIMIT)
}

function groupByLocation(vehicles: Vehicle[]): Map<string, Vehicle[]> {
  const byLocation = new Map<string, Vehicle[]>()
  for (const vehicle of vehicles) {
    // A null pickupLocationId belongs to no storefront (§9 item 8) — skip it.
    if (!vehicle.pickupLocationId) continue
    const list = byLocation.get(vehicle.pickupLocationId) ?? []
    byLocation.set(vehicle.pickupLocationId, [...list, vehicle])
  }
  return byLocation
}

/**
 * Build one storefront card, or null when the store has no relevant available
 * vehicle (an empty card is dropped, §3 steps 5–6). When `requested` ACRISS
 * codes are given, only vehicles in those classes are relevant — summaries,
 * prices, and photos all reflect the filtered set.
 */
function buildCard(
  storefront: Storefront,
  vehicles: Vehicle[],
  classById: Map<string, VehicleClass>,
  requested: Set<string> | null,
): StorefrontCard | null {
  const relevant = requested
    ? vehicles.filter((v) => {
        const code = v.classId ? classById.get(v.classId)?.acrissCode : null
        return code != null && requested.has(code)
      })
    : vehicles
  if (relevant.length === 0) return null

  return {
    locationId: storefront.id,
    operatorId: storefront.operatorId,
    operatorName: storefront.operatorName,
    name: storefront.name,
    address: storefront.address,
    operatingHours: storefront.operatingHours,
    turnaroundMinutes: storefront.defaultTurnaroundMinutes,
    classSummaries: summarizeByClass(relevant, classById),
    fromDailyPriceJpy: minRate(relevant.map((v) => v.dailyRateJpy)),
    fromHourlyPriceJpy: minRate(relevant.map((v) => v.hourlyRateJpy)),
    representativePhotos: relevant.flatMap((v) => v.photos).slice(0, REPRESENTATIVE_PHOTO_CAP),
  }
}

function summarizeByClass(
  vehicles: Vehicle[],
  classById: Map<string, VehicleClass>,
): ClassSummary[] {
  const counts = new Map<string, number>()
  for (const v of vehicles) {
    // Group on classId (acrissCode is nullable, §9 item 7). A classless
    // vehicle counts toward price but forms no summary.
    if (!v.classId) continue
    counts.set(v.classId, (counts.get(v.classId) ?? 0) + 1)
  }
  return [...counts.entries()].map(([classId, availableCount]) => {
    const vc = classById.get(classId)
    return {
      acrissCode: vc?.acrissCode ?? null,
      label: vc?.name ?? '',
      luggageCapacity: vc?.luggageCapacity ?? null,
      luggageSize: vc?.luggageSize ?? null,
      availableCount,
    }
  })
}

function minRate(rates: Array<number | null>): number | null {
  const present = rates.filter((r): r is number => r != null)
  return present.length > 0 ? Math.min(...present) : null
}

/** Stable total order so cursor pagination is deterministic (§3.3). */
function compareCards(a: StorefrontCard, b: StorefrontCard): number {
  return (
    a.operatorName.localeCompare(b.operatorName) ||
    a.name.localeCompare(b.name) ||
    a.locationId.localeCompare(b.locationId)
  )
}

// Opaque base64 cursor over locationId (§3.3). btoa/atob are Web-standard
// globals available on CF Workers and Bun.
const encodeCursor = (locationId: string): string => btoa(locationId)
// Returns undefined for a malformed (non-base64) cursor so the caller can
// answer 400 instead of letting atob() throw into a 500 on a public endpoint.
const decodeCursor = (cursor: string): string | undefined => {
  try {
    return atob(cursor)
  } catch {
    return undefined
  }
}
