export type CancellationTier = 'FREE' | 'LOW' | 'MEDIUM' | 'FULL'

export interface CancellationResult {
  tier: CancellationTier
  feePercentage: number
  feeAmount: number
  refundAmount: number
}

/** Tiered cancellation: 72h free / 48h 30% / 24h 70% / same-day 100% */
const CANCELLATION_TIERS: ReadonlyArray<{
  tier: CancellationTier
  minHours: number
  feePercentage: number
}> = [
  { tier: 'FREE', minHours: 72, feePercentage: 0 },
  { tier: 'LOW', minHours: 48, feePercentage: 0.3 },
  { tier: 'MEDIUM', minHours: 24, feePercentage: 0.7 },
  { tier: 'FULL', minHours: 0, feePercentage: 1 },
] as const

const HOURS_MS = 60 * 60 * 1000

export function calculateCancellationFee(
  pickupAt: Date,
  now: Date,
  totalPrice: number,
): CancellationResult {
  const hoursUntilPickup = (pickupAt.getTime() - now.getTime()) / HOURS_MS

  const matched =
    CANCELLATION_TIERS.find((t) => hoursUntilPickup >= t.minHours) ??
    CANCELLATION_TIERS[CANCELLATION_TIERS.length - 1]!

  const feeAmount = Math.round(totalPrice * matched.feePercentage)
  const refundAmount = totalPrice - feeAmount

  return {
    tier: matched.tier,
    feePercentage: matched.feePercentage,
    feeAmount,
    refundAmount,
  }
}
