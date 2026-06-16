import {
  type CancellationTier,
  calculateCancellationFee,
} from '@kuruma/shared/lib/cancellation-policy'

/**
 * The two ways the renter cancel dialog presents a cancellation (#856/#868),
 * modelled as a discriminated union so the no-show case can't carry refund
 * fields and the dialog's refund line is unreachable unless a refund exists.
 *  - `no-show`: `now` is at/after pickup — the tiered schedule no longer applies
 *    and the full fee is owed (#868 H2); only the fee is shown.
 *  - `tiered`: the shared schedule's breakdown (fee + percentage + estimated
 *    refund). A same-day cancel is FULL (100% fee / 0 refund) but still *before*
 *    pickup, so it stays a tier display — the discriminant is past-pickup, not FULL.
 */
export type CancellationPreview =
  | { readonly mode: 'no-show'; readonly feeAmount: number }
  | {
      readonly mode: 'tiered'
      readonly tier: CancellationTier
      /** 0 | 0.3 | 0.7 | 1 — the tier as a fraction; surfaced as a percentage. */
      readonly feePercentage: number
      readonly feeAmount: number
      readonly refundAmount: number
    }

/**
 * Functional core for the renter cancel dialog (#856): given the booking's
 * pickup time, the current instant and the total price, return the fee the
 * renter would owe and the refund they'd get back. Pure — `now` is injected so
 * the no-show boundary is testable without mocking the clock (the shell passes
 * `new Date()`). Amounts come straight from the shared schedule so the preview
 * can never drift from the server's authoritative cancel-time computation.
 */
export function buildCancellationPreview(
  startAt: Date,
  now: Date,
  totalPrice: number,
): CancellationPreview {
  const { tier, feePercentage, feeAmount, refundAmount } = calculateCancellationFee(
    startAt,
    now,
    totalPrice,
  )
  if (now.getTime() >= startAt.getTime()) {
    return { mode: 'no-show', feeAmount }
  }
  return { mode: 'tiered', tier, feePercentage, feeAmount, refundAmount }
}
