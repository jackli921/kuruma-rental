import type { WebhookResult } from './payment'

/**
 * Pure alert policy (Functional Core) for the Stripe webhook: which outcomes mean money is
 * stuck at Stripe and a human must act. Returns the alert message, or null for outcomes that
 * are benign or already self-healed.
 *
 * - `amount_mismatch` with a `failed`/`unrefundable` auto-refund (#1378): the over-charge was
 *   captured but the corrective refund did NOT go through — funds may be stranded.
 * - `double_payment`: a second full charge is recorded but, unlike a mismatch, is NOT
 *   auto-refunded — the duplicate must be refunded by hand.
 *
 * A `refunded`/`pending` mismatch, and `ignored`/`recorded`/`invalid_signature`, page nobody.
 * Kept pure so the route's Sentry wiring (Imperative Shell) stays a one-liner and testable.
 */
export function paymentWebhookStrandedAlert(result: WebhookResult): string | null {
  if (
    result.outcome === 'amount_mismatch' &&
    (result.refund === 'failed' || result.refund === 'unrefundable')
  ) {
    return `amount-mismatch auto-refund did not complete (${result.refund}) — captured funds may be stranded and need manual reconciliation`
  }
  if (result.outcome === 'double_payment') {
    return 'double charge recorded but NOT auto-refunded — the duplicate charge needs a manual refund'
  }
  return null
}
