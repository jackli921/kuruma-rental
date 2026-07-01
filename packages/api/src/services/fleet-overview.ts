import type { FleetVehicleOverview } from '@kuruma/shared/types/fleet'
import type { CallerContext } from '../middleware/auth'
import type { FleetOverviewRepository } from '../repositories/types'
import { bookingReadScope, narrowReadToOperator } from '../tenancy'

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
    requestedOperatorId?: string,
  ): Promise<FleetVehicleOverview[]> {
    // #407 slice 4: a bypass admin using the operator-context picker narrows the
    // cross-operator fleet to one operator. narrowReadToOperator drops the id to
    // undefined for any non-`all` caller under bookingReadScope (this read's
    // private-read vocabulary), so a renter/partner/tenant id never widens (#1272).
    return this.repo.findFleetOverview(
      ctx,
      now,
      narrowReadToOperator(ctx, requestedOperatorId, bookingReadScope),
    )
  }
}
