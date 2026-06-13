/**
 * Platform-admin partner revenue report (#462). Aggregates successful
 * `payment_events` per partner operator into the figures the platform needs for
 * the monthly remittance: gross collected, the 4% platform fee retained, and the
 * net payable to the partner — bucketed by JST calendar month (payouts are
 * reckoned on Asia/Tokyo month boundaries). Read-only for MVP.
 *
 * Every figure is a SUM of the values locked onto each `payment_events` row at
 * webhook time (`lib/commission.ts`), never recomputed — the row is the contract.
 */

/** One JST calendar month of a single partner's revenue. */
export interface AdminRevenueMonth {
  /** `YYYY-MM` in Asia/Tokyo. */
  month: string
  grossJpy: number
  platformFeeJpy: number
  netToPartnerJpy: number
  /** Number of successful payments in this month. */
  paymentCount: number
}

/** A partner operator's revenue: all-window subtotals plus a per-month breakdown. */
export interface AdminRevenuePartner {
  operatorId: string
  operatorName: string
  operatorSlug: string
  grossJpy: number
  platformFeeJpy: number
  netToPartnerJpy: number
  paymentCount: number
  /** Months with at least one payment, newest first. */
  months: AdminRevenueMonth[]
}

/** Grand totals across every partner and month. */
export interface AdminRevenueTotals {
  grossJpy: number
  platformFeeJpy: number
  netToPartnerJpy: number
  paymentCount: number
}

export interface AdminRevenueReport {
  /** Partners with at least one payment, biggest earner (gross) first. */
  partners: AdminRevenuePartner[]
  totals: AdminRevenueTotals
}
