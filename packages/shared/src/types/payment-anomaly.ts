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

/** The `payment_anomaly_kind` DB enum, mirrored for the web boundary. Order must
 *  match the schema enum — pinned by `tests/types/payment-anomaly.test.ts`. */
export const PAYMENT_ANOMALY_KINDS = ['DOUBLE_PAYMENT', 'AMOUNT_MISMATCH'] as const

export type PaymentAnomalyKind = (typeof PAYMENT_ANOMALY_KINDS)[number]

/** The `payment_anomaly_resolution` DB enum, mirrored for the web boundary (#1075
 *  slice 3). An admin clears the review queue by tagging WHY a flagged charge is
 *  closed — it carries no money: `BENIGN` (not actually a problem), `INVESTIGATED`
 *  (looked into, no action), `REFUNDED_EXTERNALLY` (refunded in the Stripe
 *  dashboard, since in-app refund is deferred to a future slice). Order must match
 *  the schema enum — pinned by `tests/types/payment-anomaly.test.ts`. */
export const PAYMENT_ANOMALY_RESOLUTIONS = [
  'BENIGN',
  'INVESTIGATED',
  'REFUNDED_EXTERNALLY',
] as const

export type PaymentAnomalyResolution = (typeof PAYMENT_ANOMALY_RESOLUTIONS)[number]

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
