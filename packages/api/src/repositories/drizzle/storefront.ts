import { locations, operators } from '@kuruma/shared/db/schema'
import { type SQL, and, asc, eq, inArray } from 'drizzle-orm'
import type { CallerContext } from '../../middleware/auth'
import { operatorReadScope } from '../../tenancy'
import type { Storefront, StorefrontFilters, StorefrontRepository } from '../types'
import { type Db, locationColumns, toLocation } from './shared'

/**
 * Public renter-facing storefront catalog read (#391). INNER-joins
 * locations ⨝ operators so an orphan location (operator gone) never surfaces,
 * and projects the operator display name onto each ACTIVE location card.
 * operatorReadScope resolves PUBLIC_CONTEXT to {kind:'all'} — cross-operator is
 * the marketplace point; the safety control is column projection, not row
 * scoping (slice-5 plan §5).
 */
export class DrizzleStorefrontRepository implements StorefrontRepository {
  constructor(private readonly db: Db) {}

  async findActiveStorefronts(
    ctx: CallerContext,
    filters?: StorefrontFilters,
  ): Promise<Storefront[]> {
    const scope = operatorReadScope(ctx)
    if (scope.kind === 'none') return []

    const conditions: SQL[] = [eq(locations.status, 'ACTIVE')]
    if (scope.kind === 'operator') conditions.push(eq(locations.operatorId, scope.operatorId))
    if (filters?.pickupLocationId) conditions.push(eq(locations.id, filters.pickupLocationId))
    // #394: an empty regionIds set means "no region matched" -> no storefronts.
    // Short-circuit so we don't emit `IN ()` (and a null regionId never matches).
    if (filters?.regionIds) {
      if (filters.regionIds.length === 0) return []
      conditions.push(inArray(locations.regionId, filters.regionIds))
    }

    const rows = await this.db
      .select({ ...locationColumns, operatorName: operators.name })
      .from(locations)
      .innerJoin(operators, eq(locations.operatorId, operators.id))
      .where(and(...conditions))
      .orderBy(asc(operators.name), asc(locations.name))

    return rows.map(({ operatorName, ...location }) => ({
      ...toLocation(location),
      operatorName,
    }))
  }
}
