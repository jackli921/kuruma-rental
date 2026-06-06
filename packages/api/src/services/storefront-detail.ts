import type { LocationOperatingHours } from '@kuruma/shared/types/location'
import type { CallerContext } from '../middleware/auth'
import type {
  AvailabilityRepository,
  InsuranceOptionRepository,
  StorefrontRepository,
  Vehicle,
  VehicleClass,
  VehicleClassRepository,
} from '../repositories/types'

const DEFAULT_LIMIT = 25
const MAX_LIMIT = 50

export interface StorefrontSummary {
  locationId: string
  name: string
  address: string
  operatorName: string
  operatingHours: LocationOperatingHours
}

/**
 * Renter-safe vehicle projection (§5): only catalog-visible fields. Operator
 * internals (shakenExpiryDate, insuranceExpiryDate, bufferMinutes, cost,
 * licensePlate) are intentionally absent — a public multi-tenant read whitelists
 * columns, it does not row-scope.
 */
export interface AvailableVehicle {
  id: string
  name: string
  make: string | null
  model: string | null
  year: number | null
  seats: number
  transmission: Vehicle['transmission']
  acrissCode: string | null
  classLabel: string
  dailyRateJpy: number | null
  hourlyRateJpy: number | null
  photos: string[]
}

export interface StorefrontDetailData {
  storefront: StorefrontSummary
  vehicles: AvailableVehicle[]
  nextCursor: string | null
}

export type StorefrontDetailResult =
  | { ok: true; data: StorefrontDetailData }
  | { ok: false; error: string; status: number }

/**
 * Renter-safe insurance projection (#392): the four fields a renter needs to
 * choose coverage at booking. Operator-internal columns (operatorId, status,
 * timestamps) are intentionally absent — same column-whitelist discipline as
 * the public vehicle catalog.
 */
export interface StorefrontInsuranceOption {
  id: string
  name: string
  description: string | null
  dailyPriceJpy: number
  deductibleJpy: number | null
}

export type StorefrontInsuranceResult =
  | { ok: true; data: StorefrontInsuranceOption[] }
  | { ok: false; error: string; status: number }

export interface StorefrontDetailParams {
  locationId: string
  from: Date
  to: Date
  /** ACRISS codes to keep; narrows the vehicle list. */
  classes?: string[]
  limit?: number
  cursor?: string
}

/**
 * Public renter-facing storefront drill-down (#391). Lists the individual
 * available vehicles at one ACTIVE storefront for a date range, grouped/sorted
 * by class. 404 for unknown/archived locations; 200 with an empty list when the
 * known store is full. Auth-agnostic — the route builds PUBLIC_CONTEXT.
 */
export class StorefrontDetailService {
  constructor(
    private readonly storefrontRepo: StorefrontRepository,
    private readonly availabilityRepo: AvailabilityRepository,
    private readonly classRepo: VehicleClassRepository,
    private readonly insuranceOptionRepo: InsuranceOptionRepository,
  ) {}

  /**
   * The ACTIVE insurance options offered at one storefront (#392), for the
   * renter's booking-form dropdown. Resolves the location to its operator via
   * the same ACTIVE-only storefront read (unknown/archived -> 404), then lists
   * that operator's active coverage. PUBLIC: the route builds PUBLIC_CONTEXT and
   * the repo read is single-operator + active-only (never a cross-operator leak).
   */
  async getInsuranceOptions(
    ctx: CallerContext,
    locationId: string,
  ): Promise<StorefrontInsuranceResult> {
    const [storefront] = await this.storefrontRepo.findActiveStorefronts(ctx, {
      pickupLocationId: locationId,
    })
    if (!storefront) return { ok: false, error: 'Storefront not found', status: 404 }

    const options = await this.insuranceOptionRepo.findActiveByOperator(storefront.operatorId)
    return {
      ok: true,
      data: options.map((o) => ({
        id: o.id,
        name: o.name,
        description: o.description,
        dailyPriceJpy: o.dailyPriceJpy,
        deductibleJpy: o.deductibleJpy,
      })),
    }
  }

  async getDetail(
    ctx: CallerContext,
    params: StorefrontDetailParams,
  ): Promise<StorefrontDetailResult> {
    const { locationId, from, to, classes, cursor } = params
    const limit = clampLimit(params.limit)

    // Reuse the ACTIVE-only, operator-name-joined catalog read: an unknown or
    // ARCHIVED location yields no storefront → 404 (§4).
    const [storefront] = await this.storefrontRepo.findActiveStorefronts(ctx, {
      pickupLocationId: locationId,
    })
    if (!storefront) return { ok: false, error: 'Storefront not found', status: 404 }

    // findAvailableVehicles already drops MAINTENANCE/RETIRED and overlapping
    // bookings (turnaround included) — no re-derivation here.
    const available = await this.availabilityRepo.findAvailableVehicles(from, to, { locationId })
    const classById = new Map(
      (await this.classRepo.findAll(ctx, { includeArchived: true })).map((vc) => [vc.id, vc]),
    )

    const requested = classes && classes.length > 0 ? new Set(classes) : null
    const vehicles = available
      .filter((v) => keepClass(v, classById, requested))
      .map((v) => toAvailableVehicle(v, v.classId ? classById.get(v.classId) : undefined))
      .sort(compareVehicles)

    let start = 0
    if (cursor) {
      const decoded = decodeCursor(cursor)
      if (decoded === undefined) return { ok: false, error: 'Invalid cursor', status: 400 }
      start = vehicles.findIndex((v) => v.id === decoded) + 1
    }
    const page = vehicles.slice(start, start + limit)
    const nextCursor =
      start + limit < vehicles.length ? encodeCursor(page[page.length - 1]?.id ?? '') : null

    return {
      ok: true,
      data: {
        storefront: {
          locationId: storefront.id,
          name: storefront.name,
          address: storefront.address,
          operatorName: storefront.operatorName,
          operatingHours: storefront.operatingHours,
        },
        vehicles: page,
        nextCursor,
      },
    }
  }
}

function clampLimit(limit: number | undefined): number {
  if (!limit || limit < 1) return DEFAULT_LIMIT
  return Math.min(limit, MAX_LIMIT)
}

function keepClass(
  vehicle: Vehicle,
  classById: Map<string, VehicleClass>,
  requested: Set<string> | null,
): boolean {
  if (!requested) return true
  const code = vehicle.classId ? classById.get(vehicle.classId)?.acrissCode : null
  return code != null && requested.has(code)
}

function toAvailableVehicle(vehicle: Vehicle, vc: VehicleClass | undefined): AvailableVehicle {
  return {
    id: vehicle.id,
    name: vehicle.name,
    make: vehicle.make,
    model: vehicle.model,
    year: vehicle.year,
    seats: vehicle.seats,
    transmission: vehicle.transmission,
    acrissCode: vc?.acrissCode ?? null,
    classLabel: vc?.name ?? '',
    dailyRateJpy: vehicle.dailyRateJpy,
    hourlyRateJpy: vehicle.hourlyRateJpy,
    photos: vehicle.photos,
  }
}

/** Group same-class vehicles adjacently for the grouped-by-ACRISS UI (§4 step 4). */
function compareVehicles(a: AvailableVehicle, b: AvailableVehicle): number {
  return (
    a.classLabel.localeCompare(b.classLabel) ||
    a.name.localeCompare(b.name) ||
    a.id.localeCompare(b.id)
  )
}

const encodeCursor = (vehicleId: string): string => btoa(vehicleId)
// Returns undefined for a malformed (non-base64) cursor so the caller can
// answer 400 instead of letting atob() throw into a 500 on a public endpoint.
const decodeCursor = (cursor: string): string | undefined => {
  try {
    return atob(cursor)
  } catch {
    return undefined
  }
}
