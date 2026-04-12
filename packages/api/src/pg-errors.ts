/**
 * Postgres error codes used in constraint-violation handling.
 * @see https://www.postgresql.org/docs/current/errcodes-appendix.html
 */
export const PG_ERROR = {
  EXCLUSION_VIOLATION: '23P01',
  UNIQUE_VIOLATION: '23505',
} as const

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
