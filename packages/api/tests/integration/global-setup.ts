import {
  BEST_CAR_RENTAL_NAME,
  BEST_CAR_RENTAL_OPERATOR_ID,
  BEST_CAR_RENTAL_SLUG,
  SECOND_OPERATOR_ID,
  SECOND_OPERATOR_NAME,
  SECOND_OPERATOR_SLUG,
} from '@kuruma/shared/db/constants'
import { operators } from '@kuruma/shared/db/schema'
import { findShadowedHarnessOperator } from './harness-seed-guard'
import { testDb } from './pg-test-client'

// Slice 1 (#386) made vehicles.operatorId / vehicle_classes.operatorId NOT
// NULL with an FK to operators. Every integration test that seeds a vehicle or
// class needs its operator to exist and must pass operatorId explicitly — #401
// removed the silent resolveOperatorIdForWrite fall-back. Seed BOTH harness
// tenants once per run (#654: the second one lets cross-tenant isolation be
// asserted at the integration layer via the booking factory). Idempotent so
// reruns against a warm DB are safe.
export async function setup(): Promise<void> {
  // Fail loudly if the DB was demo-seeded (#1366). A db:seed run creates an
  // operator with a harness SLUG under a random id, which collides on the unique
  // operators.slug — so the fixed-id insert below is silently skipped by
  // onConflictDoNothing, `op_best_car_rental` never exists, and ~40 files cascade
  // into confusing FK failures. One clear message beats that cascade. The
  // integration DB must be migrated but NOT demo-seeded.
  const existing = await testDb.select({ id: operators.id, slug: operators.slug }).from(operators)
  const shadow = findShadowedHarnessOperator(existing)
  if (shadow) {
    throw new Error(
      `Integration DB is not clean: slug "${shadow.slug}" is already held by operator "${shadow.shadowId}", but the harness needs the fixed id "${shadow.expectedId}". onConflictDoNothing would skip the harness insert, so "${shadow.expectedId}" would never exist and vehicle/class/booking seeds would fail with FK errors. Run the integration suite against a migrated-but-not-demo-seeded DB (do not db:seed it).`,
    )
  }

  await testDb
    .insert(operators)
    .values([
      { id: BEST_CAR_RENTAL_OPERATOR_ID, slug: BEST_CAR_RENTAL_SLUG, name: BEST_CAR_RENTAL_NAME },
      { id: SECOND_OPERATOR_ID, slug: SECOND_OPERATOR_SLUG, name: SECOND_OPERATOR_NAME },
    ])
    .onConflictDoNothing()
}
