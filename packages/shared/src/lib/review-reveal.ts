import type { ReviewAuthorRole } from '../enums'

// Pure double-blind reveal + aggregate logic for mutual reviews (#1067). No I/O,
// no clock of its own (now is passed in) — so slice 2's lazy-reveal-on-read and the
// window sweep, plus slice 5's aggregates, all build on functions that are fully
// unit-testable without a DB.

/** The fixed double-blind window, identical for both sides (#1067): a review auto-
 *  publishes this many days after the booking completes if the counterpart never
 *  reciprocates. Snapshotted into each row's `revealDeadlineAt` at first submit. */
export const REVIEW_WINDOW_DAYS = 14

const MS_PER_DAY = 24 * 60 * 60 * 1000

/** The instant a review stops being held for reciprocity: trip-completion time plus
 *  the fixed window. Anchored to completion (not submit time) so a late first-submitter
 *  still gets a deadline bounded by when the trip actually ended. Pure — no mutation. */
export function computeRevealDeadline(completedAt: Date): Date {
  return new Date(completedAt.getTime() + REVIEW_WINDOW_DAYS * MS_PER_DAY)
}

/** The reveal-relevant projection of a review row. */
export interface RevealInput {
  readonly publishedAt: Date | null
  readonly revealDeadlineAt: Date
}

/**
 * When should THIS review publish? Double-blind: a side reveals once the COUNTERPART
 * has also submitted, OR the fixed window (`revealDeadlineAt`) has elapsed — whichever
 * comes first. Returns the instant to stamp as `publishedAt`, or null to keep it hidden.
 * Already-published reviews are returned unchanged (publish is forward-only).
 */
export function decideReveal(
  review: RevealInput,
  counterpartSubmitted: boolean,
  now: Date,
): Date | null {
  if (review.publishedAt) return review.publishedAt
  if (counterpartSubmitted) return now
  if (now.getTime() >= review.revealDeadlineAt.getTime()) return now
  return null
}

/** Per-side submission state for a booking — drives `counterpartSubmitted` above. */
export interface SidesSummary {
  readonly renterSubmitted: boolean
  readonly operatorSubmitted: boolean
  readonly bothSubmitted: boolean
}

/** Summarize which sides have authored a review for a booking. The renter may author
 *  several (operator + vehicle); the operator authors at most one (renter). */
export function summarizeSides(
  reviews: ReadonlyArray<{ readonly authorRole: ReviewAuthorRole }>,
): SidesSummary {
  const renterSubmitted = reviews.some((r) => r.authorRole === 'RENTER')
  const operatorSubmitted = reviews.some((r) => r.authorRole === 'OPERATOR')
  return { renterSubmitted, operatorSubmitted, bothSubmitted: renterSubmitted && operatorSubmitted }
}

/** Aggregated ratings for a subject (operator / vehicle / class), slice 5. */
export interface RatingAggregate {
  readonly count: number
  /** Mean overall (1-5), or null when there are no reviews. */
  readonly averageOverall: number | null
  /** Mean per sub-dimension, averaged only over reviews that supplied that dimension. */
  readonly subAverages: Record<string, number>
}

/** Mean overall + per-dimension means over a set of reviews. A sub-dimension is
 *  averaged only across the reviews that actually rated it (absent ≠ zero). */
export function aggregateRatings(
  reviews: ReadonlyArray<{ readonly overall: number; readonly subRatings: Record<string, number> }>,
): RatingAggregate {
  if (reviews.length === 0) return { count: 0, averageOverall: null, subAverages: {} }
  const overallSum = reviews.reduce((sum, r) => sum + r.overall, 0)
  const dims = new Map<string, { sum: number; n: number }>()
  for (const r of reviews) {
    for (const [key, value] of Object.entries(r.subRatings)) {
      const prev = dims.get(key) ?? { sum: 0, n: 0 }
      dims.set(key, { sum: prev.sum + value, n: prev.n + 1 })
    }
  }
  const subAverages: Record<string, number> = {}
  for (const [key, { sum, n }] of dims) subAverages[key] = sum / n
  return { count: reviews.length, averageOverall: overallSum / reviews.length, subAverages }
}
