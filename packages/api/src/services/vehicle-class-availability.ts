import { type CallerContext, SYSTEM_CONTEXT } from '../middleware/auth'
import type {
  AvailabilityRepository,
  OperatorRepository,
  VehicleClassRepository,
  VehicleRepository,
} from '../repositories/types'

export interface ClassAvailability {
  totalCars: number
  availableCars: number
  sampleAvailableVehicleIds: string[]
}

export type ClassAvailabilityResult =
  | { ok: true; data: ClassAvailability }
  | { ok: false; error: string; status: number }

const SAMPLE_CAP = 5

/**
 * Computes how many vehicles of a given class are free over a date range.
 *
 * Split from VehicleClassService because the CRUD service's single
 * responsibility is managing class records. Availability is a read-side
 * query spanning classes + vehicles + bookings; colocating it would turn
 * the CRUD service into a grab-bag.
 */
export class VehicleClassAvailabilityService {
  constructor(
    private readonly classRepo: VehicleClassRepository,
    private readonly vehicleRepo: VehicleRepository,
    private readonly availabilityRepo: AvailabilityRepository,
    // #1224: to exclude a soft-deactivated operator's cars from BOTH counts, keeping
    // totalCars consistent with availableCars (the seam already drops them).
    private readonly operatorRepo: OperatorRepository,
  ) {}

  async getAvailabilityForClass(
    ctx: CallerContext,
    slug: string,
    from: Date,
    to: Date,
  ): Promise<ClassAvailabilityResult> {
    const vc = await this.classRepo.findBySlug(ctx, slug)
    if (!vc) return { ok: false, error: 'Vehicle class not found', status: 404 }

    // Only AVAILABLE vehicles count toward the class total. MAINTENANCE and
    // RETIRED vehicles are never bookable regardless of the date range.
    // Public catalog endpoint; no user context. SYSTEM_CONTEXT is safe
    // because this read does not expose per-tenant data.
    const { data: vehicles } = await this.vehicleRepo.findAll(SYSTEM_CONTEXT, {
      status: 'AVAILABLE',
    })
    // #1224: a soft-deactivated operator is off the platform, so its cars count
    // toward NEITHER the class total nor the available count — keeping both
    // consistent with /availability, which drops them at the repo seam. One list()
    // (operators are bounded tenants) instead of a per-car lookup avoids an N+1.
    const deactivatedOperatorIds = new Set(
      (await this.operatorRepo.list()).filter((o) => o.deactivatedAt != null).map((o) => o.id),
    )
    const inClass = vehicles.filter(
      (v) => v.classId === vc.id && !deactivatedOperatorIds.has(v.operatorId),
    )
    const totalCars = inClass.length
    if (totalCars === 0) {
      return { ok: true, data: { totalCars: 0, availableCars: 0, sampleAvailableVehicleIds: [] } }
    }

    // Reuse findAvailableVehicles (which already honours effectiveEndAt +
    // buffer via the booking exclusion logic) and intersect with the class.
    const availableAll = await this.availabilityRepo.findAvailableVehicles(from, to)
    const availableIds = new Set(availableAll.map((v) => v.id))
    const availableInClass = inClass.filter((v) => availableIds.has(v.id))

    return {
      ok: true,
      data: {
        totalCars,
        availableCars: availableInClass.length,
        sampleAvailableVehicleIds: availableInClass.slice(0, SAMPLE_CAP).map((v) => v.id),
      },
    }
  }
}
