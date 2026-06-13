import type { FleetVehicleOverview } from '@kuruma/shared/types/fleet'
import type { CallerContext } from '../middleware/auth'
import type { FleetOverviewRepository } from '../repositories/types'

// Thin service wrapping FleetOverviewRepository. Its only job is to own
// the clock — `now` defaults to `new Date()` here so routes don't have
// to think about it, and tests can pass a deterministic Date without
// stubbing the global clock. Tenant scoping rides on `ctx` (#594), enforced
// by the repository's operator predicate.
export class FleetOverviewService {
  constructor(private readonly repo: FleetOverviewRepository) {}

  async findFleetOverview(
    ctx: CallerContext,
    now: Date = new Date(),
  ): Promise<FleetVehicleOverview[]> {
    return this.repo.findFleetOverview(ctx, now)
  }
}
