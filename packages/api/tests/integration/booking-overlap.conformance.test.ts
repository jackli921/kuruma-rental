import { BEST_CAR_RENTAL_OPERATOR_ID } from '@kuruma/shared/db/constants'
import { bookings } from '@kuruma/shared/db/schema'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll } from 'vitest'
import { describeBookingOverlapConformance } from '../../src/repositories/booking-overlap-conformance'
import { DrizzleBookingRepository } from '../../src/repositories/drizzle'
import { seedRenter, seedVehicle } from './booking-factory'
import {
  cleanupLocations,
  cleanupUsers,
  cleanupVehicleClasses,
  cleanupVehicles,
  db,
  seedLocation,
  seedVehicleClass,
} from './setup'

// Drizzle arm of the cross-impl conformance suite (#1106). Seeds the FK chain
// once (operator is pre-seeded by global-setup; class + location + vehicle +
// renter here), and clears every test's bookings via the renter id between
// scenarios so each `it` starts from the same baseline against real Postgres.
// The InMemory arm lives at src/repositories/in-memory/booking-overlap.conformance.test.ts
// and runs in the unit lane — both bodies come from the same describe-emitter.

const repo = new DrizzleBookingRepository(db)

let classId: string
let locationId: string
let vehicleId: string
let renterId: string

beforeAll(async () => {
  const klass = await seedVehicleClass('conformance')
  classId = klass.id
  const location = await seedLocation('conformance')
  locationId = location.id
  vehicleId = await seedVehicle({
    operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
    classId,
    pickupLocationId: locationId,
    name: 'Conformance Vehicle',
    dailyRateJpy: 5000,
  })
  renterId = await seedRenter('conformance')
})

afterAll(async () => {
  await cleanupVehicles([vehicleId])
  await cleanupVehicleClasses([classId])
  await cleanupLocations([locationId])
  await cleanupUsers([renterId])
})

describeBookingOverlapConformance({
  adapterName: 'Drizzle (real pg)',
  setup: async () => ({
    repo,
    ids: {
      operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
      classId,
      locationId,
      vehicleId,
      renterId,
    },
    cleanup: async () => {
      // Each `it` may leave 1-2 booking rows the next test would collide with
      // on bookingCode or idempotencyKey. Delete by renter so the next scenario
      // starts from an empty fixture-bookings baseline. The renter row itself
      // is torn down in afterAll.
      await db.delete(bookings).where(eq(bookings.renterId, renterId))
    },
  }),
})
