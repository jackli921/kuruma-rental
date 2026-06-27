import { sql } from 'drizzle-orm'
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import {
  BOOKING_EVENT_TYPES,
  BOOKING_FULFILLMENT_MODES,
  BOOKING_SOURCES,
  BOOKING_STATUSES,
} from '../enums'
import type { BookingStatus, CancellationFeeSettlement } from '../enums'
import { operators, users } from './auth'
// Booking snapshot/event payload types live in ./booking-types (file-size split,
// #460); imported here for the jsonb $type<> column annotations below.
import type {
  AddOnSnapshot,
  BookingEventPayload,
  FeeSnapshotItem,
  InsuranceSnapshot,
} from './booking-types'
import { vehicleClasses, vehicles } from './fleet'
import { locations } from './location'
import { insuranceOptions } from './pricing'

export const bookingStatusEnum = pgEnum('booking_status', BOOKING_STATUSES)
export const bookingSourceEnum = pgEnum('booking_source', BOOKING_SOURCES)
// #463 (§5 "design-for-later"): how a booking is fulfilled. SPECIFIC = a concrete
// requested/assigned vehicle (the only mode exercised pre-demo). CLASS_COMBO = book a
// class, operator assigns a car later — the post-demo fast-follow (#464), which also
// needs its own schema work (no assigned vehicle at booking time). Landing the
// discriminator now keeps #464 from retrofitting a flag onto a table full of demo rows.
export const bookingFulfillmentModeEnum = pgEnum(
  'booking_fulfillment_mode',
  BOOKING_FULFILLMENT_MODES,
)
// Append-only booking lifecycle events (epic #385, slice 6 / #392). bookings.status
// is the write-through projection of the latest lifecycle event. BOOKING_CREATED +
// VEHICLE_SUBSTITUTED are new this slice; CANCELLED/STATUS_CHANGED make the existing
// transitions also append an event so the log is complete. See proposal §2.
export const bookingEventTypeEnum = pgEnum('booking_event_type', BOOKING_EVENT_TYPES)

export const bookings = pgTable(
  'bookings',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // Tenant owner (#392). Server-derived from the assigned vehicle's operator —
    // NEVER client-supplied (proposal §6.2). NOT NULL: the bookings table is
    // reseeded at the marketplace cutover, no nullable tenancy debt (#386 P1b).
    operatorId: text('operatorId')
      .notNull()
      .references(() => operators.id, { onDelete: 'restrict' }),
    renterId: text('renterId')
      .notNull()
      .references(() => users.id),
    // classId stays for discovery/grouping; the composite FK below seals it to
    // the booking's own operator (#392, mirrors vehicles_operatorId_classId_fk).
    classId: text('classId').notNull(),
    // What the renter selected in storefront (slice 5). Immutable audit trail —
    // substitution NEVER mutates this (proposal §2 "Vehicle substitution").
    // #464: nullable — a CLASS_COMBO float has no requested car. The
    // bookings_specific_requires_requested CHECK keeps SPECIFIC rows honest.
    requestedVehicleId: text('requestedVehicleId'),
    // What the operator fulfills; the exclusion constraint keys on THIS column.
    // Server-derived = requestedVehicleId at submit; operator may substitute.
    // #464: nullable — an unassigned CLASS_COMBO float has no car yet; the
    // operator assigns one on/before pickup (the exclusion constraint skips NULLs).
    assignedVehicleId: text('assignedVehicleId'),
    pickupLocationId: text('pickupLocationId')
      .notNull()
      .references(() => locations.id),
    dropoffLocationId: text('dropoffLocationId')
      .notNull()
      .references(() => locations.id),
    startAt: timestamp('startAt', { withTimezone: true, mode: 'date' }).notNull(),
    endAt: timestamp('endAt', { withTimezone: true, mode: 'date' }).notNull(),
    effectiveEndAt: timestamp('effectiveEndAt', { withTimezone: true, mode: 'date' }).notNull(),
    status: bookingStatusEnum('status').notNull().default('CONFIRMED'),
    source: bookingSourceEnum('source').notNull().default('DIRECT'),
    // #463: fulfillment discriminator. Server-derived = SPECIFIC for every pre-demo
    // booking; CLASS_COMBO is #464. The DB DEFAULT is a defensive seal for raw SQL /
    // migrations only — app code always writes the mode explicitly (Option B).
    fulfillmentMode: bookingFulfillmentModeEnum('fulfillmentMode').notNull().default('SPECIFIC'),
    // Human-facing reservation code (proposal §10 item 3). 8-char no-confusables
    // base32, generated server-side; UNIQUE so a rare collision retries (§5.4).
    bookingCode: text('bookingCode').notNull().unique(),
    // Selected renter insurance option + its snapshot, locked at booking time.
    // Null when the renter declines or the operator has no active option.
    insuranceOptionId: text('insuranceOptionId'),
    insuranceSnapshot: jsonb('insuranceSnapshot').$type<InsuranceSnapshot>(),
    // Applicable fee_schedules rows snapshotted at booking time (informational in
    // MVP; locks rate-at-time-of-booking, proposal §9 item 19). Never null.
    feeSnapshot: jsonb('feeSnapshot').$type<FeeSnapshotItem[]>().notNull().default([]),
    // Paid add-ons selected at booking time (#460). Each flat priceJpy is locked
    // into totalPrice; the snapshot preserves name+price at booking. Never null.
    addOnSnapshot: jsonb('addOnSnapshot').$type<AddOnSnapshot[]>().notNull().default([]),
    externalId: text('externalId'),
    notes: text('notes'),
    totalPrice: integer('totalPrice'), // whole JPY; non-null on every slice-6 submit (#429)
    cancellationFee: integer('cancellationFee'), // whole JPY, set on cancellation
    // #868 Slice 3a: settlement status of the cancellation fee. Meaningful once a
    // fee is recorded (status CANCELLED); the NOT NULL default 'ADVISORY' backfills
    // every existing row — incl. historical cancellations — so advisory fees read
    // unambiguously without a data migration. text (not pgEnum, review M4); the
    // ADVISORY -> CAPTURED|REFUND_DUE|REFUNDED|WAIVED state machine is #851.
    cancellationFeeSettlement: text('cancellationFeeSettlement')
      .$type<CancellationFeeSettlement>()
      .notNull()
      .default('ADVISORY'),
    cancelledAt: timestamp('cancelledAt', { withTimezone: true, mode: 'date' }),
    idempotencyKey: text('idempotencyKey'),
    // #613: renter liability-disclaimer (免责声明) consent recorded at booking time.
    // Server-stamped when a renter accepts the terms at checkout (the IDP/license
    // must be valid at pickup or the non-refundable order fails) — this replaces the
    // dropped online document upload. Nullable: staff/manual/Trip.com + historical
    // rows carry no renter consent. Version tracks the wording the renter agreed to.
    disclaimerAcknowledgedAt: timestamp('disclaimerAcknowledgedAt', {
      withTimezone: true,
      mode: 'date',
    }),
    disclaimerTermsVersion: text('disclaimerTermsVersion'),
    createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Issue #330: booking-by-class queries filter on classId every request.
    index('idx_bookings_classId').on(table.classId),
    // FK-index cover (#392) — every FK column must be a leading index column
    // (lint:fk-indexes). idx_bookings_operatorId also serves the operator
    // read-scope (findAll filters on operatorId).
    index('idx_bookings_operatorId').on(table.operatorId),
    index('idx_bookings_requestedVehicleId').on(table.requestedVehicleId),
    index('idx_bookings_assignedVehicleId').on(table.assignedVehicleId),
    index('idx_bookings_pickupLocationId').on(table.pickupLocationId),
    index('idx_bookings_dropoffLocationId').on(table.dropoffLocationId),
    index('idx_bookings_insuranceOptionId').on(table.insuranceOptionId),
    // Three hand-SQL indexes that have existed in prod for a while but were never
    // echoed here, so the drizzle snapshot didn't carry them — a future
    // `drizzle-kit pull` would silently drop them (the M7 risk class the
    // snapshot/index parity lint catches). Codified per #1173 / #1150:
    // - 0010_add-fk-indexes.sql created idx_bookings_renterId
    // - 0014_add-bookings-status-index.sql created idx_bookings_status
    // - 0012_idempotency-unique-index.sql created bookings_idempotency_key
    //   (partial unique on the non-null subset — idempotency keys are optional)
    index('idx_bookings_renterId').on(table.renterId),
    index('idx_bookings_status').on(table.status),
    uniqueIndex('bookings_idempotency_key')
      .on(table.idempotencyKey)
      .where(sql`"idempotencyKey" is not null`),
    // Class must belong to the booking's operator (#392). Composite seal.
    foreignKey({
      columns: [table.operatorId, table.classId],
      foreignColumns: [vehicleClasses.operatorId, vehicleClasses.id],
      name: 'bookings_operator_class_fk',
    }),
    // Requested + assigned vehicles must belong to the booking's operator
    // (proposal §5.5). Makes "operator only assigns its own cars" a DB invariant.
    foreignKey({
      columns: [table.operatorId, table.requestedVehicleId],
      foreignColumns: [vehicles.operatorId, vehicles.id],
      name: 'bookings_operator_requested_vehicle_fk',
    }),
    foreignKey({
      columns: [table.operatorId, table.assignedVehicleId],
      foreignColumns: [vehicles.operatorId, vehicles.id],
      name: 'bookings_operator_assigned_vehicle_fk',
    }),
    // Selected insurance option must belong to the booking's operator (nullable
    // + MATCH SIMPLE: unconstrained when the renter declines coverage).
    foreignKey({
      columns: [table.operatorId, table.insuranceOptionId],
      foreignColumns: [insuranceOptions.operatorId, insuranceOptions.id],
      name: 'bookings_operator_insurance_fk',
    }),
    // #463/#464: a SPECIFIC booking MUST name both the vehicle it requested and the
    // one it fulfills. Now that #464 makes both columns nullable for CLASS_COMBO
    // floats, these CHECKs (not column NOT NULL) are what keep every SPECIFIC row
    // honest instead of letting the invariant silently evaporate one migration away.
    check(
      'bookings_specific_requires_assigned',
      sql`${table.fulfillmentMode} <> 'SPECIFIC' OR ${table.assignedVehicleId} IS NOT NULL`,
    ),
    check(
      'bookings_specific_requires_requested',
      sql`${table.fulfillmentMode} <> 'SPECIFIC' OR ${table.requestedVehicleId} IS NOT NULL`,
    ),
  ],
)

// Append-only booking lifecycle log (proposal §5.2 / #392). The events are the
// source of truth; bookings.status is the write-through projection of the latest
// lifecycle event. No update/delete repo methods exist — append-only by contract.
export const bookingEvents = pgTable(
  'booking_events',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    bookingId: text('bookingId')
      .notNull()
      .references(() => bookings.id),
    type: bookingEventTypeEnum('type').notNull(),
    payload: jsonb('payload').$type<BookingEventPayload>().notNull(),
    // Renter for CREATED; operator user for SUBSTITUTED/CANCELLED; null = system.
    actorId: text('actorId').references(() => users.id),
    createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Ordered replay per booking. bookingId leads so it also covers the FK index.
    index('idx_booking_events_bookingId').on(table.bookingId, table.createdAt),
    index('idx_booking_events_actorId').on(table.actorId),
  ],
)

export const VALID_BOOKING_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  CONFIRMED: ['ACTIVE', 'CANCELLED'],
  ACTIVE: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
}

export type {
  BookingEventType,
  BookingFulfillmentMode,
  BookingSource,
  BookingStatus,
} from '../enums'
