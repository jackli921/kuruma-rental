import { sql } from 'drizzle-orm'
import {
  check,
  date,
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
} from 'drizzle-orm/pg-core'
import type { AdapterAccountType } from 'next-auth/adapters'
import type { LocationOperatingHours } from '../types/location'

// Marketplace tenancy (epic #385, slice 1 / #386).
// OPERATOR_* roles are tenant-scoped and NEVER bypass operator scope.
// PLATFORM_ADMIN is the only role allowed to bypass (env-gated).
// Legacy STAFF / ADMIN remain as temporary platform-admin equivalents
// during the transition — no new users get them. See proposal §6.2.
export const roleEnum = pgEnum('role', [
  'RENTER',
  'STAFF',
  'ADMIN',
  'OPERATOR_OWNER',
  'OPERATOR_STAFF',
  'PLATFORM_ADMIN',
])

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

export const transmissionEnum = pgEnum('transmission', ['AUTO', 'MANUAL'])
export const vehicleClassStatusEnum = pgEnum('vehicle_class_status', ['ACTIVE', 'ARCHIVED'])
export const vehicleStatusEnum = pgEnum('vehicle_status', ['AVAILABLE', 'MAINTENANCE', 'RETIRED'])
export const bookingStatusEnum = pgEnum('booking_status', [
  'CONFIRMED',
  'ACTIVE',
  'COMPLETED',
  'CANCELLED',
])
export const bookingSourceEnum = pgEnum('booking_source', ['DIRECT', 'TRIP_COM', 'MANUAL', 'OTHER'])

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
    transmission: transmissionEnum('transmission').notNull(),
    fuelType: text('fuelType'),
    dailyRateJpy: integer('dailyRateJpy'),
    hourlyRateJpy: integer('hourlyRateJpy'),
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
    check(
      'vehicle_classes_pricing_at_least_one',
      sql`${table.dailyRateJpy} IS NOT NULL OR ${table.hourlyRateJpy} IS NOT NULL`,
    ),
    check(
      'vehicle_classes_daily_rate_non_negative',
      sql`${table.dailyRateJpy} IS NULL OR ${table.dailyRateJpy} >= 0`,
    ),
    check(
      'vehicle_classes_hourly_rate_non_negative',
      sql`${table.hourlyRateJpy} IS NULL OR ${table.hourlyRateJpy} >= 0`,
    ),
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

export const locationStatusEnum = pgEnum('location_status', ['ACTIVE', 'ARCHIVED'])

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
    // MVP shape (locked, see LocationOperatingHours): a single
    // { openTime, closeTime } pair applied to all weekdays, or null. Per-weekday
    // schedules ship as a separate migration + validator change (proposal §9 #4).
    operatingHours: jsonb('operatingHours').$type<LocationOperatingHours>(),
    timezone: text('timezone').notNull().default('Asia/Tokyo'),
    // §9 item 20: turnaround/cooldown buffer before the same vehicle is bookable
    // again after a return. 48h (2880m) default; per-location override here.
    defaultTurnaroundMinutes: integer('defaultTurnaroundMinutes').notNull().default(2880),
    status: locationStatusEnum('status').notNull().default('ACTIVE'),
    createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_locations_operatorId').on(table.operatorId),
    // Name is unique per operator (not globally) — two operators may both have a
    // "Namba" store. DB seal behind the service-level friendly 409 (#387).
    unique('locations_operatorId_name_unique').on(table.operatorId, table.name),
    // Composite-FK target: lets vehicles reference a pickup location by
    // (operatorId, id) so a vehicle can only point at a location in its own
    // tenant (slice 2 migration #2). Mirrors vehicle_classes_operatorId_id_unique.
    unique('locations_operatorId_id_unique').on(table.operatorId, table.id),
    check('locations_turnaround_non_negative', sql`${table.defaultTurnaroundMinutes} >= 0`),
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
    transmission: transmissionEnum('transmission').notNull(),
    fuelType: text('fuelType'),
    licensePlate: text('licensePlate').unique(),
    status: vehicleStatusEnum('status').notNull().default('AVAILABLE'),
    bufferMinutes: integer('bufferMinutes').notNull().default(60),
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
  ],
)

export const bookings = pgTable(
  'bookings',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    renterId: text('renterId')
      .notNull()
      .references(() => users.id),
    // Issue #308: classId is the renter's choice (always present).
    // vehicleId is nullable — owner assigns a specific car later.
    classId: text('classId')
      .notNull()
      .references(() => vehicleClasses.id),
    vehicleId: text('vehicleId').references(() => vehicles.id),
    startAt: timestamp('startAt', { withTimezone: true, mode: 'date' }).notNull(),
    endAt: timestamp('endAt', { withTimezone: true, mode: 'date' }).notNull(),
    effectiveEndAt: timestamp('effectiveEndAt', { withTimezone: true, mode: 'date' }).notNull(),
    status: bookingStatusEnum('status').notNull().default('CONFIRMED'),
    source: bookingSourceEnum('source').notNull().default('DIRECT'),
    externalId: text('externalId'),
    notes: text('notes'),
    totalPrice: integer('totalPrice'), // whole JPY, nullable for legacy bookings
    cancellationFee: integer('cancellationFee'), // whole JPY, set on cancellation
    cancelledAt: timestamp('cancelledAt', { withTimezone: true, mode: 'date' }),
    idempotencyKey: text('idempotencyKey'),
    createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Issue #330: booking-by-class queries filter on classId every request.
    // Paired with idx_vehicles_classId to avoid sequential scans at scale.
    index('idx_bookings_classId').on(table.classId),
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

export type BookingStatus = (typeof bookingStatusEnum.enumValues)[number]

export const VALID_BOOKING_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  CONFIRMED: ['ACTIVE', 'CANCELLED'],
  ACTIVE: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
}
