import type { OperatorOverview } from '@kuruma/shared/types/overview'
import type { CallerContext } from '../middleware/auth'
import type { OverviewRepository } from '../repositories/types'

/**
 * Thin service over {@link OverviewRepository} (#524). Its only job is to own
 * the clock — `now` defaults to `new Date()` here so the route never thinks
 * about it, and tests can pin "upcoming" to a deterministic instant. Tenant
 * scoping lives in the repo (it reads `ctx`), mirroring FleetOverviewService.
 */
export class OverviewService {
  constructor(private readonly repo: OverviewRepository) {}

  async getOverview(ctx: CallerContext, now: Date = new Date()): Promise<OperatorOverview> {
    return this.repo.getOperatorOverview(ctx, now)
  }
}
