/**
 * Postgres error codes used in constraint-violation handling.
 * @see https://www.postgresql.org/docs/current/errcodes-appendix.html
 */
export const PG_ERROR = {
  EXCLUSION_VIOLATION: '23P01',
  UNIQUE_VIOLATION: '23505',
  FOREIGN_KEY_VIOLATION: '23503',
  CHECK_VIOLATION: '23514',
} as const

/**
 * Composite FK vehicles(operatorId, classId) -> vehicle_classes(operatorId, id),
 * named explicitly in schema.ts. The vehicles table also carries a single
 * operatorId -> operators FK, so a 23503 alone is ambiguous; match on this name
 * to tell a bad classId apart from a bad operatorId (#400).
 */
export const VEHICLES_CLASS_FK = 'vehicles_operatorId_classId_fk'

/**
 * Composite FK vehicles(operatorId, pickupLocationId) -> locations(operatorId, id),
 * named explicitly in schema.ts (#387 slice 2). vehicles carries three FKs, so a
 * 23503 alone is ambiguous; match on this name to tell a bad (or cross-tenant)
 * pickupLocationId apart from a bad classId or operatorId (#435, mirrors
 * VEHICLES_CLASS_FK / #400).
 */
export const VEHICLES_PICKUP_LOCATION_FK = 'vehicles_operatorId_pickupLocationId_fk'

/**
 * Composite FK fee_schedules(operatorId, vehicleClassId) -> vehicle_classes(operatorId, id),
 * named explicitly in schema.ts. fee_schedules also carries operatorId -> operators, so a
 * 23503 alone is ambiguous; match on this name to tell a bad (or cross-tenant) vehicleClassId
 * apart from a bad operatorId (#405, mirrors VEHICLES_CLASS_FK / #400).
 */
export const FEE_SCHEDULES_CLASS_FK = 'fee_schedules_operator_class_fk'

/**
 * locations(regionId) -> regions(id), named in schema.ts (#394). locations also
 * carries operatorId -> operators, so once regionId is a client-supplied FK a
 * 23503 alone is ambiguous; match on this name to tell a bad region apart from a
 * bad operatorId (mirrors VEHICLES_CLASS_FK / #400).
 */
export const LOCATIONS_REGION_FK = 'locations_regionId_regions_id_fk'

/**
 * GiST EXCLUDE on vehicle_blocks (operatorId, vehicleId, [startAt,endAt)),
 * named explicitly in migration 0076 (#1101). A 23P01 on this name on the
 * block-create path means an operator scheduled an overlapping block on the
 * same vehicle. VehicleBlockService maps it to a 409 (VEHICLE_BLOCK_OVERLAP) —
 * kept apart from bookings_no_overlap (a 23P01 meaning "already booked"), which
 * the booking-creation service surfaces as VEHICLE_BLOCKED on the other side.
 */
export const VEHICLE_BLOCKS_OVERLAP = 'vehicle_blocks_no_overlap'

/**
 * Booking unique constraints the BookingService distinguishes on (#392, §5.4).
 * A `bookingCode` clash is astronomically rare but recoverable: regenerate the
 * code and retry the whole atomic insert. An `idempotencyKey` clash means a
 * concurrent replay won the race: re-fetch and return the existing booking.
 * Matching by name (not just the 23505 code) keeps the two paths apart.
 */
export const BOOKING_CODE_CONSTRAINT = 'bookings_bookingCode_unique'
// Real PG index name from migration 0012_idempotency-unique-index.sql
// (`CREATE UNIQUE INDEX "bookings_idempotency_key"`) — NOT the Drizzle-auto
// camelCase suffix the schema's `.unique()` would have produced. Surfaced by
// the #1106 conformance suite: the InMemory uniqueViolation interpolates this
// constant, so it must match the real PG index name byte-for-byte or services
// that disambiguate by constraint name drift between impls.
export const IDEMPOTENCY_CONSTRAINT = 'bookings_idempotency_key'

/**
 * payment_events unique constraints the PaymentService distinguishes on (#461).
 * All three are 23505, but they mean different things:
 * - STRIPE_EVENT / SESSION clashes = a redelivered webhook → idempotent no-op.
 * - ONE_SUCCESS clash = a *different* Session already paid this booking → a
 *   double-payment anomaly to log loudly (an operator must refund one).
 * Matching by name (not just the code) keeps the no-op path apart from the alarm.
 */
export const PAYMENT_EVENT_STRIPE_EVENT_CONSTRAINT = 'payment_events_stripeEventId_unique'
export const PAYMENT_EVENT_SESSION_CONSTRAINT = 'payment_events_stripeCheckoutSessionId_unique'
export const PAYMENT_EVENT_ONE_SUCCESS_CONSTRAINT = 'payment_events_one_success_per_booking'

/**
 * Partial unique index on payment_refunds(stripeRefundId) WHERE stripeRefundId IS
 * NOT NULL (#851). One Stripe refund (re_…) binds to at most one booking's receipt;
 * a 23505 on this name means an adoption bug tried to attach the same refund to a
 * second booking — a loud invariant breach, never a silent no-op.
 */
export const PAYMENT_REFUND_STRIPE_REFUND_CONSTRAINT = 'payment_refunds_stripeRefundId_unique'

/**
 * reviews unique seal (#1067): one review per author per booking per subject. A
 * 23505 on this name means the same side re-submitted the same subject — the
 * submission service edits the existing hidden row instead of inserting a second
 * (a renter still reviews OPERATOR and VEHICLE separately — different subjects).
 * Matching by name keeps this apart from any future reviews unique.
 */
export const REVIEWS_AUTHOR_SUBJECT_CONSTRAINT = 'reviews_author_subject_per_booking_unique'

/**
 * Partial unique index on provider_invites (operatorId, email) WHERE status=
 * 'PENDING' (#904 slice 2). At most one live invite per operator+email; REVOKED/
 * ACCEPTED rows free the slot so a re-invite works. A 23505 on this name means the
 * owner re-invited an already-pending email -> translated to a 409 ConflictError,
 * kept apart from the (astronomically unlikely) tokenHash collision.
 */
export const PROVIDER_INVITE_PENDING_EMAIL_CONSTRAINT = 'provider_invites_pending_email_unique'

/** Extract the Postgres error code from an unknown thrown value, or null.
 *
 * Drizzle + postgres-js wraps the raw PostgresError inside `err.cause`,
 * so the PG error code lives at `err.cause.code`, not `err.code`.
 * We check both paths so the same helper works with raw PG errors
 * (in-memory repo) and wrapped drizzle errors (real DB). */
export function pgErrorCode(err: unknown): string | null {
  const code = extractCode(err) ?? extractCode(getCause(err))
  return code
}

/** Extract the violated constraint name from a thrown PG error, or null.
 * Like the code, postgres-js exposes `constraint_name`; drizzle wraps the
 * PostgresError under `err.cause`, so we check both paths. */
export function pgConstraintName(err: unknown): string | null {
  return extractConstraint(err) ?? extractConstraint(getCause(err))
}

function extractConstraint(val: unknown): string | null {
  if (val && typeof val === 'object' && 'constraint_name' in val) {
    const name = (val as { constraint_name: unknown }).constraint_name
    return typeof name === 'string' ? name : null
  }
  return null
}

function extractCode(val: unknown): string | null {
  if (val && typeof val === 'object' && 'code' in val) {
    const code = (val as { code: unknown }).code
    return typeof code === 'string' ? code : null
  }
  return null
}

function getCause(val: unknown): unknown {
  if (val && typeof val === 'object' && 'cause' in val) {
    return (val as { cause: unknown }).cause
  }
  return null
}
