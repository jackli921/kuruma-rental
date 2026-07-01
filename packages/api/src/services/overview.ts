import type { OperatorOverview } from '@kuruma/shared/types/overview'
import type { CallerContext } from '../middleware/auth'
import type { OverviewRepository } from '../repositories/types'
import { narrowReadToOperator } from '../tenancy'

/**
 * Thin service over {@link OverviewRepository} (#524). Its only job is to own
 * the clock — `now` defaults to `new Date()` here so the route never thinks
 * about it, and tests can pin "upcoming" to a deterministic instant. Tenant
 * scoping lives in the repo (it reads `ctx`), mirroring FleetOverviewService.
 */
export class OverviewService {
  constructor(private readonly repo: OverviewRepository) {}

  async getOverview(
    ctx: CallerContext,
    now: Date = new Date(),
    requestedOperatorId?: string,
  ): Promise<OperatorOverview> {
    // #407 slice 4: a bypass admin using the operator-context picker narrows the
    // cross-operator aggregate to one operator. narrowReadToOperator drops the id
    // to undefined for any tenant-scoped caller, so a foreign id never widens.
    return this.repo.getOperatorOverview(ctx, now, narrowReadToOperator(ctx, requestedOperatorId))
  }
}
