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
 * Booking unique constraints the BookingService distinguishes on (#392, §5.4).
 * A `bookingCode` clash is astronomically rare but recoverable: regenerate the
 * code and retry the whole atomic insert. An `idempotencyKey` clash means a
 * concurrent replay won the race: re-fetch and return the existing booking.
 * Matching by name (not just the 23505 code) keeps the two paths apart.
 */
export const BOOKING_CODE_CONSTRAINT = 'bookings_bookingCode_unique'
export const IDEMPOTENCY_CONSTRAINT = 'bookings_idempotencyKey_unique'

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
