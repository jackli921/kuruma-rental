import {
  BEST_CAR_RENTAL_OPERATOR_ID,
  BEST_CAR_RENTAL_SLUG,
  SECOND_OPERATOR_ID,
  SECOND_OPERATOR_SLUG,
} from '@kuruma/shared/db/constants'
import { describe, expect, it } from 'vitest'
import { findShadowedHarnessOperator } from './integration/harness-seed-guard'

// #1366: the integration global-setup seeds the harness tenants by FIXED id but
// with slugs a db:seed demo run also uses (under random ids). operators.slug is
// unique, so onConflictDoNothing skips the fixed-id insert silently → the tenant
// never exists → ~40 files fail with confusing FK cascades. This pure guard lets
// setup() detect the pollution and fail loudly instead. These cases pin its
// decision without a DB.
describe('findShadowedHarnessOperator', () => {
  it('returns null for an empty DB (nothing seeded yet)', () => {
    expect(findShadowedHarnessOperator([])).toBeNull()
  })

  it('returns null when the harness operators exist under their own fixed ids', () => {
    const rows = [
      { id: BEST_CAR_RENTAL_OPERATOR_ID, slug: BEST_CAR_RENTAL_SLUG },
      { id: SECOND_OPERATOR_ID, slug: SECOND_OPERATOR_SLUG },
    ]
    expect(findShadowedHarnessOperator(rows)).toBeNull()
  })

  it('ignores unrelated operators that share no harness slug', () => {
    const rows = [{ id: 'op_random', slug: 'sakura-mobility' }]
    expect(findShadowedHarnessOperator(rows)).toBeNull()
  })

  it('flags a demo operator squatting the best-car-rental slug under a different id', () => {
    const rows = [{ id: 'd89cb32a-cd3a-4fc2-b799-b462232dff71', slug: BEST_CAR_RENTAL_SLUG }]
    expect(findShadowedHarnessOperator(rows)).toEqual({
      slug: BEST_CAR_RENTAL_SLUG,
      expectedId: BEST_CAR_RENTAL_OPERATOR_ID,
      shadowId: 'd89cb32a-cd3a-4fc2-b799-b462232dff71',
    })
  })

  it('also detects a shadow of the second harness operator', () => {
    const rows = [
      { id: BEST_CAR_RENTAL_OPERATOR_ID, slug: BEST_CAR_RENTAL_SLUG },
      { id: 'afeb7f73-random', slug: SECOND_OPERATOR_SLUG },
    ]
    expect(findShadowedHarnessOperator(rows)).toEqual({
      slug: SECOND_OPERATOR_SLUG,
      expectedId: SECOND_OPERATOR_ID,
      shadowId: 'afeb7f73-random',
    })
  })
})
