import type { Locale } from '@kuruma/shared/i18n/locales'
import { type LuggageSize, resolveLuggage } from '@kuruma/shared/lib/luggage'
import type { LocationOperatingHours } from '@kuruma/shared/types/location'
import type { ClassComboSearchResult } from '@kuruma/shared/types/search-result'
import type { StorefrontAddOnData, StorefrontInsuranceData } from '@kuruma/shared/types/storefront'
import type { CallerContext } from '../middleware/auth'
import type {
  AddOnRepository,
  AvailabilityRepository,
  InsuranceOptionRepository,
  StorefrontRepository,
  Vehicle,
  VehicleClass,
  VehicleClassRepository,
} from '../repositories/types'
import { resolveAddOnDescription, resolveAddOnName } from './add-on-resolve'
import type { ClassOfferingService } from './class-offering'
import { clampLimit, decodeCursor, encodeCursor } from './search-paging'

export interface StorefrontSummary {
  locationId: string
  /** #1085 slice 5: the owning operator's id, surfaced so the storefront
   *  detail page can fetch its operator-level review aggregate by id (not
   *  by the human-facing name). The operator that owns a public storefront
   *  is itself public — same shape as `storefrontCardSchema.operatorId`. */
  operatorId: string
  name: string
  address: string
  operatorName: string
  operatingHours: LocationOperatingHours
  /** #551: the operator's turnaround buffer, surfaced so renters see the
   *  service-quality floor (~Nh between rentals) before booking. */
  turnaroundMinutes: number
}

/**
 * Renter-safe vehicle projection (§5): only catalog-visible fields. Operator
 * internals (shakenExpiryDate, insuranceExpiryDate, bufferMinutes, cost,
 * licensePlate) are intentionally absent — a public multi-tenant read whitelists
 * columns, it does not row-scope.
 */
export interface AvailableVehicle {
  id: string
  /** #1085 slice 5: the vehicle's class id, surfaced so the storefront detail
   *  page can fetch a class-level review aggregate. `null` for vehicles with no
   *  class (the same fallback `classLabel` flips to `''` for) — UI skips the
   *  badge rather than rendering "no reviews" against a missing aggregate key. */
  classId: string | null
  name: string
  make: string | null
  model: string | null
  year: number | null
  seats: number
  // #457: effective luggage — vehicle override resolved against the class default
  // (resolveLuggage). Null only when the vehicle has no class to fall back to.
  luggageCapacity: number | null
  luggageSize: LuggageSize | null
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
  /** #464: the store's active class rate plans as CLASS_COMBO cards (a class with
   *  an inventory count, exact car assigned on pickup day). Unpaginated — combos
   *  are one row per (class, location), so P stays small; only `vehicles` paginates. */
  classOfferings: ClassComboSearchResult[]
  nextCursor: string | null
}

export type StorefrontDetailResult =
  | { ok: true; data: StorefrontDetailData }
  | { ok: false; error: string; status: number }

/**
 * Renter-safe insurance projection (#392). Anchored to the shared wire DTO (#864)
 * so a field rename fails `typecheck` on both producer and the web reservation
 * schema, not as a render-time ParseError. Operator-internal columns (operatorId,
 * status, timestamps) stay absent — same column-whitelist discipline as the
 * public vehicle catalog.
 */
export type StorefrontInsuranceOption = StorefrontInsuranceData

export type StorefrontInsuranceResult =
  | { ok: true; data: StorefrontInsuranceOption[] }
  | { ok: false; error: string; status: number }

/**
 * Renter-safe add-on projection (#460). Anchored to the shared wire DTO (#864):
 * the fields a renter needs to pick paid extras (baby seat etc.) at booking.
 * Operator-internal columns (operatorId, status, timestamps) stay absent — same
 * column-whitelist discipline as the public vehicle catalog + insurance options.
 */
export type StorefrontAddOn = StorefrontAddOnData

export type StorefrontAddOnResult =
  | { ok: true; data: StorefrontAddOn[] }
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
    private readonly addOnRepo: AddOnRepository,
    private readonly classOfferingService: ClassOfferingService,
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

  /**
   * The ACTIVE paid add-ons offered at one storefront (#460), for the renter's
   * booking-form selection. Resolves the location to its operator via the same
   * ACTIVE-only storefront read (unknown/archived -> 404), then lists that
   * operator's active add-ons. PUBLIC: the route builds PUBLIC_CONTEXT and the
   * repo read is single-operator + active-only (never a cross-operator leak).
   */
  async getAddOns(
    ctx: CallerContext,
    locationId: string,
    locale: Locale,
  ): Promise<StorefrontAddOnResult> {
    const [storefront] = await this.storefrontRepo.findActiveStorefronts(ctx, {
      pickupLocationId: locationId,
    })
    if (!storefront) return { ok: false, error: 'Storefront not found', status: 404 }

    // Catalog i18n (slice 2): resolve the template name/description to the
    // renter's locale here, at the boundary — the multi-locale bundle never
    // reaches the wire. Legacy null-templateId rows fall back to their columns.
    const addOns = await this.addOnRepo.findActiveByOperator(storefront.operatorId)
    return {
      ok: true,
      data: addOns.map((o) => ({
        id: o.id,
        name: resolveAddOnName(o, locale),
        description: resolveAddOnDescription(o, locale),
        priceJpy: o.priceJpy,
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

    // #464: the SECOND producer runs over this one store's scope. The RAW storefront
    // carries lat/lng (the trimmed StorefrontSummary drops them), so the one-entry
    // locationById map is built here from it. Scoping the plan scan to this store's
    // operator + location forecloses a stray cross-operator rate plan surfacing a
    // card under the wrong store. Offerings are unpaginated (only `vehicles` pages).
    const locationById = new Map([
      [
        storefront.id,
        {
          locationId: storefront.id,
          operatorId: storefront.operatorId,
          operatorName: storefront.operatorName,
          name: storefront.name,
          address: storefront.address,
          latitude: storefront.latitude,
          longitude: storefront.longitude,
        },
      ],
    ])
    const classOfferings = await this.classOfferingService.findOfferings({
      planFilters: { operatorId: storefront.operatorId, locationIds: [locationId] },
      from,
      to,
      locationById,
      classById,
      requested,
    })

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
          operatorId: storefront.operatorId,
          name: storefront.name,
          address: storefront.address,
          operatorName: storefront.operatorName,
          operatingHours: storefront.operatingHours,
          turnaroundMinutes: storefront.defaultTurnaroundMinutes,
        },
        vehicles: page,
        classOfferings,
        nextCursor,
      },
    }
  }
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
  // A classless vehicle has no default to fall back to, so its own (possibly null)
  // luggage stands; otherwise resolve override-then-class per field.
  const luggage = vc
    ? resolveLuggage(vehicle, vc)
    : { luggageCapacity: vehicle.luggageCapacity, luggageSize: vehicle.luggageSize }
  return {
    id: vehicle.id,
    classId: vehicle.classId,
    name: vehicle.name,
    make: vehicle.make,
    model: vehicle.model,
    year: vehicle.year,
    seats: vehicle.seats,
    luggageCapacity: luggage.luggageCapacity,
    luggageSize: luggage.luggageSize,
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
