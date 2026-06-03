import type { CallerContext } from '../middleware/auth'
import type { Location, LocationFilters, LocationRepository } from '../repositories/types'

export type LocationResult =
  | { ok: true; location: Location }
  | { ok: false; error: string; status: number }

const DUPLICATE_NAME_MESSAGE = 'A location with this name already exists'
const NOT_FOUND_MESSAGE = 'Location not found'

export class LocationService {
  constructor(private readonly repo: LocationRepository) {}

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

    const location = await this.repo.create(data)
    return { ok: true, location }
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

    const updated = await this.repo.update(id, data)
    if (!updated) return { ok: false, error: NOT_FOUND_MESSAGE, status: 404 }
    return { ok: true, location: updated }
  }

  async archive(ctx: CallerContext, id: string): Promise<LocationResult> {
    // Same caller-scoped guard as update — load before mutate so a cross-tenant
    // id can never be archived. No active-booking guard in slice 2 (locations
    // aren't on bookings until slice 6).
    const existing = await this.repo.findById(ctx, id)
    if (!existing) return { ok: false, error: NOT_FOUND_MESSAGE, status: 404 }

    const archived = await this.repo.archive(id)
    if (!archived) return { ok: false, error: NOT_FOUND_MESSAGE, status: 404 }
    return { ok: true, location: archived }
  }
}
