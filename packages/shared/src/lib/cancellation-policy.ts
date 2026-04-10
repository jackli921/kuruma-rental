export interface CancellationResult {
  tier: 'FREE' | 'LOW' | 'MEDIUM' | 'FULL'
  feePercentage: number
  feeAmount: number
  refundAmount: number
}

const HOURS_MS = 60 * 60 * 1000

export function calculateCancellationFee(
  pickupAt: Date,
  now: Date,
  totalPrice: number,
): CancellationResult {
  const hoursUntilPickup = (pickupAt.getTime() - now.getTime()) / HOURS_MS

  let tier: CancellationResult['tier']
  let feePercentage: number

  if (hoursUntilPickup >= 72) {
    tier = 'FREE'
    feePercentage = 0
  } else if (hoursUntilPickup >= 48) {
    tier = 'LOW'
    feePercentage = 0.3
  } else if (hoursUntilPickup >= 24) {
    tier = 'MEDIUM'
    feePercentage = 0.7
  } else {
    tier = 'FULL'
    feePercentage = 1
  }

  const feeAmount = Math.round(totalPrice * feePercentage)
  const refundAmount = totalPrice - feeAmount

  return { tier, feePercentage, feeAmount, refundAmount }
}
