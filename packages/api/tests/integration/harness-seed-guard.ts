import {
  BEST_CAR_RENTAL_OPERATOR_ID,
  BEST_CAR_RENTAL_SLUG,
  SECOND_OPERATOR_ID,
  SECOND_OPERATOR_SLUG,
} from '@kuruma/shared/db/constants'

// The fixed-id tenants global-setup seeds. A db:seed / demo run creates operators
// with these SLUGS but random ids; operators.slug is unique, so the two collide
// and onConflictDoNothing silently skips the harness insert. This module is kept
// free of any DB import so the pure guard can be unit-tested without DATABASE_URL
// (pg-test-client throws at import when it is unset).
const HARNESS_OPERATORS = [
  { id: BEST_CAR_RENTAL_OPERATOR_ID, slug: BEST_CAR_RENTAL_SLUG },
  { id: SECOND_OPERATOR_ID, slug: SECOND_OPERATOR_SLUG },
] as const

export interface ShadowedHarnessOperator {
  readonly slug: string
  readonly expectedId: string
  readonly shadowId: string
}

/**
 * Pure guard (#1366): given every operators row (id + slug), return the first
 * harness tenant whose SLUG is already held by a DIFFERENT id — the demo-seed
 * pollution that makes onConflictDoNothing skip the fixed-id insert. Null means
 * the DB is clean enough for the harness to seed (empty, or the harness tenants
 * already present under their own ids — the idempotent warm-rerun case).
 */
export function findShadowedHarnessOperator(
  rows: readonly { id: string; slug: string }[],
): ShadowedHarnessOperator | null {
  for (const harness of HARNESS_OPERATORS) {
    const shadow = rows.find((row) => row.slug === harness.slug && row.id !== harness.id)
    if (shadow) {
      return { slug: harness.slug, expectedId: harness.id, shadowId: shadow.id }
    }
  }
  return null
}
