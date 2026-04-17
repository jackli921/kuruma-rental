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

  async findAll(filters?: VehicleClassFilters): Promise<VehicleClass[]> {
    return this.repo.findAll(filters)
  }

  async findById(id: string): Promise<VehicleClass | undefined> {
    return this.repo.findById(id)
  }

  async findBySlug(slug: string): Promise<VehicleClass | undefined> {
    return this.repo.findBySlug(slug)
  }

  async create(data: Omit<VehicleClass, 'id' | 'createdAt' | 'updatedAt'>): Promise<CreateResult> {
    const existing = await this.repo.findBySlug(data.slug)
    if (existing) {
      return { ok: false, error: 'Slug already in use', status: 409 }
    }
    const vehicleClass = await this.repo.create(data)
    return { ok: true, vehicleClass }
  }

  async update(id: string, data: Partial<VehicleClass>): Promise<UpdateResult> {
    const existing = await this.repo.findById(id)
    if (!existing) {
      return { ok: false, error: 'Vehicle class not found', status: 404 }
    }

    if (data.slug !== undefined && data.slug !== existing.slug) {
      const slugOwner = await this.repo.findBySlug(data.slug)
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

  async archive(id: string): Promise<ArchiveResult> {
    const existing = await this.repo.findById(id)
    if (!existing) {
      return { ok: false, error: 'Vehicle class not found', status: 404 }
    }

    // Guard: cannot archive a class that still has live bookings via any of
    // its member vehicles. Owner must reassign/cancel those bookings first.
    // Client-side check in /manage/classes is racy — this is the server seal.
    const { data: members } = await this.vehicleRepo.findAll({
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
