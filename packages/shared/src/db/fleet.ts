import { sql } from 'drizzle-orm'
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core'
import {
  TRANSMISSIONS,
  VEHICLE_BLOCK_KINDS,
  VEHICLE_CLASS_STATUSES,
  VEHICLE_STATUSES,
} from '../enums'
import { LUGGAGE_SIZES } from '../lib/luggage'
import { operators } from './auth'
import { locations } from './location'

export const transmissionEnum = pgEnum('transmission', TRANSMISSIONS)
// #457: standardized luggage-size taxonomy. Values declared once in lib/luggage.ts
// (shared by the Zod enum, the resolver, and this pgEnum).
export const luggageSizeEnum = pgEnum('luggage_size', LUGGAGE_SIZES)
export const vehicleClassStatusEnum = pgEnum('vehicle_class_status', VEHICLE_CLASS_STATUSES)
export const vehicleStatusEnum = pgEnum('vehicle_status', VEHICLE_STATUSES)
export const vehicleBlockKindEnum = pgEnum('vehicle_block_kind', VEHICLE_BLOCK_KINDS)

// Issue #247: vehicle classes — renter-facing catalog categories.
// Renters browse and book classes (e.g. "Compact"); owner manages
// individual cars tagged to a class. See design doc:
// docs/plans/2026-04-14-vehicle-class-abstraction.md
export const vehicleClasses = pgTable(
  'vehicle_classes',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // Tenant owner. NOT NULL — fresh branch wipe+reseed (proposal §5.1) assigns
    // Best Car Rental immediately, so no nullable debt. See #386 plan v2 P1b.
    operatorId: text('operatorId')
      .notNull()
      .references(() => operators.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    slug: text('slug').unique().notNull(),
    description: text('description'),
    photos: text('photos').array().notNull().default([]),
    seats: integer('seats').notNull(),
    luggageCapacity: integer('luggageCapacity').notNull(),
    // #457: class default size — NOT NULL so the per-vehicle override always has a
    // backstop to fall back to. Existing rows backfill to 'MEDIUM'.
    luggageSize: luggageSizeEnum('luggageSize').notNull().default('MEDIUM'),
    transmission: transmissionEnum('transmission').notNull(),
    fuelType: text('fuelType'),
    // #406: pricing moved to the vehicle level. Classes no longer carry rates;
    // a storefront's "from" price is min(member vehicle rate) (slice 5).
    // ACRISS taxonomy code (#388). Nullable — operator-created classes without
    // a mapped code are legitimate. No uniqueness: ACRISS is a category, so
    // multiple classes may share a code. The CHECK below mirrors ACRISS_PATTERN
    // (packages/shared/src/acriss.ts) — keep the two in sync.
    acrissCode: text('acrissCode'),
    sortOrder: integer('sortOrder').notNull().default(0),
    status: vehicleClassStatusEnum('status').notNull().default('ACTIVE'),
    createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Format-only ACRISS validation at the DB boundary (#388). Mirrors
    // ACRISS_PATTERN (= /^[A-Z9]{4}$/) and the Zod regex. A malformed code
    // rejects with 23514 even if a writer bypasses the validator. NULL is
    // allowed (column is nullable); positional validation is deferred post-MVP.
    check(
      'vehicle_classes_acriss_code_format',
      sql`${table.acrissCode} IS NULL OR ${table.acrissCode} ~ '^[A-Z9]{4}$'`,
    ),
    index('idx_vehicle_classes_operatorId').on(table.operatorId),
    // Composite-FK target (#395 Phase 2): lets vehicles reference a class by
    // (operatorId, id) so a vehicle can only point at a class in its own tenant.
    // id is already unique (PK); this names the (operatorId, id) key for the FK.
    unique('vehicle_classes_operatorId_id_unique').on(table.operatorId, table.id),
  ],
)

export const vehicles = pgTable(
  'vehicles',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // Tenant owner. NOT NULL — see vehicleClasses.operatorId rationale (#386 P1b).
    operatorId: text('operatorId')
      .notNull()
      .references(() => operators.id, { onDelete: 'restrict' }),
    // FK is composite (operatorId, classId) -> vehicle_classes(operatorId, id),
    // declared in the table extras below — NOT a single-column reference. This
    // seals a vehicle's class to its own operator at the DB (#395 Phase 2).
    classId: text('classId'),
    // Pickup/return location, sealed to the vehicle's own operator by the
    // composite FK below (#387 slice 2). Nullable + MATCH SIMPLE: a vehicle
    // with no assigned location is unconstrained. Operationally attached to
    // bookings in slice 6 — this slice adds the additive column + seal only.
    pickupLocationId: text('pickupLocationId'),
    name: text('name').notNull(),
    description: text('description'),
    photos: text('photos').array().notNull().default([]),
    seats: integer('seats').notNull(),
    // #457: per-vehicle luggage override (both nullable). null on either field means
    // "use the class default"; resolved per-field via resolveLuggage (lib/luggage.ts).
    luggageCapacity: integer('luggageCapacity'),
    luggageSize: luggageSizeEnum('luggageSize'),
    transmission: transmissionEnum('transmission').notNull(),
    fuelType: text('fuelType'),
    licensePlate: text('licensePlate').unique(),
    status: vehicleStatusEnum('status').notNull().default('AVAILABLE'),
    minRentalHours: integer('minRentalHours'),
    maxRentalHours: integer('maxRentalHours'),
    advanceBookingHours: integer('advanceBookingHours'),
    // Issue #228: vehicle detail fields for filtering.
    make: text('make'),
    model: text('model'),
    year: integer('year'),
    color: text('color'),
    // JPY, whole yen (no minor unit). At least one must be set — enforced
    // by the CHECK constraint below and mirrored in createVehicleSchema.
    // See issue #48.
    dailyRateJpy: integer('dailyRateJpy'),
    hourlyRateJpy: integer('hourlyRateJpy'),
    shakenExpiryDate: date('shakenExpiryDate', { mode: 'string' }),
    insuranceExpiryDate: date('insuranceExpiryDate', { mode: 'string' }),
    createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // A vehicle with no price is not rentable. Writers that violate this
    // will get a 23514 check_violation at the DB boundary — the validator
    // rejects the same payloads earlier with a friendlier error.
    check(
      'vehicles_pricing_at_least_one',
      sql`${table.dailyRateJpy} IS NOT NULL OR ${table.hourlyRateJpy} IS NOT NULL`,
    ),
    // Rates must be non-negative when set. Zero is allowed (free promo).
    check(
      'vehicles_daily_rate_non_negative',
      sql`${table.dailyRateJpy} IS NULL OR ${table.dailyRateJpy} >= 0`,
    ),
    check(
      'vehicles_hourly_rate_non_negative',
      sql`${table.hourlyRateJpy} IS NULL OR ${table.hourlyRateJpy} >= 0`,
    ),
    // Issue #330: renter catalog + booking-by-class filter on classId.
    // Every FK column needs its own index — pg doesn't auto-create one.
    index('idx_vehicles_classId').on(table.classId),
    index('idx_vehicles_operatorId').on(table.operatorId),
    index('idx_vehicles_pickupLocationId').on(table.pickupLocationId),
    // #736: partial index for the public availability scan (always filters
    // status='AVAILABLE'). Two independent wins: the partial PREDICATE shrinks the
    // index to rentable rows — helping every caller, including the bare whole-fleet
    // scan and operator/class-only filters — while the leading pickupLocationId KEY
    // adds an index seek only for the storefront (=) and region #651 (IN) location
    // paths. The booking-overlap NOT EXISTS is served separately by the bookings
    // GiST exclusion index. Coexists with idx_vehicles_pickupLocationId, which stays
    // for status-agnostic location lookups + FK-check support.
    index('idx_vehicles_available')
      .on(table.pickupLocationId)
      .where(sql`${table.status} = 'AVAILABLE'`),
    // A vehicle's class must belong to the vehicle's own operator (#395 Phase 2).
    // classId is nullable + MATCH SIMPLE, so an unassigned vehicle (classId NULL)
    // is unconstrained; when set, (operatorId, classId) must match a class row.
    foreignKey({
      columns: [table.operatorId, table.classId],
      foreignColumns: [vehicleClasses.operatorId, vehicleClasses.id],
      name: 'vehicles_operatorId_classId_fk',
    }),
    // A vehicle's pickup location must belong to the vehicle's own operator
    // (#387 slice 2). pickupLocationId is nullable + MATCH SIMPLE, mirroring
    // classId: unassigned is fine; when set, (operatorId, pickupLocationId)
    // must match a locations row. Target is locations_operatorId_id_unique.
    foreignKey({
      columns: [table.operatorId, table.pickupLocationId],
      foreignColumns: [locations.operatorId, locations.id],
      name: 'vehicles_operatorId_pickupLocationId_fk',
    }),
    // Composite-FK target (#392): lets bookings reference requested/assigned
    // vehicles by (operatorId, id) so an assigned car must belong to the
    // booking's operator. id is already PK-unique; this names the (operatorId,
    // id) key. Mirrors vehicle_classes_operatorId_id_unique.
    unique('vehicles_operatorId_id_unique').on(table.operatorId, table.id),
  ],
)

// Issue #225: maintenance log and notes per vehicle. Tracks why a vehicle
// entered MAINTENANCE, with optional cost tracking and resolution timestamp.
export const maintenanceLogs = pgTable(
  'maintenance_logs',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    vehicleId: text('vehicleId')
      .notNull()
      .references(() => vehicles.id),
    reason: text('reason').notNull(),
    notes: text('notes'),
    costJpy: integer('costJpy'),
    startedAt: timestamp('startedAt', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    resolvedAt: timestamp('resolvedAt', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('maintenance_cost_non_negative', sql`${table.costJpy} IS NULL OR ${table.costJpy} >= 0`),
    // FK index — exists in prod via 0020_add-maintenance-logs-vehicle-index.sql
    // but was never echoed here, so the snapshot didn't carry it and a future
    // `drizzle-kit pull` would silently drop it. Codified per #1172/#1150.
    index('idx_maintenance_logs_vehicleId').on(table.vehicleId),
  ],
)

// #1101: scheduled blocks take a vehicle off the calendar for a time-ranged
// [startAt, endAt) window — maintenance, out-of-service, or a manual operator
// hold. Unlike maintenance_logs (reactive, cost-tracking, welded to the binary
// vehicle.status=MAINTENANCE toggle), a block is forward-looking and is the
// availability primitive: a CONFIRMED/ACTIVE booking cannot overlap one. The
// block-vs-block guarantee is the `vehicle_blocks_no_overlap` GiST EXCLUDE
// constraint added in a custom migration (EXCLUDE is not expressible in the
// drizzle table builder — same pattern as bookings_no_overlap). Booking-vs-block
// is enforced in the service layer (a NOT EXISTS at booking create and on
// operator assign/substitute, #1152), since a single EXCLUDE index cannot span
// two tables.
export const vehicleBlocks = pgTable(
  'vehicle_blocks',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // Tenant owner. Part of the composite FK below that seals the block's vehicle
    // to its own operator. Server-derived from the vehicle — never client-supplied.
    operatorId: text('operatorId')
      .notNull()
      .references(() => operators.id, { onDelete: 'restrict' }),
    vehicleId: text('vehicleId').notNull(),
    startAt: timestamp('startAt', { withTimezone: true, mode: 'date' }).notNull(),
    endAt: timestamp('endAt', { withTimezone: true, mode: 'date' }).notNull(),
    kind: vehicleBlockKindEnum('kind').notNull(),
    reason: text('reason').notNull(),
    notes: text('notes'),
    // User id of the operator who scheduled the block (from the session). Text,
    // not an FK — the actor is an audit fact, not a referential dependency.
    createdBy: text('createdBy').notNull(),
    createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // A zero-or-negative-width block is meaningless and would make the tstzrange
    // empty (never overlapping) — reject at the DB boundary (mirrored by the Zod
    // validator). The exclusion constraint relies on non-empty ranges.
    check('vehicle_blocks_end_after_start', sql`${table.endAt} > ${table.startAt}`),
    index('idx_vehicle_blocks_vehicleId').on(table.vehicleId),
    index('idx_vehicle_blocks_operatorId').on(table.operatorId),
    // A block's vehicle must belong to the block's own operator. vehicleId +
    // operatorId together reference vehicles(operatorId, id) — the named unique
    // key vehicles_operatorId_id_unique. Mirrors the bookings/vehicle seal.
    foreignKey({
      columns: [table.operatorId, table.vehicleId],
      foreignColumns: [vehicles.operatorId, vehicles.id],
      name: 'vehicle_blocks_operatorId_vehicleId_fk',
    }),
  ],
)

export type { Transmission, VehicleBlockKind, VehicleClassStatus, VehicleStatus } from '../enums'
