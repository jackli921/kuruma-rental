/**
 * Canonical enum value sets — the SINGLE SOURCE OF TRUTH for every closed-set
 * domain enum, consumed by BOTH the DB layer (db/schema.ts passes these arrays
 * to `pgEnum(...)`) and the validators (`z.enum(<arr>)`). Kills the
 * hand-copied-literal drift class (audit Theme 2): `bookingStatus` alone was
 * spelled out in 10+ places with no compile-time link, and the schema test only
 * checked the pgEnum, so a stale copy compiled green and shipped a runtime
 * mismatch.
 *
 * PURE DATA, ZERO IMPORTS — this is load-bearing: importing `@kuruma/shared/enums`
 * must never pull in drizzle / the DB runtime, so `packages/web` (CF Pages edge,
 * no DB access) can import the enum TYPES without dragging in postgres. Reach it
 * via the dedicated `@kuruma/shared/enums` subpath, never the package barrel
 * (which re-exports the DB layer). Mirrors the zero-import `auth/roles` subpath
 * (#683) and `lib/luggage` `LUGGAGE_SIZES` (#457).
 *
 * Each array is declared `as const` so the derived type narrows to the literal
 * union. db/schema.ts imports the array and feeds it to `pgEnum`; the schema
 * enum-sync test (#687) pins the resulting `enumValues` to a literal array, so a
 * change here that diverges from a migration's `CREATE TYPE` fails CI.
 *
 * NOTE: notification enums (notification_kind, notification_status) are
 * deliberately ABSENT — their derivation is owned by a separate change (#710).
 * Do not add them here.
 */

export const ROLES = [
  'RENTER',
  'STAFF',
  'ADMIN',
  'OPERATOR_OWNER',
  'OPERATOR_STAFF',
  'PLATFORM_ADMIN',
] as const
export type Role = (typeof ROLES)[number]

export const TRANSMISSIONS = ['AUTO', 'MANUAL'] as const
export type Transmission = (typeof TRANSMISSIONS)[number]

export const VEHICLE_CLASS_STATUSES = ['ACTIVE', 'ARCHIVED'] as const
export type VehicleClassStatus = (typeof VEHICLE_CLASS_STATUSES)[number]

export const VEHICLE_STATUSES = ['AVAILABLE', 'MAINTENANCE', 'RETIRED'] as const
export type VehicleStatus = (typeof VEHICLE_STATUSES)[number]

export const BOOKING_STATUSES = ['CONFIRMED', 'ACTIVE', 'COMPLETED', 'CANCELLED'] as const
export type BookingStatus = (typeof BOOKING_STATUSES)[number]

export const BOOKING_SOURCES = ['DIRECT', 'TRIP_COM', 'MANUAL', 'OTHER'] as const
export type BookingSource = (typeof BOOKING_SOURCES)[number]

export const BOOKING_FULFILLMENT_MODES = ['SPECIFIC', 'CLASS_COMBO'] as const
export type BookingFulfillmentMode = (typeof BOOKING_FULFILLMENT_MODES)[number]

export const BOOKING_EVENT_TYPES = [
  'BOOKING_CREATED',
  'VEHICLE_SUBSTITUTED',
  'BOOKING_CANCELLED',
  'STATUS_CHANGED',
] as const
export type BookingEventType = (typeof BOOKING_EVENT_TYPES)[number]

export const LOCATION_STATUSES = ['ACTIVE', 'ARCHIVED'] as const
export type LocationStatus = (typeof LOCATION_STATUSES)[number]

export const COORDINATE_SOURCES = ['GEOCODED', 'MANUAL', 'PENDING'] as const
export type CoordinateSource = (typeof COORDINATE_SOURCES)[number]

export const INSURANCE_STATUSES = ['ACTIVE', 'ARCHIVED'] as const
export type InsuranceStatus = (typeof INSURANCE_STATUSES)[number]

export const FEE_TYPES = ['OVERTIME_HOURLY', 'CLEANING_FLAT', 'NO_FUEL_FLAT'] as const
export type FeeType = (typeof FEE_TYPES)[number]

export const FEE_UNITS = ['PER_HOUR', 'PER_DAY', 'PER_KM', 'FLAT'] as const
export type FeeUnit = (typeof FEE_UNITS)[number]

export const FEE_SCHEDULE_STATUSES = ['ACTIVE', 'ARCHIVED'] as const
export type FeeScheduleStatus = (typeof FEE_SCHEDULE_STATUSES)[number]

export const PAYMENT_EVENT_STATUSES = ['SUCCEEDED'] as const
export type PaymentEventStatus = (typeof PAYMENT_EVENT_STATUSES)[number]

export const ADD_ON_STATUSES = ['ACTIVE', 'ARCHIVED'] as const
export type AddOnStatus = (typeof ADD_ON_STATUSES)[number]

export const DOCUMENT_TYPES = ['IDP', 'PASSPORT'] as const
export type DocumentType = (typeof DOCUMENT_TYPES)[number]

export const DOCUMENT_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number]

export const OPERATOR_ROLES = ['OPERATOR_OWNER', 'OPERATOR_STAFF'] as const
export type OperatorRole = (typeof OPERATOR_ROLES)[number]

export const OPERATOR_MEMBERSHIP_STATUSES = ['ACTIVE', 'REVOKED'] as const
export type OperatorMembershipStatus = (typeof OPERATOR_MEMBERSHIP_STATUSES)[number]

export const PROVIDER_INVITE_STATUSES = ['PENDING', 'ACCEPTED'] as const
export type ProviderInviteStatus = (typeof PROVIDER_INVITE_STATUSES)[number]

// LUGGAGE_SIZES already lives in lib/luggage.ts (#457) — re-exported here so the
// enum SSoT is reachable from one subpath without duplicating its declaration.
export { LUGGAGE_SIZES, type LuggageSize } from './lib/luggage'
