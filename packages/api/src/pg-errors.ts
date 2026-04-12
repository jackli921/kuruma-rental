/**
 * Postgres error codes used in constraint-violation handling.
 * @see https://www.postgresql.org/docs/current/errcodes-appendix.html
 */
export const PG_ERROR = {
  EXCLUSION_VIOLATION: '23P01',
  UNIQUE_VIOLATION: '23505',
} as const

/** Extract the Postgres error code from an unknown thrown value, or null. */
export function pgErrorCode(err: unknown): string | null {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code: unknown }).code
    return typeof code === 'string' ? code : null
  }
  return null
}
