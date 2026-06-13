import type { VehicleDetail } from '@kuruma/shared/types/vehicle-detail'
import type { CallerContext } from '../middleware/auth'
import type { VehicleDetailRepository } from '../repositories/types'

// Thin service wrapping VehicleDetailRepository. Owns the clock for the
// repo's time-dependent aggregates (upcoming bookings filter, revenue
// windows, daily utilization). Same pattern as FleetOverviewService.
export class VehicleDetailService {
  constructor(private readonly repo: VehicleDetailRepository) {}

  async findVehicleDetail(
    ctx: CallerContext,
    vehicleId: string,
    now: Date = new Date(),
  ): Promise<VehicleDetail | undefined> {
    return this.repo.findVehicleDetail(ctx, vehicleId, now)
  }
}
