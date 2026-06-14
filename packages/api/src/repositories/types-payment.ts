import type { PaymentAnomaly, PaymentEvent } from '../stores'

/** A verified successful payment to persist. id + createdAt are assigned by the
 *  store (DB defaults / in-memory), so the service never invents them (#461). */
export type NewPaymentEvent = Omit<PaymentEvent, 'id' | 'createdAt'>

/** payment_events data access (#461). The webhook is the only writer. */
export interface PaymentEventRepository {
  // Persist a verified successful payment. Throws a PG-shaped UNIQUE_VIOLATION
  // (with `constraint_name`) when any of the three seals is hit, so the
  // PaymentService can tell a redelivered webhook (idempotent no-op) apart from
  // a second Session paying the same booking (double-pay anomaly). See pg-errors.
  insert(event: NewPaymentEvent): Promise<PaymentEvent>
  // The recorded SUCCEEDED payment for a booking, or null. Powers both the
  // already-paid guard at checkout and the derived "is this booking paid?" read.
  findSucceededByBookingId(bookingId: string): Promise<PaymentEvent | null>
  // SUCCEEDED payments across all operators, for the platform-admin revenue
  // report (#462). Unscoped by design — authz lives in AdminRevenueService.
  // `month` (`YYYY-MM`, JST) bounds the scan to one payout month so the Worker
  // never materializes the whole monotonically growing table (#717); omit it for
  // the full set.
  listSucceeded(month?: string): Promise<PaymentEvent[]>
  // The distinct JST (`Asia/Tokyo`) payout months that have >=1 SUCCEEDED
  // payment, newest first. Powers the month picker without materializing every
  // row (#717).
  listSucceededMonths(): Promise<string[]>
}

/** A payment anomaly to persist. id/createdAt/resolvedAt are store-assigned (#508 P2). */
export type NewPaymentAnomaly = Omit<PaymentAnomaly, 'id' | 'createdAt' | 'resolvedAt'>

/** payment_anomalies data access (#508 P2). The webhook is the only writer. */
export interface PaymentAnomalyRepository {
  // Persist an anomaly for operator review. IDEMPOTENT on stripeEventId: a
  // redelivered webhook (which re-derives the same anomaly) must not stack rows.
  record(anomaly: NewPaymentAnomaly): Promise<void>
  // Unresolved anomalies across all operators for the platform-admin surface.
  // Unscoped by design — authz lives in the service (mirrors listSucceeded).
  listUnresolved(): Promise<PaymentAnomaly[]>
}
