import { sql } from 'drizzle-orm'
import {
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { COORDINATE_SOURCES, LOCATION_STATUSES } from '../enums'
import type { LocationOperatingHours } from '../types/location'
import { operators } from './auth'
// Region taxonomy (#394) lives in its own module; imported here for the
// locations.regionId FK. The barrel (db/schema.ts) re-exports regions so
// drizzle-kit discovers it.
import { regions } from './regions'

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
      .references(() => operators.id, { onDelete: 'restrict' }),
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

export type { CoordinateSource, LocationStatus } from '../enums'
