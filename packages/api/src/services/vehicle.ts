import { isForeignVehiclePhoto } from '@kuruma/shared/lib/photo-ref'
import type {
  BulkVehicleStatus,
  CreateVehicleInput,
  UpdateVehicleInput,
} from '@kuruma/shared/validators/vehicle'
import { type CallerContext, PRIVILEGED_ROLES } from '../middleware/auth'
import {
  PG_ERROR,
  VEHICLES_CLASS_FK,
  VEHICLES_PICKUP_LOCATION_FK,
  pgConstraintName,
  pgErrorCode,
} from '../pg-errors'
import type { PaginatedResult, VehicleFilters, VehicleRepository } from '../repositories/types'
import type { Vehicle } from '../stores'
import type { ResolveWriteOperatorId } from '../tenancy'

// A write failure the route maps straight onto an HTTP envelope. `error` is a
// plain string for most cases, or a field-error map for the min/max rule so the
// form can highlight the offending input (mirrors fail()'s two accepted shapes).
type FieldErrors = Record<string, string[]>
export type VehicleResult =
  | { ok: true; vehicle: Vehicle }
  | { ok: false; error: string | FieldErrors; status: number }

export type VehicleBulkResult =
  | { ok: true; vehicles: Vehicle[] }
  | { ok: false; error: string; status: number }

// vehicles carries three FKs — composite (operatorId, classId) -> vehicle_classes
// (#400), composite (operatorId, pickupLocationId) -> locations (#435), and the
// single operatorId -> operators. A 23503 alone is ambiguous, so match the
// constraint name to report the cause that actually failed.
function fkViolationMessage(err: unknown): string {
  switch (pgConstraintName(err)) {
    case VEHICLES_CLASS_FK:
      return 'Invalid vehicle class'
    case VEHICLES_PICKUP_LOCATION_FK:
      return 'Invalid pickup location'
    default:
      return 'Invalid operator'
  }
}

// Drop keys whose value is `undefined` so a partial patch never overwrites a
// column with undefined. Service-local: routes/helpers exposes an identical
// helper, but services must not import from the routes layer (boundary rule).
function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>
}

/**
 * Vehicle CRUD business policy, lifted out of routes/vehicles.ts (#819) so it is
 * reusable (e.g. a Trip.com write path) and unit-testable without an HTTP app.
 * Follows the #712 service pattern: discriminated-union results; parsing and
 * authz gating stay at the route boundary. The write-operator resolver is
 * injected (#401) so create can resolve the target tenant before the insert.
 */
export class VehicleService {
  constructor(
    private readonly repo: VehicleRepository,
    private readonly resolveWriteOperatorId: ResolveWriteOperatorId,
    // Public bucket base URL — the anchor for the #967 photo-spoof guard.
    // Empty in dev/in-memory (no R2), where the guard is inert by design.
    private readonly photosPublicUrl: string,
  ) {}

  // #967: reject a `photos` array that smuggles in one of OUR bucket URLs for a
  // DIFFERENT vehicle. A repo re-encodes our URLs to `r2:<key>` on write, so
  // `${base}/vehicles/<victim>/x.jpg` would mint a cross-tenant ref on the
  // caller's own row and render the victim's photo as theirs. On create no
  // vehicle exists yet (ownerVehicleId null) — uploads mint their own keys via
  // POST /vehicles/:id/photos, so ANY of-our-origin URL is foreign. External
  // image URLs always pass. Returns a field error (400) so the form can flag it.
  private rejectForeignPhotos(
    photos: readonly string[] | undefined,
    ownerVehicleId: string | null,
  ): VehicleResult | null {
    const foreign = photos?.some((p) =>
      isForeignVehiclePhoto(p, ownerVehicleId, this.photosPublicUrl),
    )
    if (!foreign) return null
    return {
      ok: false,
      error: { photos: ["Photo URLs must be external images or this vehicle's own uploads"] },
      status: 400,
    }
  }

  async findAll(
    ctx: CallerContext,
    filters?: VehicleFilters,
    requestedOperatorId?: string,
  ): Promise<PaginatedResult<Vehicle>> {
    // Picker narrow (#1230 slice 5b): the vehicle catalog is PUBLIC, so operatorReadScope
    // maps renters/partners to `all` — keying the narrow off it would echo their
    // ?operatorId= (the #1272 trap). Vehicles have no bypass-only read resolver, so gate
    // the narrow on the platform tier explicitly here — the single enforcement point.
    // Strip any caller-supplied operatorId: the platform-tier gate below is the
    // ONLY path that may narrow the public catalog (#1230 slice 5b review).
    const { operatorId: _ignored, ...safeFilters } = filters ?? {}
    const narrowedOperatorId = PRIVILEGED_ROLES.has(ctx.role) ? requestedOperatorId : undefined
    return this.repo.findAll(ctx, {
      ...safeFilters,
      ...(narrowedOperatorId ? { operatorId: narrowedOperatorId } : {}),
    })
  }

  async findById(ctx: CallerContext, id: string): Promise<Vehicle | undefined> {
    return this.repo.findById(ctx, id)
  }

  async create(ctx: CallerContext, input: CreateVehicleInput): Promise<VehicleResult> {
    // #967: no vehicle exists yet, so any of-our-bucket photo URL is a spoof.
    const foreign = this.rejectForeignPhotos(input.photos, null)
    if (foreign) return foreign

    // Resolve the target tenant before the insert so a missing/ambiguous
    // operatorId (#401) surfaces as 403/422 from the global handler rather than
    // as a caught DB error below — kept outside the try/catch deliberately.
    const operatorId = await this.resolveWriteOperatorId(ctx, input.operatorId)

    try {
      const vehicle = await this.repo.create(ctx, {
        operatorId,
        classId: input.classId ?? null,
        // Storefront placement (#435). A cross-tenant or missing location is
        // sealed by the composite FK below and mapped to 422.
        pickupLocationId: input.pickupLocationId ?? null,
        name: input.name,
        description: input.description ?? null,
        photos: input.photos,
        seats: input.seats,
        luggageCapacity: input.luggageCapacity ?? null,
        luggageSize: input.luggageSize ?? null,
        transmission: input.transmission,
        fuelType: input.fuelType ?? null,
        licensePlate: input.licensePlate ?? null,
        status: 'AVAILABLE',
        minRentalHours: input.minRentalHours ?? null,
        maxRentalHours: input.maxRentalHours ?? null,
        advanceBookingHours: input.advanceBookingHours ?? null,
        make: input.make ?? null,
        model: input.model ?? null,
        year: input.year ?? null,
        color: input.color ?? null,
        dailyRateJpy: input.dailyRateJpy ?? null,
        hourlyRateJpy: input.hourlyRateJpy ?? null,
        shakenExpiryDate: input.shakenExpiryDate ?? null,
        insuranceExpiryDate: input.insuranceExpiryDate ?? null,
      })
      return { ok: true, vehicle }
    } catch (err) {
      return this.mapWriteError(err)
    }
  }

  async update(ctx: CallerContext, id: string, input: UpdateVehicleInput): Promise<VehicleResult> {
    const existing = await this.repo.findById(ctx, id)
    if (!existing) return { ok: false, error: 'Vehicle not found', status: 404 }

    // #967: a patched photos array may only carry this vehicle's own bucket
    // URLs (or external images) — never another vehicle's.
    const foreign = this.rejectForeignPhotos(input.photos, existing.id)
    if (foreign) return foreign

    // Merge patch with existing: use patch value if key was sent (even null),
    // otherwise keep existing. `??` would swallow explicit nulls.
    const d = input
    const merge = <T>(key: string, fallback: T): T =>
      key in d ? ((d as Record<string, unknown>)[key] as T) : fallback

    const changes = {
      ...d,
      classId: merge('classId', existing.classId),
      // #435: explicit-null clears the assignment; absent keeps existing.
      pickupLocationId: merge('pickupLocationId', existing.pickupLocationId),
      description: merge('description', existing.description),
      fuelType: merge('fuelType', existing.fuelType),
      licensePlate: merge('licensePlate', existing.licensePlate),
      minRentalHours: merge('minRentalHours', existing.minRentalHours),
      maxRentalHours: merge('maxRentalHours', existing.maxRentalHours),
      advanceBookingHours: merge('advanceBookingHours', existing.advanceBookingHours),
      make: merge('make', existing.make),
      model: merge('model', existing.model),
      year: merge('year', existing.year),
      color: merge('color', existing.color),
      dailyRateJpy: merge('dailyRateJpy', existing.dailyRateJpy),
      hourlyRateJpy: merge('hourlyRateJpy', existing.hourlyRateJpy),
      shakenExpiryDate: merge('shakenExpiryDate', existing.shakenExpiryDate),
      insuranceExpiryDate: merge('insuranceExpiryDate', existing.insuranceExpiryDate),
    }

    // The Zod schema only refines the patch; these rules guard the MERGED row,
    // catching cases the patch alone can't show (clearing the only rate; a max
    // below the existing min, which has no DB CHECK and would otherwise persist).
    if (changes.dailyRateJpy == null && changes.hourlyRateJpy == null) {
      return { ok: false, error: 'At least one rate (daily or hourly) is required', status: 400 }
    }
    const mergedMin = changes.minRentalHours
    const mergedMax = changes.maxRentalHours
    if (mergedMin != null && mergedMax != null && mergedMin > mergedMax) {
      return {
        ok: false,
        error: {
          maxRentalHours: ['Maximum rental hours must be greater than or equal to minimum'],
        },
        status: 400,
      }
    }

    try {
      const updated = await this.repo.update(
        ctx,
        existing.id,
        stripUndefined(changes) as Partial<Vehicle>,
      )
      if (!updated) return { ok: false, error: 'Vehicle not found', status: 404 }
      return { ok: true, vehicle: updated }
    } catch (err) {
      return this.mapWriteError(err)
    }
  }

  async bulkUpdateStatus(
    ctx: CallerContext,
    vehicleIds: string[],
    status: BulkVehicleStatus,
  ): Promise<VehicleBulkResult> {
    // Dedup guards non-HTTP callers (e.g. Trip.com). On the route path
    // bulkUpdateVehicleStatusSchema already rejects duplicate IDs, so this is a
    // no-op there — it keeps the length check below sound for direct callers.
    const uniqueIds = [...new Set(vehicleIds)]

    // Pre-check: all IDs must exist and not be RETIRED.
    const existing = await this.repo.findByIds(ctx, uniqueIds)
    if (existing.length !== uniqueIds.length) {
      return { ok: false, error: 'One or more vehicles not found', status: 404 }
    }
    if (existing.some((v) => v.status === 'RETIRED')) {
      return { ok: false, error: 'Cannot bulk-update retired vehicles', status: 400 }
    }

    const vehicles = await this.repo.bulkUpdateStatus(ctx, uniqueIds, status)
    return { ok: true, vehicles }
  }

  async softDelete(ctx: CallerContext, id: string): Promise<VehicleResult> {
    const existing = await this.repo.findById(ctx, id)
    if (!existing) return { ok: false, error: 'Vehicle not found', status: 404 }

    const retired = await this.repo.softDelete(ctx, existing.id)
    if (!retired) return { ok: false, error: 'Vehicle not found', status: 404 }
    return { ok: true, vehicle: retired }
  }

  // #400/#412: a unique violation is a duplicate plate (409); a FK violation
  // (unknown/cross-tenant classId, pickupLocationId, or operatorId) is a client
  // error mapped to 422 with the cause that actually failed — not a raw 500.
  private mapWriteError(err: unknown): VehicleResult {
    if (pgErrorCode(err) === PG_ERROR.UNIQUE_VIOLATION) {
      return { ok: false, error: 'License plate already in use', status: 409 }
    }
    if (pgErrorCode(err) === PG_ERROR.FOREIGN_KEY_VIOLATION) {
      return { ok: false, error: fkViolationMessage(err), status: 422 }
    }
    throw err
  }
}
