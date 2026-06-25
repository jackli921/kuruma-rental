import { sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { PAYMENT_EVENT_STATUSES, PAYMENT_REFUND_STATUSES } from '../enums'
import { operators } from './auth'
import { bookings } from './booking'

// In-app Stripe payment of the rental total (epic #385, slice payment / #461; 2026-06-05 scope addendum §2). The signed checkout.session.completed webhook is the SOURCE OF TRUTH — a row exists only after a verified, paid session.
// MVP records only the success event; REFUNDED/DISPUTED are post-MVP (YAGNI).
export const paymentEventStatusEnum = pgEnum('payment_event_status', PAYMENT_EVENT_STATUSES)
export const paymentEvents = pgTable(
  'payment_events',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // Partner attribution for the #462 revenue tab. RE-DERIVED server-side from the booking on the webhook — never trusted from Stripe metadata (#461).
    operatorId: text('operatorId')
      .notNull()
      .references(() => operators.id, { onDelete: 'restrict' }),
    bookingId: text('bookingId')
      .notNull()
      .references(() => bookings.id),
    // Stripe ids: stripeEventId = redelivery idempotency fence; stripeCheckoutSessionId pins the row to one Session; paymentIntent nullable until it settles.
    stripeEventId: text('stripeEventId').notNull(),
    stripeCheckoutSessionId: text('stripeCheckoutSessionId').notNull(),
    stripePaymentIntentId: text('stripePaymentIntentId'),
    // Whole JPY (zero-decimal). grossJpy = Stripe amount_total (trusted, not client); platformFee = 4% of gross; net = gross - fee (commission.ts).
    grossJpy: integer('grossJpy').notNull(),
    platformFeeJpy: integer('platformFeeJpy').notNull(),
    netToPartnerJpy: integer('netToPartnerJpy').notNull(),
    currency: text('currency').notNull().default('jpy'),
    status: paymentEventStatusEnum('status').notNull(),
    createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // FK cover (lint:fk-indexes) + #462 revenue aggregation by partner.
    index('idx_payment_events_operatorId').on(table.operatorId),
    index('idx_payment_events_bookingId').on(table.bookingId), // FK cover + "is this booking paid?" lookup
    // Stripe redelivery dedupe: the same event id can never insert twice (#461 P1).
    uniqueIndex('payment_events_stripeEventId_unique').on(table.stripeEventId),
    // Defence in depth: one Checkout Session records at most one row.
    uniqueIndex('payment_events_stripeCheckoutSessionId_unique').on(table.stripeCheckoutSessionId),
    // The BUSINESS-FACT seal: at most ONE successful payment per booking, even across two valid Sessions both completing — vendor dedupe (above) stops duplicate MESSAGES, this stops a duplicate FACT (#461 P1).
    // Partial so a future REFUNDED row never collides with the SUCCEEDED one.
    uniqueIndex('payment_events_one_success_per_booking')
      .on(table.bookingId)
      .where(sql`status = 'SUCCEEDED'`),
  ],
)

// The durable receipt for an automated cancellation refund (#851). One row per
// booking (UNIQUE) — the "work already started" half of the REFUND_DUE outbox and
// the create-dedup ledger: it carries re_… so a re-drive RETRIEVES instead of
// re-creating, surviving Stripe's ~24h idempotency-key pruning. FORWARD-ONLY status.
export const paymentRefundStatusEnum = pgEnum('payment_refund_status', PAYMENT_REFUND_STATUSES)
export const paymentRefunds = pgTable(
  'payment_refunds',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    bookingId: text('bookingId')
      .notNull()
      .references(() => bookings.id),
    // Partner attribution for the operator refund surface — re-derived from the
    // booking, never trusted from Stripe metadata (mirrors payment_events).
    operatorId: text('operatorId')
      .notNull()
      .references(() => operators.id, { onDelete: 'restrict' }),
    // The captured payment's PaymentIntent — what we refund against.
    stripePaymentIntentId: text('stripePaymentIntentId').notNull(),
    // Stripe refund id (re_…); null until create/adopt attaches it.
    stripeRefundId: text('stripeRefundId'),
    // Whole JPY (zero-decimal): renter = policy refundAmount, operator = full total.
    amountJpy: integer('amountJpy').notNull(),
    status: paymentRefundStatusEnum('status').notNull().default('PENDING'),
    createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // FK cover (lint:fk-indexes) for the operator reference.
    index('idx_payment_refunds_operatorId').on(table.operatorId),
    // BUSINESS-FACT seal: at most one refund per booking (the create-dedup ledger).
    // Also covers the bookingId FK and the findByBookingId lookup.
    uniqueIndex('payment_refunds_bookingId_unique').on(table.bookingId),
    // One Stripe refund (re_…) binds to at most one booking — an adoption bug can't
    // attach the same re_ to two rows. Partial so the null-until-created rows don't collide.
    uniqueIndex('payment_refunds_stripeRefundId_unique')
      .on(table.stripeRefundId)
      .where(sql`"stripeRefundId" is not null`),
    // Ledger invariant (#1068): a refund amount is never negative. The service
    // guards it, but every money column in this schema seals it at the DB too
    // (mirrors fee_schedules_amount_non_negative). 0 is valid (full-fee, no refund).
    check('payment_refunds_amount_non_negative', sql`${table.amountJpy} >= 0`),
  ],
)

// Payment anomalies needing operator/admin review (#508 P2). A verified webhook can
// report a charge that does NOT become a clean payment_events row: a second distinct
// Session paying an already-paid booking (DOUBLE_PAYMENT — refund the duplicate) or a
// session whose amount/currency != the booking snapshot (AMOUNT_MISMATCH — investigate).
// Persisted (not just logged, #461 P1b) so the admin surface can list duplicates to
// refund rather than scrape logs. Kept OUT of payment_events so revenue math (which sums
// SUCCEEDED rows) is never polluted by a flagged-for-review charge.
export const paymentAnomalyKindEnum = pgEnum('payment_anomaly_kind', [
  'DOUBLE_PAYMENT',
  'AMOUNT_MISMATCH',
])
export const paymentAnomalies = pgTable(
  'payment_anomalies',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // Partner attribution, RE-DERIVED from the booking on the webhook — never the Stripe metadata (mirrors payment_events).
    operatorId: text('operatorId')
      .notNull()
      .references(() => operators.id, { onDelete: 'restrict' }),
    bookingId: text('bookingId')
      .notNull()
      .references(() => bookings.id),
    kind: paymentAnomalyKindEnum('kind').notNull(),
    // Stripe ids carried so an operator can reconcile/refund. stripeEventId is the redelivery fence.
    stripeEventId: text('stripeEventId').notNull(),
    stripeCheckoutSessionId: text('stripeCheckoutSessionId').notNull(),
    stripePaymentIntentId: text('stripePaymentIntentId'),
    // Whole JPY. received = Stripe amount_total (nullable — Stripe may omit it on a malformed event); expected = the booking total snapshot at webhook time.
    receivedAmountJpy: integer('receivedAmountJpy'),
    expectedAmountJpy: integer('expectedAmountJpy'),
    currency: text('currency'),
    // Set once an operator actions it (refunded / dismissed). NULL = still needs review.
    resolvedAt: timestamp('resolvedAt', { withTimezone: true }),
    createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // FK cover (lint:fk-indexes) + admin listing by partner.
    index('idx_payment_anomalies_operatorId').on(table.operatorId),
    index('idx_payment_anomalies_bookingId').on(table.bookingId),
    // Redelivery fence: the same webhook event records at most one anomaly (idempotent record()).
    uniqueIndex('payment_anomalies_stripeEventId_unique').on(table.stripeEventId),
  ],
)

export type { PaymentEventStatus } from '../enums'
