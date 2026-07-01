import type { ReviewRepository } from '../repositories/types'

/**
 * Aggregate read service for the public review surfaces (#1085 slice 5). Computes
 * avg + count per subject id (operator, vehicle, class) from the repo's published+visible
 * sum/count scan. Public — no authz; callers are anonymous storefront pages.
 *
 * Why the avg lives HERE not in the repo: the repo returns raw sum+count so the SQL
 * tier stays a thin index scan; rounding and the "no published+visible reviews"
 * branch are presentation policy, which belongs in the service. The route is a
 * pass-through.
 */

export interface AggregateEntry {
  /** Mean of `overall`, rounded to 1 decimal — display-quality, not actuarial. */
  readonly avg: number
  readonly count: number
}

/** id -> {avg,count} when rated; null when the id is known to the caller but has
 *  no published+visible reviews (so the UI renders "no reviews yet", not "rated zero"). */
export type AggregateMap = Record<string, AggregateEntry | null>

/** Cap mirrors the renter-facing search list size (#391) and a /search storefront page's
 *  card count — a request asking for more than this is fanned out, not paginated. */
export const MAX_AGGREGATE_IDS = 100

export class InvalidAggregateIdsError extends Error {
  constructor(public readonly reason: 'TOO_MANY_IDS' | 'IDS_REQUIRED') {
    super(reason)
    this.name = 'InvalidAggregateIdsError'
  }
}

export class ReviewAggregateService {
  constructor(private readonly reviewRepo: ReviewRepository) {}

  forOperators(ids: readonly string[]): Promise<AggregateMap> {
    return this.aggregate(ids, (i) => this.reviewRepo.aggregateByOperator(i))
  }

  forVehicles(ids: readonly string[]): Promise<AggregateMap> {
    return this.aggregate(ids, (i) => this.reviewRepo.aggregateByVehicle(i))
  }

  forClasses(ids: readonly string[]): Promise<AggregateMap> {
    return this.aggregate(ids, (i) => this.reviewRepo.aggregateByClass(i))
  }

  private async aggregate(
    ids: readonly string[],
    scan: (ids: readonly string[]) => Promise<Map<string, { sum: number; count: number }>>,
  ): Promise<AggregateMap> {
    if (ids.length === 0) throw new InvalidAggregateIdsError('IDS_REQUIRED')
    // Dedupe BEFORE the cap: the cap measures DB scan width (the unique ids the
    // GROUP BY runs over), not raw input — a careless duplicate from the client
    // shouldn't reject a request the DB would happily serve.
    const unique = Array.from(new Set(ids))
    if (unique.length > MAX_AGGREGATE_IDS) throw new InvalidAggregateIdsError('TOO_MANY_IDS')
    const sums = await scan(unique)
    const out: AggregateMap = {}
    for (const id of unique) {
      const row = sums.get(id)
      // No row means "no published+visible reviews"; the UI distinguishes this
      // from a rated-zero (which can't happen — overall is 1-5).
      out[id] = row ? { avg: round1(row.sum / row.count), count: row.count } : null
    }
    return out
  }
}

/** Round to 1 decimal. 4.333 -> 4.3, 4.35 -> 4.4 (banker's-rounding-safe-enough for display). */
function round1(n: number): number {
  return Math.round(n * 10) / 10
}
