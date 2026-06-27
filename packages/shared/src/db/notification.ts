import { index, integer, pgEnum, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core'
import { operators } from './auth'
import { bookings } from './booking'

// Slice 7 (#393) outbound notifications.
export const notificationKindEnum = pgEnum('notification_kind', [
  'OPERATOR_BOOKING_ALERT', // -> operator: a booking landed
  'RENTER_BOOKING_CONFIRM', // -> renter: confirmation + pre-auth link
  // #664 renter lifecycle pushes — operator substitute / cancel / status advance.
  // Distinct kinds (not one generic) so the notify:<booking>:<kind> idempotency
  // key never collides across an ACTIVATED-then-COMPLETED sequence.
  'RENTER_SUBSTITUTION', // -> renter: assigned vehicle was swapped
  'RENTER_CANCELLATION', // -> renter: booking was cancelled
  'RENTER_TRIP_STARTED', // -> renter: status advanced to ACTIVE
  'RENTER_TRIP_COMPLETED', // -> renter: status advanced to COMPLETED
  // #1083: post-trip review prompt, fired on COMPLETED alongside the trip-completed
  // notice. Distinct kind so notify:<booking>:<kind> never collides between the two.
  'RENTER_REVIEW_PROMPT', // -> renter: rate the operator + vehicle after the trip
])
// SENDING is the in-flight lease between QUEUED and SENT/FAILED — it closes the
// concurrent-send race (atomic claim, architect P1). Reclaimable ONLY after the
// SEND_LEASE expires (see notification_log claim predicate); SENT is terminal.
// DEAD is the terminal poison-message sink (#483): a row that has FAILED
// MAX_NOTIFICATION_ATTEMPTS times. The claim predicate never re-arms it, so a
// hard-bounce recipient stops being re-sent on every replay/resend.
// NO_RECIPIENT is a terminal NON-failure state (#681): the dispatcher resolved no
// email for a renter (phone-only) or operator, so nothing was ever queued or sent.
// Persisted purely so the silent skip is countable for observability; the claim
// predicate never lists it, so it is never claimable.
export const notificationStatusEnum = pgEnum('notification_status', [
  'QUEUED',
  'SENDING',
  'SENT',
  'FAILED',
  'DEAD',
  'NO_RECIPIENT',
])

// Slice 7 (#393): durable outbound-email ledger. A row is inserted QUEUED; the
// dispatcher/resend path atomically claims it to SENDING (lease-bounded, §3 of the
// slice-7 plan) before the send, then marks SENT/FAILED. The atomic claim — not
// just the unique key — is what makes two concurrent sends invoke the provider once.
export const notificationLog = pgTable(
  'notification_log',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    bookingId: text('bookingId')
      .notNull()
      .references(() => bookings.id),
    // Tenant owner — every notification belongs to exactly one operator, so
    // operator-portal reads can scope by operatorId without a join (§6.2).
    operatorId: text('operatorId')
      .notNull()
      .references(() => operators.id, { onDelete: 'restrict' }),
    kind: notificationKindEnum('kind').notNull(),
    channel: text('channel').notNull().default('EMAIL'), // future: SMS/LINE without schema churn
    recipient: text('recipient').notNull(), // resolved address at claim time
    locale: text('locale').notNull(), // en | ja | zh chosen for this send
    status: notificationStatusEnum('status').notNull().default('QUEUED'),
    providerMessageId: text('providerMessageId'), // Resend id on success (audit / dedupe)
    error: text('error'), // last failure reason (truncated)
    attempts: integer('attempts').notNull().default(0),
    // Idempotency: one logical notification per (booking, kind). The dispatcher
    // upserts on this key so a post-commit replay never double-sends. Mirrors the
    // `booking:<id>` thread idempotency key in ensureThread (#335).
    idempotencyKey: text('idempotencyKey').notNull(),
    createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_notification_log_bookingId').on(t.bookingId),
    // operator-portal list scopes on operatorId (§6.2); also covers the operatorId FK.
    index('idx_notification_log_operatorId').on(t.operatorId),
    unique('notification_log_idempotency_unique').on(t.idempotencyKey),
  ],
)

// #710: derive the notification kind/status unions from their pgEnum single
// source so adding/renaming a value can only be done in one place. A
// hand-mirrored literal copy (previously on NotificationLog.kind in
// packages/api/src/stores.ts) compiled fine when it drifted, then threw a
// runtime 22P02 invalid_enum_value on the insert that passes `kind` straight to
// the enum column. Importing these into the api turns that into a build error.
export type NotificationKind = (typeof notificationKindEnum.enumValues)[number]
export type NotificationStatus = (typeof notificationStatusEnum.enumValues)[number]
