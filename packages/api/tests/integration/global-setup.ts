import {
  BEST_CAR_RENTAL_NAME,
  BEST_CAR_RENTAL_OPERATOR_ID,
  BEST_CAR_RENTAL_SLUG,
} from '@kuruma/shared/db/constants'
import { operators } from '@kuruma/shared/db/schema'
import { testDb } from './pg-test-client'

// Slice 1 (#386) made vehicles.operatorId / vehicle_classes.operatorId NOT
// NULL with an FK to operators. Every integration test that seeds a vehicle or
// class needs the transitional Best Car Rental operator to exist and must pass
// its operatorId explicitly — #401 removed the silent resolveOperatorIdForWrite
// fall-back. Seed it once per run; idempotent so reruns against a warm DB are safe.
export async function setup(): Promise<void> {
  await testDb
    .insert(operators)
    .values({
      id: BEST_CAR_RENTAL_OPERATOR_ID,
      slug: BEST_CAR_RENTAL_SLUG,
      name: BEST_CAR_RENTAL_NAME,
    })
    .onConflictDoNothing()
}
