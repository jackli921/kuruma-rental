import { sql } from 'drizzle-orm'
import {
  check,
  date,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import type { AdapterAccountType } from 'next-auth/adapters'
// Enum value sets are declared ONCE in ../enums (zero-import, no-DB subpath) so
// the DB pgEnums, the Zod validators, and the web type imports all share one
// source (#688). The pgEnums below feed these arrays into `pgEnum(...)`.
import {
  BOOKING_EVENT_TYPES,
  BOOKING_FULFILLMENT_MODES,
  BOOKING_SOURCES,
  BOOKING_STATUSES,
  COORDINATE_SOURCES,
  FEE_SCHEDULE_STATUSES,
  FEE_TYPES,
  FEE_UNITS,
  INSURANCE_STATUSES,
  LOCATION_STATUSES,
  PAYMENT_EVENT_STATUSES,
  ROLES,
  TRANSMISSIONS,
  VEHICLE_CLASS_STATUSES,
  VEHICLE_STATUSES,
} from '../enums'
import { LUGGAGE_SIZES } from '../lib/luggage'
import type { LocationOperatingHours } from '../types/location'
// Booking snapshot/event payload types live in ./booking-types (file-size split,
// #460); imported here for the jsonb $type<> column annotations below.
import type {
  AddOnSnapshot,
  BookingEventPayload,
  FeeSnapshotItem,
  InsuranceSnapshot,
} from './booking-types'
// Region taxonomy (#394) lives in its own module; imported here for the
// locations.regionId FK and re-exported below so drizzle-kit discovers it.
import { regions } from './regions'

// Marketplace tenancy (epic #385, slice 1 / #386).
// OPERATOR_* roles are tenant-scoped and NEVER bypass operator scope.
// PLATFORM_ADMIN is the only role allowed to bypass (env-gated).
// Legacy STAFF / ADMIN remain as temporary platform-admin equivalents
// during the transition — no new users get them. See proposal §6.2.
export const roleEnum = pgEnum('role', ROLES)

// Operators are the marketplace tenants (e.g. Best Car Rental). Every
// operator-owned entity (vehicles, classes, later locations/insurance/fees)
// carries an operatorId FK. See proposal §6 row 1.
export const operators = pgTable('operators', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  // kebab-case ASCII, max 32 chars; powers /manage/<slug>/... routing (§9 item 15)
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  // §9 item 2: external pre-auth/handoff URL (separate Stripe site, post-MVP)
  preAuthHandoffUrl: text('pre_auth_handoff_url'),
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
})

// Auth.js required fields + app profile fields
// Column names must be camelCase to match @auth/drizzle-adapter expectations
export const users = pgTable(
  'users',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    name: text('name'),
    email: text('email').unique().notNull(),
    emailVerified: timestamp('emailVerified', { mode: 'date' }),
    image: text('image'),
    role: roleEnum('role').notNull().default('RENTER'),
    // NULL = renter or platform admin (both legitimate). Set for OPERATOR_*.
    operatorId: text('operatorId').references(() => operators.id),
    phone: text('phone'),
    language: text('language').notNull().default('en'),
    country: text('country'),
    createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('idx_users_operatorId').on(table.operatorId)],
)

export const accounts = pgTable(
  'accounts',
  {
    userId: text('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').$type<AdapterAccountType>().notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('providerAccountId').notNull(),
    refresh_token: text('refresh_token'),
    access_token: text('access_token'),
    expires_at: integer('expires_at'),
    token_type: text('token_type'),
    scope: text('scope'),
    id_token: text('id_token'),
    session_state: text('session_state'),
  },
  (account) => [primaryKey({ columns: [account.provider, account.providerAccountId] })],
)

export const transmissionEnum = pgEnum('transmission', TRANSMISSIONS)
// #457: standardized luggage-size taxonomy. Values declared once in lib/luggage.ts
// (shared by the Zod enum, the resolver, and this pgEnum).
export const luggageSizeEnum = pgEnum('luggage_size', LUGGAGE_SIZES)
export const vehicleClassStatusEnum = pgEnum('vehicle_class_status', VEHICLE_CLASS_STATUSES)
export const vehicleStatusEnum = pgEnum('vehicle_status', VEHICLE_STATUSES)
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
      .references(() => operators.id),
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

export const locationStatusEnum = pgEnum('location_status', LOCATION_STATUSES)

// Provenance of a location's lat/lng (#531). GEOCODED = derived from `address`
// by the Geocoder; MANUAL = an operator-supplied pin that wins over geocoding;
// PENDING = geocoding was rate-limit-skipped (#601/#574 — coords still null, but
// a retry will resolve them, so the bulk re-geocode can enumerate these).
// Nullable column: null = no coords captured AND none pending (un-geocodable).
// Server-derived only — never accepted from the client (the validators omit it).
export const coordinateSourceEnum = pgEnum('coordinate_source', COORDINATE_SOURCES)

// Operator-owned pickup/return storefronts (epic #385, slice 2 / #387).
// Vehicles anchor to a pickup location; renter search (slice 5) returns
// storefront cards; bookings (slice 6) carry pickup/dropoff FKs. Every row
// is tenant-scoped via operatorId. See proposal §6 row 2, §9 items 2/20.
export const locations = pgTable(
  'locations',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // Tenant owner. NOT NULL — same fresh-branch reseed rationale as
    // vehicleClasses.operatorId (#386 P1b); no nullable tenancy debt.
    operatorId: text('operatorId')
      .notNull()
      .references(() => operators.id),
    name: text('name').notNull(),
    address: text('address').notNull(),
    // WGS84 decimal degrees, nullable (#458 D2). null = not-yet-geocoded → that
    // row renders list-only; no 0,0 default. Bounds checked at the Zod boundary.
    // Rationale + precision choice: design doc §3.3.
    latitude: doublePrecision('latitude'),
    longitude: doublePrecision('longitude'),
    // Provenance of the coords above (#531). null = none captured. Drives the
    // geocode-on-save precedence: MANUAL pins survive an address change, GEOCODED
    // coords are re-derived (or cleared if re-geocoding fails).
    coordinateSource: coordinateSourceEnum('coordinate_source'),
    // MVP shape (locked, see LocationOperatingHours): a single
    // { openTime, closeTime } pair applied to all weekdays, or null. Per-weekday
    // schedules ship as a separate migration + validator change (proposal §9 #4).
    operatingHours: jsonb('operatingHours').$type<LocationOperatingHours>(),
    timezone: text('timezone').notNull().default('Asia/Tokyo'),
    // §9 item 20: turnaround/cooldown buffer before the same vehicle is bookable
    // again after a return. 48h (2880m) default; per-location override here.
    defaultTurnaroundMinutes: integer('defaultTurnaroundMinutes').notNull().default(2880),
    // #394 hierarchical region node (the deepest/area level). NULLABLE this slice:
    // the operator location form (frozen Next.js) does not set a region yet, so a
    // NOT NULL constraint would break new-location inserts — a non-backwards-compat
    // regression. Tighten to NOT NULL once the operator picker ships (#394 D1). FK
    // to the platform-global regions tree; null rows never match a region filter.
    regionId: text('regionId').references(() => regions.id),
    status: locationStatusEnum('status').notNull().default('ACTIVE'),
    createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_locations_operatorId').on(table.operatorId),
    // Covers the regionId FK (lint-fk-indexes) + the region-filtered storefront scan.
    index('idx_locations_regionId').on(table.regionId),
    // Name is unique per operator among *non-archived* rows (#410): a storefront
    // name belongs to active inventory, so archiving a location frees its name to
    // be reused. Two operators may both run an active "Namba". Partial unique
    // index excludes ARCHIVED rows; DB seal behind the service-level 409 (#387).
    uniqueIndex('locations_operatorId_active_name_unique')
      .on(table.operatorId, table.name)
      .where(sql`${table.status} <> 'ARCHIVED'`),
    // Composite-FK target: lets vehicles reference a pickup location by
    // (operatorId, id) so a vehicle can only point at a location in its own
    // tenant (slice 2 migration #2). Mirrors vehicle_classes_operatorId_id_unique.
    unique('locations_operatorId_id_unique').on(table.operatorId, table.id),
    // #551: 60-min floor guarantees a real servicing gap between rentals. Mirrors
    // the Zod `turnaroundSchema.min(60)`; this is the DB-level backstop for any
    // Zod-bypassed write (seed, import, raw SQL). Not overlap-safety — overlap is
    // already impossible at any turnaround via bookings_no_overlap.
    check('locations_turnaround_min_60', sql`${table.defaultTurnaroundMinutes} >= 60`),
  ],
)

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
      .references(() => operators.id),
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
])
// SENDING is the in-flight lease between QUEUED and SENT/FAILED — it closes the
// concurrent-send race (atomic claim, architect P1). Reclaimable ONLY after the
// SEND_LEASE expires (see notification_log claim predicate); SENT is terminal.
// DEAD is the terminal poison-message sink (#483): a row that has FAILED
// MAX_NOTIFICATION_ATTEMPTS times. The claim predicate never re-arms it, so a
// hard-bounce recipient stops being re-sent on every replay/resend.
export const notificationStatusEnum = pgEnum('notification_status', [
  'QUEUED',
  'SENDING',
  'SENT',
  'FAILED',
  'DEAD',
])

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
      .references(() => operators.id),
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

export const vehicles = pgTable(
  'vehicles',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // Tenant owner. NOT NULL — see vehicleClasses.operatorId rationale (#386 P1b).
    operatorId: text('operatorId')
      .notNull()
      .references(() => operators.id),
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
      .references(() => operators.id),
    renterId: text('renterId')
      .notNull()
      .references(() => users.id),
    // classId stays for discovery/grouping; the composite FK below seals it to
    // the booking's own operator (#392, mirrors vehicles_operatorId_classId_fk).
    classId: text('classId').notNull(),
    // What the renter selected in storefront (slice 5). Immutable audit trail —
    // substitution NEVER mutates this (proposal §2 "Vehicle substitution").
    requestedVehicleId: text('requestedVehicleId').notNull(),
    // What the operator fulfills; the exclusion constraint keys on THIS column.
    // Server-derived = requestedVehicleId at submit; operator may substitute.
    assignedVehicleId: text('assignedVehicleId').notNull(),
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
    // #463: a SPECIFIC booking MUST name the vehicle it fulfills. A tautology
    // today (assignedVehicleId is NOT NULL), but #464 makes that column nullable
    // for CLASS_COMBO — this CHECK then keeps every SPECIFIC row honest instead of
    // letting the invariant silently evaporate one migration away. #464 relaxes it.
    check(
      'bookings_specific_requires_assigned',
      sql`${table.fulfillmentMode} <> 'SPECIFIC' OR ${table.assignedVehicleId} IS NOT NULL`,
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
      .references(() => operators.id),
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
      .references(() => operators.id),
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
  ],
)

export const threads = pgTable('threads', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  bookingId: text('bookingId').references(() => bookings.id),
  idempotencyKey: text('idempotencyKey'),
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
})

export const threadParticipants = pgTable(
  'thread_participants',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    threadId: text('threadId')
      .notNull()
      .references(() => threads.id, { onDelete: 'cascade' }),
    userId: text('userId')
      .notNull()
      .references(() => users.id),
    unreadCount: integer('unreadCount').notNull().default(0),
  },
  (t) => [unique('thread_participants_thread_user').on(t.threadId, t.userId)],
)

export const messages = pgTable('messages', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  threadId: text('threadId')
    .notNull()
    .references(() => threads.id, { onDelete: 'cascade' }),
  senderId: text('senderId')
    .notNull()
    .references(() => users.id),
  content: text('content').notNull(),
  sourceLanguage: text('sourceLanguage'),
  translations: text('translations').default('{}'),
  idempotencyKey: text('idempotencyKey'),
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
})

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
      .references(() => operators.id),
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

export { documentStatusEnum, documentTypeEnum, renterDocuments } from './renter-documents'
export { regions, regionTypeEnum, regionStatusEnum } from './regions'

// Enum string-union types are derived ONCE in ../enums from the same value arrays
// the pgEnums above consume (#688). Re-exported here so existing
// `@kuruma/shared/db/schema` importers keep their type names while web can also
// import them DB-free via `@kuruma/shared/enums`. Notification enum types are
// deliberately excluded — owned by #710. LuggageSize stays sourced from lib/luggage.
export type {
  BookingEventType,
  BookingFulfillmentMode,
  BookingSource,
  BookingStatus,
  CoordinateSource,
  FeeScheduleStatus,
  FeeType,
  FeeUnit,
  InsuranceStatus,
  LocationStatus,
  PaymentEventStatus,
  Role,
  Transmission,
  VehicleClassStatus,
  VehicleStatus,
} from '../enums'
import type { BookingStatus } from '../enums'

export const VALID_BOOKING_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  CONFIRMED: ['ACTIVE', 'CANCELLED'],
  ACTIVE: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
}

// add_on_options table + status enum live in ./add-on; booking snapshot/event
// payload types live in ./booking-types. Both re-exported so drizzle-kit (which
// only loads this module) and existing `@kuruma/shared/db/schema` importers see
// them. Split out to keep this file under the 800-line cap (#460).
export * from './add-on'
export * from './booking-types'

// operator_memberships + provider_invites tables and their enums (#521 provider
// authorization). Re-exported so drizzle-kit and existing schema importers see
// them; FKs reference users/operators above.
export * from './provider-access'
