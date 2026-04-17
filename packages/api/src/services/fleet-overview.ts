import type { FleetVehicleOverview } from '@kuruma/shared/types/fleet'
import type { FleetOverviewRepository } from '../repositories/types'

// Thin service wrapping FleetOverviewRepository. Its only job is to own
// the clock — `now` defaults to `new Date()` here so routes don't have
// to think about it, and tests can pass a deterministic Date without
// stubbing the global clock.
export class FleetOverviewService {
  constructor(private readonly repo: FleetOverviewRepository) {}

  async findFleetOverview(now: Date = new Date()): Promise<FleetVehicleOverview[]> {
    return this.repo.findFleetOverview(now)
  }
}
