import { sql } from 'drizzle-orm'
import {
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
import { FEE_SCHEDULE_STATUSES, FEE_TYPES, FEE_UNITS, INSURANCE_STATUSES } from '../enums'
import { operators } from './auth'
import { vehicleClasses } from './fleet'

export const insuranceStatusEnum = pgEnum('insurance_status', INSURANCE_STATUSES)

// Operator-owned insurance options (epic #385, slice 4a / #404). Per-operator
// CRUD only — no vehicle_insurance_options join table in MVP. At booking
// (slice 6) the renter picks from the operator's full active list and the
// booking stores the selected option + price snapshot. Every row is
// tenant-scoped via operatorId. See proposal §3.
export const insuranceOptions = pgTable(
  'insurance_options',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // Tenant owner. NOT NULL — same fresh-branch reseed rationale as
    // locations.operatorId (#387); no nullable tenancy debt.
    operatorId: text('operatorId')
      .notNull()
      .references(() => operators.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    description: text('description'),
    dailyPriceJpy: integer('dailyPriceJpy').notNull(),
    // null = no deductible (full cover).
    deductibleJpy: integer('deductibleJpy'),
    status: insuranceStatusEnum('status').notNull().default('ACTIVE'),
    createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_insurance_options_operatorId').on(table.operatorId),
    // Composite-unique so a future composite FK can seal a referrer to the
    // option's own tenant (mirrors locations_operatorId_id_unique).
    unique('insurance_options_operatorId_id_unique').on(table.operatorId, table.id),
    // Name uniqueness scoped to ACTIVE rows so archiving an option frees its
    // name for reuse (review 2026-06-02). Two ACTIVE options can't share a
    // name; an archived one no longer reserves it. PARTIAL index.
    uniqueIndex('insurance_options_active_name_unique')
      .on(table.operatorId, table.name)
      .where(sql`status = 'ACTIVE'`),
    check('insurance_options_daily_price_non_negative', sql`${table.dailyPriceJpy} >= 0`),
    check(
      'insurance_options_deductible_non_negative',
      sql`${table.deductibleJpy} IS NULL OR ${table.deductibleJpy} >= 0`,
    ),
  ],
)

// Operator-owned fee schedules (epic #385, slice 4b / #405). Per-operator,
// optionally per vehicle class (null vehicleClassId = operator-wide). MVP fee
// types: overtime (hourly), cleaning (flat), no-fuel (flat). 4b stores the
// schedules only — booking snapshot + overtime compute land in slice 6 (#392).
export const feeTypeEnum = pgEnum('fee_type', FEE_TYPES)
export const feeUnitEnum = pgEnum('fee_unit', FEE_UNITS)
export const feeScheduleStatusEnum = pgEnum('fee_schedule_status', FEE_SCHEDULE_STATUSES)

export const feeSchedules = pgTable(
  'fee_schedules',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // Tenant owner. NOT NULL — same fresh-branch reseed rationale as
    // vehicleClasses.operatorId (#386 P1b); no nullable tenancy debt.
    operatorId: text('operatorId')
      .notNull()
      .references(() => operators.id, { onDelete: 'restrict' }),
    // null = operator-wide fee; non-null = scoped to one vehicle class. The
    // composite FK below seals a per-class fee's class to the SAME operator.
    vehicleClassId: text('vehicleClassId'),
    // feeType<->unit coherence (OVERTIME_HOURLY=>PER_HOUR, *_FLAT=>FLAT) is
    // enforced BOTH by the Zod schema / FeeScheduleService (the app writer) and,
    // since #723, by the DB CHECK `fee_schedules_feetype_unit_coherent` below —
    // the backstop against a direct SQL/seed write persisting an incoherent pair.
    // The rule mirrors REQUIRED_UNIT_BY_FEE_TYPE (shared/validators/fee-schedule.ts).
    feeType: feeTypeEnum('feeType').notNull(),
    unit: feeUnitEnum('unit').notNull(),
    amountJpy: integer('amountJpy').notNull(),
    status: feeScheduleStatusEnum('status').notNull().default('ACTIVE'),
    createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Composite index for the operator read-scope (leading column) AND the
    // composite FK source. (operatorId) is a prefix of this, so the operatorId
    // FK + the operator-wide read are both covered; no separate
    // idx_fee_schedules_operatorId is needed.
    index('idx_fee_schedules_operator_class').on(table.operatorId, table.vehicleClassId),
    // vehicleClassId needs its OWN leading index: it is only the TRAILING column
    // of the composite above, which lint:fk-indexes does not count as FK cover.
    // Without this, a JOIN from vehicle_classes -> fee_schedules by class alone
    // seq-scans (the composite FK references vehicle_classes.id via vehicleClassId).
    index('idx_fee_schedules_vehicle_class').on(table.vehicleClassId),
    // Composite FK seal (#395): a per-class fee's class must belong to the SAME
    // operator. MATCH SIMPLE — when vehicleClassId IS NULL the FK is not
    // enforced (operator-wide row).
    foreignKey({
      columns: [table.operatorId, table.vehicleClassId],
      foreignColumns: [vehicleClasses.operatorId, vehicleClasses.id],
      name: 'fee_schedules_operator_class_fk',
    }),
    check('fee_schedules_amount_non_negative', sql`${table.amountJpy} >= 0`),
    // #723: pair feeType to its required unit (mirrors REQUIRED_UNIT_BY_FEE_TYPE).
    // The DB backstop for the coherence the Zod layer enforces app-side.
    check(
      'fee_schedules_feetype_unit_coherent',
      sql`(${table.feeType} = 'OVERTIME_HOURLY' AND ${table.unit} = 'PER_HOUR') OR (${table.feeType} = 'CLEANING_FLAT' AND ${table.unit} = 'FLAT') OR (${table.feeType} = 'NO_FUEL_FLAT' AND ${table.unit} = 'FLAT')`,
    ),
    // Uniqueness: ONE active fee per (operator, type, scope). Two partial
    // indexes because NULL != NULL in a plain UNIQUE — operator-wide rows would
    // otherwise never dedupe. Scoped to status='ACTIVE' so archiving frees the
    // slot for a re-created fee.
    uniqueIndex('fee_schedules_active_class_unique')
      .on(table.operatorId, table.feeType, table.vehicleClassId)
      .where(sql`status = 'ACTIVE' AND "vehicleClassId" IS NOT NULL`),
    uniqueIndex('fee_schedules_active_operatorwide_unique')
      .on(table.operatorId, table.feeType)
      .where(sql`status = 'ACTIVE' AND "vehicleClassId" IS NULL`),
  ],
)

export type { FeeScheduleStatus, FeeType, FeeUnit, InsuranceStatus } from '../enums'
