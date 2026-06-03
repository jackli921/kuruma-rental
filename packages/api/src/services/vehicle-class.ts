import { type CallerContext, SYSTEM_CONTEXT } from '../middleware/auth'
import type {
  BookingRepository,
  VehicleClassFilters,
  VehicleClassRepository,
  VehicleRepository,
} from '../repositories/types'
import type { VehicleClass } from '../stores'

export type CreateResult =
  | { ok: true; vehicleClass: VehicleClass }
  | { ok: false; error: string; status: number }

export type UpdateResult = CreateResult

export type ArchiveResult =
  | { ok: true; vehicleClass: VehicleClass }
  | {
      ok: false
      error: string
      status: number
      code?: 'CLASS_HAS_ACTIVE_BOOKINGS'
      activeBookingsCount?: number
    }

export class VehicleClassService {
  constructor(
    private readonly repo: VehicleClassRepository,
    private readonly vehicleRepo: VehicleRepository,
    private readonly bookingRepo: BookingRepository,
  ) {}

  async findAll(ctx: CallerContext, filters?: VehicleClassFilters): Promise<VehicleClass[]> {
    return this.repo.findAll(ctx, filters)
  }

  async findById(ctx: CallerContext, id: string): Promise<VehicleClass | undefined> {
    return this.repo.findById(ctx, id)
  }

  async findBySlug(ctx: CallerContext, slug: string): Promise<VehicleClass | undefined> {
    return this.repo.findBySlug(ctx, slug)
  }

  async create(
    // Intentionally unscoped: create takes ctx for interface symmetry with the
    // other methods, but slug uniqueness is global so it uses SYSTEM_CONTEXT
    // below, not the caller. Underscore-prefixed to mark it deliberately unused.
    _ctx: CallerContext,
    data: Omit<VehicleClass, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<CreateResult> {
    // Slug uniqueness is global (DB unique constraint), so the collision check
    // must see across operators — scope it to SYSTEM, not the caller (#395).
    const existing = await this.repo.findBySlug(SYSTEM_CONTEXT, data.slug)
    if (existing) {
      return { ok: false, error: 'Slug already in use', status: 409 }
    }
    const vehicleClass = await this.repo.create(data)
    return { ok: true, vehicleClass }
  }

  async update(ctx: CallerContext, id: string, data: Partial<VehicleClass>): Promise<UpdateResult> {
    // Existence is caller-scoped: an operator may only edit its own class.
    const existing = await this.repo.findById(ctx, id)
    if (!existing) {
      return { ok: false, error: 'Vehicle class not found', status: 404 }
    }

    if (data.slug !== undefined && data.slug !== existing.slug) {
      const slugOwner = await this.repo.findBySlug(SYSTEM_CONTEXT, data.slug)
      if (slugOwner && slugOwner.id !== id) {
        return { ok: false, error: 'Slug already in use', status: 409 }
      }
    }

    const mergedDaily = data.dailyRateJpy !== undefined ? data.dailyRateJpy : existing.dailyRateJpy
    const mergedHourly =
      data.hourlyRateJpy !== undefined ? data.hourlyRateJpy : existing.hourlyRateJpy
    if (mergedDaily == null && mergedHourly == null) {
      return {
        ok: false,
        error: 'At least one rate (daily or hourly) is required',
        status: 400,
      }
    }

    const updated = await this.repo.update(id, data)
    if (!updated) {
      return { ok: false, error: 'Vehicle class not found', status: 404 }
    }
    return { ok: true, vehicleClass: updated }
  }

  async archive(ctx: CallerContext, id: string): Promise<ArchiveResult> {
    const existing = await this.repo.findById(ctx, id)
    if (!existing) {
      return { ok: false, error: 'Vehicle class not found', status: 404 }
    }

    // Guard: cannot archive a class that still has live bookings via any of
    // its member vehicles. Owner must reassign/cancel those bookings first.
    // Client-side check in /manage/classes is racy — this is the server seal.
    // The route-level FLEET_WRITE_ROLES gate (staff + tenant operators, #397)
    // already covers authz, and the caller-scoped findById above bounds the
    // operator to its own class. Use SYSTEM_CONTEXT for this internal members
    // read so the service boundary stays auth-agnostic.
    const { data: members } = await this.vehicleRepo.findAll(SYSTEM_CONTEXT, {
      classId: id,
      includeRetired: true,
    })
    if (members.length > 0) {
      const activeBookingsCount = await this.bookingRepo.countActiveForVehicles(
        members.map((v) => v.id),
      )
      if (activeBookingsCount > 0) {
        return {
          ok: false,
          error: 'Cannot archive a class with active bookings',
          status: 409,
          code: 'CLASS_HAS_ACTIVE_BOOKINGS',
          activeBookingsCount,
        }
      }
    }

    const archived = await this.repo.archive(id)
    if (!archived) {
      return { ok: false, error: 'Vehicle class not found', status: 404 }
    }
    return { ok: true, vehicleClass: archived }
  }
}
