import type { AppOverrides } from '../app-overrides'
import { ReviewService, type SweepSummary } from '../services/review'
import { type Repos, buildRepos } from './repositories'

// A daily sweep over window-elapsed reviews; far above the per-day reveal volume for a
// 40-50 vehicle fleet, so a single run drains the backlog. A run that hits the cap just
// defers the overflow to tomorrow's idempotent run — reveals are never lost, only delayed.
const REVIEW_SWEEP_LIMIT = 500

/**
 * Composition seam for the #1067 daily review-reveal sweep, resolved by the Workers
 * `scheduled` cron exactly as the other backstops are. Publishes reviews whose 14-day
 * double-blind window has elapsed but which no read settled — the backstop that keeps a
 * one-sided review from staying hidden forever. Idempotent (publishMany first-write-wins).
 *
 * Lives in its own composition module (not index.ts) to keep the composition root under
 * its size cap; mirrors the builder pattern of buildComplianceDigestService et al.
 */
export function buildReviewRevealSweep(
  overrides?: AppOverrides,
  repos: Repos = buildRepos(overrides),
): { run: () => Promise<SweepSummary> } {
  const service = new ReviewService(
    repos.reviewRepo,
    repos.bookingRepo,
    repos.vehicleRepo,
    repos.bookingEventRepo,
    repos.operatorMembershipRepo,
  )
  return { run: () => service.sweep(new Date(), REVIEW_SWEEP_LIMIT) }
}
