// One-way custody network (spec rev.9): movement_legs is ONE row per physical
// traversal (§4) — the shared movement identity consumed by the §8 feasibility
// fold, the §11 custody-period boundaries, and the §6 receipt records.
// custody_periods is the accrual ledger [receivedAt, departedAt) — the time a
// host ACTUALLY holds the car. handoff_receipts is immutable evidence with a
// sealed minimal core (append-only, private photos — NOT the catalog pipeline).
import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { CUSTODY_SETTLEMENT_STATES, HANDOFF_PHASES, MOVEMENT_LEG_KINDS } from '../enums'
import { operators, users } from './auth'
import { bookings } from './booking'
import { vehicles } from './fleet'
import { locations } from './location'

export const movementLegKindEnum = pgEnum('movement_leg_kind', MOVEMENT_LEG_KINDS)
export const handoffPhaseEnum = pgEnum('handoff_phase', HANDOFF_PHASES)
export const custodySettlementStateEnum = pgEnum(
  'custody_settlement_state',
  CUSTODY_SETTLEMENT_STATES,
)

export const movementLegs = pgTable(
  'movement_legs',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    vehicleId: text('vehicleId')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'restrict' }),
    kind: movementLegKindEnum('kind').notNull(),
    // Set for RENTAL, null for STAFF_REPOSITION/TRANSFER (§4).
    bookingId: text('bookingId').references(() => bookings.id, { onDelete: 'restrict' }),
    fromOperatorId: text('fromOperatorId').notNull(),
    fromLocationId: text('fromLocationId').notNull(),
    // May be RE-SET on receipt only for a recovery leg (§5) — the only mutable
    // pair on the row, updated in the same tx BEFORE the endpoint trigger fires.
    toOperatorId: text('toOperatorId').notNull(),
    toLocationId: text('toLocationId').notNull(),
    plannedStartAt: timestamp('plannedStartAt', { withTimezone: true, mode: 'date' }).notNull(),
    plannedEndAt: timestamp('plannedEndAt', { withTimezone: true, mode: 'date' }).notNull(),
    // The planned→actual flips: each set EXACTLY ONCE, never cleared.
    departedAt: timestamp('departedAt', { withTimezone: true, mode: 'date' }),
    receivedAt: timestamp('receivedAt', { withTimezone: true, mode: 'date' }),
    // Pre-departure cancellation/substitution voids the planned leg (§5); a
    // departed leg can never be voided — it becomes the recovery leg instead.
    voidedAt: timestamp('voidedAt', { withTimezone: true, mode: 'date' }),
    // §6/Q5: the receipt checklist copied from the owner's config at DEPARTURE.
    // NULL (undeparted or dark-era/synthesized) = minimal core only.
    checklistSnapshot: text('checklistSnapshot').array(),
    idempotencyKey: text('idempotencyKey').notNull(),
    // §6: binds the idempotency key to the payload it was first used for.
    requestFingerprint: text('requestFingerprint').notNull(),
    createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_movement_legs_vehicleId').on(table.vehicleId),
    index('idx_movement_legs_bookingId').on(table.bookingId),
    index('idx_movement_legs_fromOperatorId').on(table.fromOperatorId),
    index('idx_movement_legs_toOperatorId').on(table.toOperatorId),
    // FK-covering indexes for the SECOND column of each composite location FK —
    // lint:fk-indexes requires every FK column to lead some index.
    index('idx_movement_legs_fromLocationId').on(table.fromLocationId),
    index('idx_movement_legs_toLocationId').on(table.toLocationId),
    // The feasibility fold reads exactly this slice (live legs).
    index('idx_movement_legs_pending')
      .on(table.vehicleId)
      .where(sql`${table.receivedAt} IS NULL AND ${table.voidedAt} IS NULL`),
    uniqueIndex('movement_legs_idempotencyKey_unique').on(table.idempotencyKey),
    // §4 rev.7: uniqueness follows TRAVERSAL identity — one live leg per
    // (booking, car). An ACTIVE substitution leaves two live legs on one
    // booking (old car's detached recovery + new car's current); the booking's
    // current leg is the one matching booking.assignedVehicleId (decision 17).
    uniqueIndex('movement_legs_booking_vehicle_unique')
      .on(table.bookingId, table.vehicleId)
      .where(sql`${table.bookingId} IS NOT NULL AND ${table.voidedAt} IS NULL`),
    foreignKey({
      columns: [table.fromOperatorId, table.fromLocationId],
      foreignColumns: [locations.operatorId, locations.id],
      name: 'movement_legs_from_location_fk',
    }),
    foreignKey({
      columns: [table.toOperatorId, table.toLocationId],
      foreignColumns: [locations.operatorId, locations.id],
      name: 'movement_legs_to_location_fk',
    }),
    // A rental leg always names its booking; a reposition/transfer never does.
    check(
      'movement_legs_kind_booking',
      sql`(${table.kind}::text = 'RENTAL') = (${table.bookingId} IS NOT NULL)`,
    ),
    // At most ONE in-flight leg per vehicle — the process invariant as a constraint.
    uniqueIndex('movement_legs_one_in_flight_per_vehicle')
      .on(table.vehicleId)
      .where(
        sql`${table.departedAt} IS NOT NULL AND ${table.receivedAt} IS NULL AND ${table.voidedAt} IS NULL`,
      ),
    // Receipts + vehicles.inFlightLegId pin their vehicle through this target.
    unique('movement_legs_id_vehicleId_unique').on(table.id, table.vehicleId),
    check('movement_legs_planned_window', sql`${table.plannedEndAt} > ${table.plannedStartAt}`),
    check(
      'movement_legs_received_after_departed',
      sql`${table.receivedAt} IS NULL OR (${table.departedAt} IS NOT NULL AND ${table.receivedAt} >= ${table.departedAt})`,
    ),
    check(
      'movement_legs_void_only_undeparted',
      sql`${table.voidedAt} IS NULL OR ${table.departedAt} IS NULL`,
    ),
  ],
)

export const custodyPeriods = pgTable(
  'custody_periods',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    vehicleId: text('vehicleId')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'restrict' }),
    ownerOperatorId: text('ownerOperatorId')
      .notNull()
      .references(() => operators.id, { onDelete: 'restrict' }),
    hostOperatorId: text('hostOperatorId').notNull(),
    hostLocationId: text('hostLocationId').notNull(),
    // [held): opens on the arrival receipt, closes the instant the car departs (§11).
    receivedAt: timestamp('receivedAt', { withTimezone: true, mode: 'date' }).notNull(),
    departedAt: timestamp('departedAt', { withTimezone: true, mode: 'date' }),
    // NULLABLE only for the §13 bootstrap baseline rows (no leg existed yet).
    openedByLegId: text('openedByLegId').references(() => movementLegs.id, {
      onDelete: 'restrict',
    }),
    closedByLegId: text('closedByLegId').references(() => movementLegs.id, {
      onDelete: 'restrict',
    }),
    // Snapshotted at receipt so a later fee-config change never retro-alters an
    // amount already owed (§11). Slice 1: always 0 (hostIsOwner).
    dailyRateJpySnapshot: integer('dailyRateJpySnapshot').notNull().default(0),
    handoffFeeJpySnapshot: integer('handoffFeeJpySnapshot').notNull().default(0),
    // Derived at close in Slice 2 (day-count/rounding are open inputs, §16.7).
    accruedJpy: integer('accruedJpy'),
    settlementState: custodySettlementStateEnum('settlementState').notNull().default('ACCRUING'),
    settlementRef: text('settlementRef'),
    settledAt: timestamp('settledAt', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_custody_periods_vehicleId').on(table.vehicleId),
    index('idx_custody_periods_ownerOperatorId').on(table.ownerOperatorId),
    index('idx_custody_periods_hostOperatorId').on(table.hostOperatorId),
    // FK-covering index for the second column of the host-location composite FK.
    index('idx_custody_periods_hostLocationId').on(table.hostLocationId),
    index('idx_custody_periods_openedByLegId').on(table.openedByLegId),
    index('idx_custody_periods_closedByLegId').on(table.closedByLegId),
    // §11: one open period per vehicle is a DB seal, not prose.
    uniqueIndex('custody_periods_one_open_per_vehicle')
      .on(table.vehicleId)
      .where(sql`${table.departedAt} IS NULL`),
    // §3: the composite-FK target that ties vehicles.openCustodyPeriodId to a
    // period matching the car's CURRENT host + location.
    unique('custody_periods_state_target_unique').on(
      table.id,
      table.vehicleId,
      table.hostOperatorId,
      table.hostLocationId,
    ),
    foreignKey({
      columns: [table.hostOperatorId, table.hostLocationId],
      foreignColumns: [locations.operatorId, locations.id],
      name: 'custody_periods_host_location_fk',
    }),
    // §11 rev.9 provenance seals: the recorded owner IS the car's owner
    // (target: vehicles_operatorId_id_unique), and the legs bounding a period
    // belong to that same car (target: movement_legs_id_vehicleId_unique).
    // NULL leg refs (baseline / administrative close) pass via MATCH SIMPLE.
    foreignKey({
      columns: [table.ownerOperatorId, table.vehicleId],
      foreignColumns: [vehicles.operatorId, vehicles.id],
      name: 'custody_periods_owner_vehicle_fk',
    }),
    foreignKey({
      columns: [table.openedByLegId, table.vehicleId],
      foreignColumns: [movementLegs.id, movementLegs.vehicleId],
      name: 'custody_periods_opened_leg_vehicle_fk',
    }),
    foreignKey({
      columns: [table.closedByLegId, table.vehicleId],
      foreignColumns: [movementLegs.id, movementLegs.vehicleId],
      name: 'custody_periods_closed_leg_vehicle_fk',
    }),
    check(
      'custody_periods_close_after_open',
      sql`${table.departedAt} IS NULL OR ${table.departedAt} >= ${table.receivedAt}`,
    ),
    check('custody_periods_rate_non_negative', sql`${table.dailyRateJpySnapshot} >= 0`),
    check('custody_periods_handoff_fee_non_negative', sql`${table.handoffFeeJpySnapshot} >= 0`),
  ],
)

export const handoffReceipts = pgTable(
  'handoff_receipts',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    legId: text('legId')
      .notNull()
      .references(() => movementLegs.id, { onDelete: 'restrict' }),
    phase: handoffPhaseEnum('phase').notNull(),
    vehicleId: text('vehicleId')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'restrict' }),
    actorUserId: text('actorUserId')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    actorOperatorId: text('actorOperatorId')
      .notNull()
      .references(() => operators.id, { onDelete: 'restrict' }),
    atOperatorId: text('atOperatorId').notNull(),
    atLocationId: text('atLocationId').notNull(),
    capturedAt: timestamp('capturedAt', { withTimezone: true, mode: 'date' }).notNull(),
    // §6/Q5: everything below the minimal core is checklist-driven and NULLABLE.
    // The service enforces the leg's checklistSnapshot; the DB seals structure.
    fuelPercent: integer('fuelPercent'),
    odometerKm: integer('odometerKm'),
    damageReported: boolean('damageReported').notNull().default(false),
    conditionNotes: text('conditionNotes'),
    // PRIVATE R2 keys (HANDOFF_RECEIPTS bucket) — never public catalog URLs.
    // May be empty when the checklist does not require photos (Q5 — no CHECK).
    photoStorageKeys: text('photoStorageKeys').array().notNull().default([]),
    // A correction is a NEW row pointing at the row it replaces (§6) — never
    // an update. The current view is the head of the supersession chain.
    supersedesReceiptId: text('supersedesReceiptId'),
    idempotencyKey: text('idempotencyKey').notNull(),
    requestFingerprint: text('requestFingerprint').notNull(),
    createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_handoff_receipts_legId').on(table.legId),
    index('idx_handoff_receipts_vehicleId').on(table.vehicleId),
    index('idx_handoff_receipts_actorUserId').on(table.actorUserId),
    index('idx_handoff_receipts_actorOperatorId').on(table.actorOperatorId),
    index('idx_handoff_receipts_atOperatorId').on(table.atOperatorId),
    index('idx_handoff_receipts_supersedesReceiptId').on(table.supersedesReceiptId),
    // FK-covering indexes for the trailing columns of the composite FKs —
    // atLocationId (at-location FK) and phase (correction same-end self-FK).
    index('idx_handoff_receipts_atLocationId').on(table.atLocationId),
    index('idx_handoff_receipts_phase').on(table.phase),
    uniqueIndex('handoff_receipts_idempotencyKey_unique').on(table.idempotencyKey),
    uniqueIndex('handoff_receipts_canonical_unique')
      .on(table.legId, table.phase)
      .where(sql`${table.supersedesReceiptId} IS NULL`),
    uniqueIndex('handoff_receipts_supersedes_unique')
      .on(table.supersedesReceiptId)
      .where(sql`${table.supersedesReceiptId} IS NOT NULL`),
    unique('handoff_receipts_id_legId_phase_unique').on(table.id, table.legId, table.phase),
    // rev.9: a receipt can never supersede itself (the same-row FK would pass).
    check(
      'handoff_receipts_no_self_supersede',
      sql`${table.supersedesReceiptId} IS NULL OR ${table.supersedesReceiptId} <> ${table.id}`,
    ),
    // A correction can never re-point to a different leg or end.
    foreignKey({
      columns: [table.supersedesReceiptId, table.legId, table.phase],
      foreignColumns: [table.id, table.legId, table.phase],
      name: 'handoff_receipts_correction_same_end_fk',
    }),
    // Evidence can never cite a different car than its traversal.
    foreignKey({
      columns: [table.legId, table.vehicleId],
      foreignColumns: [movementLegs.id, movementLegs.vehicleId],
      name: 'handoff_receipts_leg_vehicle_fk',
    }),
    // §6: the receipt's location is real and correctly attributed.
    foreignKey({
      columns: [table.atOperatorId, table.atLocationId],
      foreignColumns: [locations.operatorId, locations.id],
      name: 'handoff_receipts_at_location_fk',
    }),
    check(
      'handoff_receipts_fuel_range',
      sql`${table.fuelPercent} IS NULL OR (${table.fuelPercent} BETWEEN 0 AND 100)`,
    ),
    check(
      'handoff_receipts_odometer_non_negative',
      sql`${table.odometerKm} IS NULL OR ${table.odometerKm} >= 0`,
    ),
  ],
)
