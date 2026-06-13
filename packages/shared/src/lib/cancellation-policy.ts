export type CancellationTier = 'FREE' | 'LOW' | 'MEDIUM' | 'FULL'

export interface CancellationResult {
  tier: CancellationTier
  feePercentage: number
  feeAmount: number
  refundAmount: number
}

export interface CancellationTierDescriptor {
  tier: CancellationTier
  /** Inclusive lower bound, in hours before pickup, for this tier to apply. */
  minHours: number
  feePercentage: number
}

/**
 * Tiered cancellation schedule: 72h free / 48h 30% / 24h 70% / same-day 100%.
 * Ordered most-lenient → strictest; the first tier whose `minHours` is still
 * satisfied wins. Exported so the renter-facing UI (#657) renders the canonical
 * schedule instead of re-hardcoding the thresholds.
 */
export const CANCELLATION_TIERS: ReadonlyArray<CancellationTierDescriptor> = [
  { tier: 'FREE', minHours: 72, feePercentage: 0 },
  { tier: 'LOW', minHours: 48, feePercentage: 0.3 },
  { tier: 'MEDIUM', minHours: 24, feePercentage: 0.7 },
  { tier: 'FULL', minHours: 0, feePercentage: 1 },
] as const

const HOURS_MS = 60 * 60 * 1000

/** The tier descriptor that applies for a cancellation at `now` vs `pickupAt`. */
function matchTier(pickupAt: Date, now: Date): CancellationTierDescriptor {
  const hoursUntilPickup = (pickupAt.getTime() - now.getTime()) / HOURS_MS
  return (
    CANCELLATION_TIERS.find((t) => hoursUntilPickup >= t.minHours) ??
    CANCELLATION_TIERS[CANCELLATION_TIERS.length - 1]!
  )
}

/** Which cancellation tier currently applies — the fee-free way to drive UI highlighting. */
export function getCancellationTier(pickupAt: Date, now: Date): CancellationTier {
  return matchTier(pickupAt, now).tier
}

export function calculateCancellationFee(
  pickupAt: Date,
  now: Date,
  totalPrice: number,
): CancellationResult {
  const matched = matchTier(pickupAt, now)

  const feeAmount = Math.round(totalPrice * matched.feePercentage)
  const refundAmount = totalPrice - feeAmount

  return {
    tier: matched.tier,
    feePercentage: matched.feePercentage,
    feeAmount,
    refundAmount,
  }
}
