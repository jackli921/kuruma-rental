import type { CoordinateSource } from '@kuruma/shared/db/schema'
import type { CallerContext } from '../middleware/auth'
import { PG_ERROR, pgErrorCode } from '../pg-errors'
import type {
  BookingRepository,
  Location,
  LocationFilters,
  LocationRepository,
} from '../repositories/types'
import type { GeocodeOutcome, Geocoder } from './geocoding/types'

export type LocationResult =
  | { ok: true; location: Location }
  | { ok: false; error: string; status: number }

export type LocationArchiveResult =
  | { ok: true; location: Location }
  | {
      ok: false
      error: string
      status: number
      code?: 'LOCATION_HAS_ACTIVE_BOOKINGS'
      activeBookingsCount?: number
    }

// coordinateSource is server-derived (#531), so it is absent from both inputs —
// the client may submit a coord pair (→ MANUAL) but never the provenance.
export type LocationCreateData = Omit<
  Location,
  'id' | 'createdAt' | 'updatedAt' | 'latitude' | 'longitude' | 'coordinateSource'
> & { latitude?: number | null | undefined; longitude?: number | null | undefined }

export type LocationUpdateData = Partial<
  Omit<Location, 'id' | 'createdAt' | 'updatedAt' | 'coordinateSource'>
> & { regeocode?: boolean }

const DUPLICATE_NAME_MESSAGE = 'A location with this name already exists'
const NOT_FOUND_MESSAGE = 'Location not found'

const isDuplicateName = (err: unknown): boolean => pgErrorCode(err) === PG_ERROR.UNIQUE_VIOLATION

// The three persisted coordinate fields, derived together so they can never
// drift (e.g. a source without coords). `CLEARED` = no coordinates captured.
interface CoordTriple {
  latitude: number | null
  longitude: number | null
  coordinateSource: CoordinateSource | null
}
const CLEARED: CoordTriple = { latitude: null, longitude: null, coordinateSource: null }
// #601/#574: geocoding was rate-limit-skipped — coords are unknown (null) but a
// retry will resolve them, so persist PENDING rather than the indistinguishable
// CLEARED a genuine miss gets. The bulk re-geocode enumerates exactly these.
const PENDING: CoordTriple = { latitude: null, longitude: null, coordinateSource: 'PENDING' }
const geocoded = (lat: number, lng: number): CoordTriple => ({
  latitude: lat,
  longitude: lng,
  coordinateSource: 'GEOCODED',
})

// The triple to persist for a non-success geocode when there is no valid prior
// pin to keep: a throttle-skip is retryable (PENDING), a genuine miss is not
// (CLEARED). 'ok' is handled by callers (they have the coords).
const failedTriple = (outcome: { status: 'notFound' | 'throttled' }): CoordTriple =>
  outcome.status === 'throttled' ? PENDING : CLEARED

// On update, coords are either replaced ('set') or left exactly as they are
// ('preserve'). Distinct from a CLEARED set (which actively nulls them).
type CoordResolution = { kind: 'set'; coords: CoordTriple } | { kind: 'preserve' }

export class LocationService {
  constructor(
    private readonly repo: LocationRepository,
    private readonly bookingRepo: BookingRepository,
    private readonly geocoder: Geocoder,
  ) {}

  async findAll(ctx: CallerContext, filters?: LocationFilters): Promise<Location[]> {
    return this.repo.findAll(ctx, filters)
  }

  async findById(ctx: CallerContext, id: string): Promise<Location | undefined> {
    return this.repo.findById(ctx, id)
  }

  /**
   * `data.operatorId` is resolved by the route (resolveOperatorIdForWrite), so
   * the service stays auth-mechanism-agnostic. Name is unique per operator; the
   * pre-check yields a friendly 409, the DB unique constraint is the real seal.
   */
  async create(_ctx: CallerContext, data: LocationCreateData): Promise<LocationResult> {
    const duplicate = await this.repo.findByOperatorAndName(data.operatorId, data.name)
    if (duplicate) return { ok: false, error: DUPLICATE_NAME_MESSAGE, status: 409 }

    const coords = await this.resolveCreateCoords(data)

    // The pre-check is a UX nicety; the unique constraint is the real seal.
    // A concurrent insert can win the race after the check passes, so map the
    // resulting unique-violation to the same friendly 409 instead of a 500.
    try {
      const location = await this.repo.create({ ...data, ...coords })
      return { ok: true, location }
    } catch (err) {
      if (isDuplicateName(err)) return { ok: false, error: DUPLICATE_NAME_MESSAGE, status: 409 }
      throw err
    }
  }

  async update(ctx: CallerContext, id: string, data: LocationUpdateData): Promise<LocationResult> {
    // Caller-scoped existence check: an operator may only edit its own location.
    // A cross-tenant id reads as undefined here, so the write below never runs
    // and the caller sees 404 (not 403 — no cross-tenant existence leak).
    const existing = await this.repo.findById(ctx, id)
    if (!existing) return { ok: false, error: NOT_FOUND_MESSAGE, status: 404 }

    if (data.name !== undefined && data.name !== existing.name) {
      const duplicate = await this.repo.findByOperatorAndName(existing.operatorId, data.name)
      if (duplicate && duplicate.id !== id) {
        return { ok: false, error: DUPLICATE_NAME_MESSAGE, status: 409 }
      }
    }

    const resolution = await this.resolveUpdateCoords(existing, data)

    try {
      const updated = await this.repo.update(id, this.toPatch(data, resolution))
      if (!updated) return { ok: false, error: NOT_FOUND_MESSAGE, status: 404 }
      return { ok: true, location: updated }
    } catch (err) {
      // Same lost-race seal as create: a concurrent rename onto this name maps
      // to a friendly 409 rather than surfacing the raw unique-violation.
      if (isDuplicateName(err)) return { ok: false, error: DUPLICATE_NAME_MESSAGE, status: 409 }
      throw err
    }
  }

  async archive(ctx: CallerContext, id: string): Promise<LocationArchiveResult> {
    // Same caller-scoped guard as update — load before mutate so a cross-tenant
    // id can never be archived.
    const existing = await this.repo.findById(ctx, id)
    if (!existing) return { ok: false, error: NOT_FOUND_MESSAGE, status: 404 }

    // Guard (#412): a location still referenced as pickup OR dropoff by a live
    // (CONFIRMED/ACTIVE) booking cannot be archived — the owner must reassign or
    // cancel those bookings first. Mirrors VehicleClassService.archive. The DB
    // FK keeps the row referenceable; this is the friendly app-level seal.
    const activeBookingsCount = await this.bookingRepo.countActiveForLocation(id)
    if (activeBookingsCount > 0) {
      return {
        ok: false,
        error: 'Cannot archive a location with active bookings',
        status: 409,
        code: 'LOCATION_HAS_ACTIVE_BOOKINGS',
        activeBookingsCount,
      }
    }

    const archived = await this.repo.archive(id)
    if (!archived) return { ok: false, error: NOT_FOUND_MESSAGE, status: 404 }
    return { ok: true, location: archived }
  }

  // ---- geocode-on-save decision matrix (#531) ----------------------------
  // lat/lng are derived from `address` unless an operator pins them manually.
  // A MANUAL pin is an explicit assertion (never "stale"); a GEOCODED value is
  // derived, so when its source address changes and re-derivation fails we must
  // CLEAR it rather than leave a pin at the wrong place (Denormalization
  // Without Sync). The geocode is best-effort and never blocks the save.

  /** Tolerate a geocoder that throws — the contract is never-throw, but a save
   *  must survive even a misbehaving provider, so map a stray throw to notFound. */
  private async safeGeocode(address: string): Promise<GeocodeOutcome> {
    try {
      return await this.geocoder.geocode(address)
    } catch {
      return { status: 'notFound' }
    }
  }

  // Create always *sets* a triple (there is nothing to preserve), so this returns
  // a CoordTriple directly rather than the set/preserve CoordResolution of update.
  private async resolveCreateCoords(data: LocationCreateData): Promise<CoordTriple> {
    const { latitude, longitude } = data
    if (latitude != null && longitude != null) {
      return { latitude, longitude, coordinateSource: 'MANUAL' }
    }
    // An explicit null pair is "no coordinates"; only an omitted pair geocodes.
    if (latitude === null || longitude === null) return CLEARED
    const outcome = await this.safeGeocode(data.address)
    return outcome.status === 'ok' ? geocoded(outcome.lat, outcome.lng) : failedTriple(outcome)
  }

  private async resolveUpdateCoords(
    existing: Location,
    data: LocationUpdateData,
  ): Promise<CoordResolution> {
    const { latitude, longitude, regeocode } = data
    // An explicit pin is the strongest signal: it outranks both `regeocode` and
    // any address change, so a `{ lat, lng, regeocode: true }` request pins MANUAL
    // and never geocodes. Precedence order below: explicit pair > clear > regeocode
    // > address-changed > unrelated-edit.
    if (latitude != null && longitude != null) {
      return { kind: 'set', coords: { latitude, longitude, coordinateSource: 'MANUAL' } }
    }
    if (latitude === null || longitude === null) return { kind: 'set', coords: CLEARED }

    const address = data.address ?? existing.address
    const addressChanged = data.address !== undefined && data.address !== existing.address
    const isManual = existing.coordinateSource === 'MANUAL'

    if (regeocode === true) {
      const outcome = await this.safeGeocode(address)
      if (outcome.status === 'ok') {
        return { kind: 'set', coords: geocoded(outcome.lat, outcome.lng) }
      }
      // A non-success geocode clears coords only when they are genuinely stale —
      // i.e. the address changed and re-derivation failed. A MANUAL pin, or a
      // GEOCODED pin whose address is unchanged, is NOT stale, so a miss preserves
      // it rather than destroy valid coordinates. When the old pin IS stale, store
      // the failure triple: PENDING if throttle-skipped (#601, retryable), else
      // CLEARED for a genuine miss.
      if (isManual || !addressChanged) return { kind: 'preserve' }
      return { kind: 'set', coords: failedTriple(outcome) }
    }

    if (addressChanged) {
      if (isManual) return { kind: 'preserve' } // manual pin wins over the new address
      const outcome = await this.safeGeocode(address)
      if (outcome.status === 'ok') {
        return { kind: 'set', coords: geocoded(outcome.lat, outcome.lng) }
      }
      // The new address invalidates the old pin; a throttle-skip marks it PENDING
      // (retryable), a genuine miss CLEARS it (no stale pin at the wrong place).
      return { kind: 'set', coords: failedTriple(outcome) }
    }

    return { kind: 'preserve' } // unrelated edit, address unchanged
  }

  /** Build the repo patch: strip the client coord/regeocode inputs (coords are
   *  server-derived; `regeocode` is not a column), then apply the resolution.
   *  'preserve' leaves the coord columns untouched; 'set' spreads the derived
   *  triple. Built in one expression so the patch is never mutated after birth. */
  private toPatch(data: LocationUpdateData, resolution: CoordResolution): Partial<Location> {
    const { regeocode: _regeocode, latitude: _lat, longitude: _lng, ...rest } = data
    return resolution.kind === 'set' ? { ...rest, ...resolution.coords } : { ...rest }
  }
}
