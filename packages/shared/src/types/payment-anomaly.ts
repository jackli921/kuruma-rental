/**
 * Platform-admin view of a payment anomaly needing review (#508 P2, surfaced #744).
 *
 * A verified Stripe webhook can report a charge that does NOT become a clean
 * `payment_events` row: a second distinct Session paying an already-paid booking
 * (`DOUBLE_PAYMENT` — refund the duplicate) or a Session whose amount/currency
 * does not match the booking snapshot (`AMOUNT_MISMATCH` — investigate). These are
 * persisted in `payment_anomalies` (kept OUT of `payment_events` so revenue math is
 * never polluted) and surfaced read-only on the admin revenue tab (#462).
 *
 * This is the WIRE contract the API returns and the web consumes — web cannot
 * import the Drizzle schema, so the shape (and the kind union) live here. Dates are
 * ISO 8601 strings (JSON has no Date); amounts are whole JPY and may be null when
 * Stripe sent a malformed event.
 */

// The `payment_anomaly_kind` / `payment_anomaly_resolution` enums live in the
// `enums.ts` SSoT (fed to `pgEnum` in `db/payment.ts`, pinned by `enums.test.ts`).
// Re-exported here so the web boundary import path
// (`@kuruma/shared/types/payment-anomaly`) stays stable — web cannot import the
// Drizzle schema, so it reads these unions as pure data from this subpath.
import {
  PAYMENT_ANOMALY_KINDS,
  PAYMENT_ANOMALY_RESOLUTIONS,
  type PaymentAnomalyKind,
  type PaymentAnomalyResolution,
} from '../enums'

export {
  PAYMENT_ANOMALY_KINDS,
  PAYMENT_ANOMALY_RESOLUTIONS,
  type PaymentAnomalyKind,
  type PaymentAnomalyResolution,
}

/** One unresolved anomaly. Identifiers are carried so an admin can reconcile or
 *  refund: `stripeEventId` is the reconciliation handle, `stripePaymentIntentId`
 *  is what an actual refund is issued against (null on a malformed event). */
export interface PaymentAnomalyView {
  id: string
  kind: PaymentAnomalyKind
  /** Partner attribution, re-derived from the booking on the webhook. */
  operatorId: string
  bookingId: string
  /** Stripe `amount_total` (whole JPY); null when Stripe omitted it. */
  receivedAmountJpy: number | null
  /** The booking total snapshot at webhook time (whole JPY). */
  expectedAmountJpy: number | null
  currency: string | null
  stripeEventId: string
  stripePaymentIntentId: string | null
  /** ISO 8601 (UTC). When the anomaly was recorded. */
  createdAt: string
  /** ISO 8601 (UTC) once an admin closed the review queue item; null = still open.
   *  The other resolution fields are null exactly when this is (#1075 slice 3). */
  resolvedAt: string | null
  /** Why the anomaly was closed; null while unresolved. `resolvedBy` (the actioning
   *  admin's id) stays internal — no user join on this surface in v1. */
  resolution: PaymentAnomalyResolution | null
  /** Optional free-text the admin left when resolving; null otherwise. */
  note: string | null
}

/** Response body of `GET /admin/payment-anomalies` (unresolved only, newest first). */
export interface PaymentAnomaliesResponse {
  anomalies: PaymentAnomalyView[]
}
