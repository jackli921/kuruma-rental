import type { CallerContext } from '../middleware/auth'
import { PG_ERROR, pgErrorCode } from '../pg-errors'
import type {
  BookingRepository,
  Location,
  LocationFilters,
  LocationRepository,
} from '../repositories/types'

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

const DUPLICATE_NAME_MESSAGE = 'A location with this name already exists'
const NOT_FOUND_MESSAGE = 'Location not found'

const isDuplicateName = (err: unknown): boolean => pgErrorCode(err) === PG_ERROR.UNIQUE_VIOLATION

export class LocationService {
  constructor(
    private readonly repo: LocationRepository,
    private readonly bookingRepo: BookingRepository,
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
  async create(
    _ctx: CallerContext,
    data: Omit<Location, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<LocationResult> {
    const duplicate = await this.repo.findByOperatorAndName(data.operatorId, data.name)
    if (duplicate) return { ok: false, error: DUPLICATE_NAME_MESSAGE, status: 409 }

    // The pre-check is a UX nicety; the unique constraint is the real seal.
    // A concurrent insert can win the race after the check passes, so map the
    // resulting unique-violation to the same friendly 409 instead of a 500.
    try {
      const location = await this.repo.create(data)
      return { ok: true, location }
    } catch (err) {
      if (isDuplicateName(err)) return { ok: false, error: DUPLICATE_NAME_MESSAGE, status: 409 }
      throw err
    }
  }

  async update(ctx: CallerContext, id: string, data: Partial<Location>): Promise<LocationResult> {
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

    try {
      const updated = await this.repo.update(id, data)
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
}
