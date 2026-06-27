import type { CallerContext } from '../../middleware/auth'
import type {
  LocationRepository,
  OperatorRepository,
  Storefront,
  StorefrontFilters,
  StorefrontRepository,
} from '../types'

/**
 * In-memory double for the public storefront catalog read (#391). Composes the
 * location + operator repos (depends on the interfaces, not concretes) so it
 * shares their data when wired with the same instances in the composition root.
 * The Drizzle impl does the real `locations ⨝ operators` JOIN; here we read the
 * already-scoped ACTIVE locations and join the operator name in memory.
 */
export class InMemoryStorefrontRepository implements StorefrontRepository {
  constructor(
    private readonly locationRepo: LocationRepository,
    private readonly operatorRepo: OperatorRepository,
  ) {}

  async findActiveStorefronts(
    ctx: CallerContext,
    filters?: StorefrontFilters,
  ): Promise<Storefront[]> {
    const active = await this.locationRepo.findAll(ctx, { status: 'ACTIVE' })
    let locations = filters?.pickupLocationId
      ? active.filter((l) => l.id === filters.pickupLocationId)
      : active
    // #394: keep only locations whose region is in the resolved descendant set.
    // An empty set (unknown region / region with no locations) matches nothing; a
    // null regionId never matches a region filter.
    if (filters?.regionIds) {
      const regionIds = new Set(filters.regionIds)
      locations = locations.filter((l) => l.regionId !== null && regionIds.has(l.regionId))
    }

    const joined = await Promise.all(
      locations.map(async (location) => {
        const operator = await this.operatorRepo.findById(location.operatorId)
        // Orphan location (operator gone) is not a usable storefront card; #1206:
        // a soft-deactivated operator (deactivatedAt set) is pulled off the public
        // storefront too. `== null` mirrors the Drizzle `isNull` in the JOIN repo.
        return operator && operator.deactivatedAt == null
          ? { ...location, operatorName: operator.name }
          : null
      }),
    )
    return joined.filter((s): s is Storefront => s !== null)
  }
}
