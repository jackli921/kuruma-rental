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
  'VEHICLE_ASSIGNED',
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

// Lifecycle of an automated cancellation refund (#851). PENDING = receipt claimed,
// refund initiated or still settling at Stripe; SUCCEEDED = Stripe-confirmed (push
// webhook or pull retrieve); FAILED = terminal Stripe rejection (charge already
// refunded / insufficient balance), left for the human reconcile surface. The row
// is FORWARD-ONLY — a terminal status never regresses to PENDING.
export const PAYMENT_REFUND_STATUSES = ['PENDING', 'SUCCEEDED', 'FAILED'] as const
export type PaymentRefundStatus = (typeof PAYMENT_REFUND_STATUSES)[number]

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

// #904: REVOKED appended last — ALTER TYPE ADD VALUE appends positionally and
// enums.test.ts pins order contractually. An owner-revoked invite is terminal,
// distinct from ACCEPTED; listByOperator (PENDING-only) drops it off the team page.
export const PROVIDER_INVITE_STATUSES = ['PENDING', 'ACCEPTED', 'REVOKED'] as const
export type ProviderInviteStatus = (typeof PROVIDER_INVITE_STATUSES)[number]

// Region taxonomy levels (#394/#651): prefecture -> city -> area. Order is
// contractual — the region_type CREATE TYPE lists them positionally.
export const REGION_TYPES = ['PREFECTURE', 'CITY', 'AREA'] as const
export type RegionType = (typeof REGION_TYPES)[number]

// Region lifecycle. Note INACTIVE (not ARCHIVED): INACTIVE nodes are hidden from
// search + never matched by nearestAssignableRegion.
export const REGION_STATUSES = ['ACTIVE', 'INACTIVE'] as const
export type RegionStatus = (typeof REGION_STATUSES)[number]

// Settlement status of a recorded cancellation fee (#868 Slice 3a). Stored as a
// `text` column (NOT a pgEnum — review M4: the lifecycle churns toward #851), so
// it is absent from the pgEnum SSoT tripwire; the membership is pinned by
// enums.test.ts instead. Today (pay-at-pickup) every renter cancellation is
// ADVISORY — recorded for audit, zero money moved. The ADVISORY -> CAPTURED |
// REFUND_DUE | REFUNDED | WAIVED transitions are the TARGET for #851's real
// money movement, not implemented here. ADVISORY is the column default.
export const CANCELLATION_FEE_SETTLEMENT_STATES = [
  'ADVISORY',
  'CAPTURED',
  'REFUND_DUE',
  'REFUNDED',
  'WAIVED',
] as const
export type CancellationFeeSettlement = (typeof CANCELLATION_FEE_SETTLEMENT_STATES)[number]

// Renter cancellation reason (#868 Slice 3b). ALWAYS optional — it never gates the
// cancel, never triggers approval; captured purely for operator/analytics insight
// and stored event-payload-only (no bookings column — add one only if a query
// needs it later). `text` + Zod union, NOT a pgEnum (the taxonomy churns; review
// M4), so it is absent from the pgEnum SSoT tripwire and pinned by enums.test.ts.
export const CANCELLATION_REASON_CODES = [
  'CHANGE_OF_PLANS',
  'FOUND_ALTERNATIVE',
  'TRIP_CANCELLED',
  'VEHICLE_OR_PRICE_CONCERN',
  'OTHER',
] as const
export type CancellationReasonCode = (typeof CANCELLATION_REASON_CODES)[number]

// LUGGAGE_SIZES already lives in lib/luggage.ts (#457) — re-exported here so the
// enum SSoT is reachable from one subpath without duplicating its declaration.
export { LUGGAGE_SIZES, type LuggageSize } from './lib/luggage'

// --- Consent ledger (issue #877) ---
export const CONSENT_TYPES = [
  'RENTER_TOS',
  'PRIVACY_POLICY',
  'RENTER_LIABILITY',
  'OPERATOR_AGREEMENT',
] as const
export type ConsentType = (typeof CONSENT_TYPES)[number]

export const CONSENT_DOC_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const
export type ConsentDocStatus = (typeof CONSENT_DOC_STATUSES)[number]

export const CONSENT_METHODS = ['CLICKWRAP', 'ESIGN', 'IMPORTED'] as const
export type ConsentMethod = (typeof CONSENT_METHODS)[number]

/** §4.2 — derived config, never a stored column. Drives the re-consent query. */
export type ConsentCardinality = 'ONCE_PER_SUBJECT' | 'PER_EVENT'
export const CONSENT_CARDINALITY: Record<ConsentType, ConsentCardinality> = {
  RENTER_TOS: 'ONCE_PER_SUBJECT',
  PRIVACY_POLICY: 'ONCE_PER_SUBJECT',
  OPERATOR_AGREEMENT: 'ONCE_PER_SUBJECT',
  RENTER_LIABILITY: 'PER_EVENT',
}

// --- Mutual reviews & ratings (issue #1067) ---
/** Which side wrote a review. Operators review only renters; renters review the
 *  operator or the vehicle — enforced at the DB by reviews_subject_pairing_chk. */
export const REVIEW_AUTHOR_ROLES = ['RENTER', 'OPERATOR'] as const
export type ReviewAuthorRole = (typeof REVIEW_AUTHOR_ROLES)[number]

/** What a review is about. */
export const REVIEW_SUBJECTS = ['OPERATOR', 'VEHICLE', 'RENTER'] as const
export type ReviewSubject = (typeof REVIEW_SUBJECTS)[number]

/** Moderation state (#1067 slice 6). HIDDEN reviews drop out of aggregates and
 *  public reads; VISIBLE is the default. */
export const REVIEW_MODERATION_STATUSES = ['VISIBLE', 'HIDDEN'] as const
export type ReviewModerationStatus = (typeof REVIEW_MODERATION_STATUSES)[number]
