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
 * Composite FK fee_schedules(operatorId, vehicleClassId) -> vehicle_classes(operatorId, id),
 * named explicitly in schema.ts. fee_schedules also carries operatorId -> operators, so a
 * 23503 alone is ambiguous; match on this name to tell a bad (or cross-tenant) vehicleClassId
 * apart from a bad operatorId (#405, mirrors VEHICLES_CLASS_FK / #400).
 */
export const FEE_SCHEDULES_CLASS_FK = 'fee_schedules_operator_class_fk'

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
