import type { RunTx } from '@kuruma/shared/db'
import { sql } from 'drizzle-orm'
import type { RunInTransaction } from '../types'
import { DrizzleAddOnRepository } from './add-on'
import { DrizzleAvailabilityRepository } from './availability'
import { DrizzleBookingRepository } from './booking'
import { DrizzleBookingEventRepository } from './booking-event'
import { DrizzleClassRatePlanRepository } from './class-rate-plan'
import { DrizzleFeeScheduleRepository } from './fee-schedule'
import { DrizzleInsuranceOptionRepository } from './insurance-option'
import { DrizzleLocationRepository } from './location'
import { DrizzleMaintenanceLogRepository } from './maintenance-log'
import { asTxDb } from './shared'
import { DrizzleVehicleRepository } from './vehicle'

// #464 slice 2: a dedicated advisory-lock namespace (the FIRST of the two int4
// args — §4.2 #4) so the class-capacity lock can never collide with another
// advisory-lock class. The SECOND int4 is hashtext(operator:location:class).
const CLASS_CAPACITY_ADVISORY_NAMESPACE = 464

export function createDrizzleTransaction(runInteractiveTx: RunTx): RunInTransaction {
  // Slice 6 (#392) widened this bundle so the single-transaction booking submit
  // (proposal §4) can validate availability, append BOOKING_CREATED, and read
  // vehicle/location/insurance/fee rows at a consistent point-in-time. #464 slice
  // 2 adds availability + class-rate-plan reads and the capacity advisory lock, so
  // count-then-insert is serialised on the SAME connection that holds the lock.
  return async (fn) =>
    // runInteractiveTx (runTx in prod) opens a per-call neon-serverless
    // transaction (#493): the neon-http driver getDb() uses can't run
    // interactive transactions on CF Workers.
    runInteractiveTx(async (tx) => {
      const txDb = asTxDb(tx)
      return fn({
        vehicleRepo: new DrizzleVehicleRepository(txDb),
        maintenanceLogRepo: new DrizzleMaintenanceLogRepository(txDb),
        bookingRepo: new DrizzleBookingRepository(txDb),
        bookingEventRepo: new DrizzleBookingEventRepository(txDb),
        locationRepo: new DrizzleLocationRepository(txDb),
        insuranceOptionRepo: new DrizzleInsuranceOptionRepository(txDb),
        addOnRepo: new DrizzleAddOnRepository(txDb),
        feeScheduleRepo: new DrizzleFeeScheduleRepository(txDb),
        availabilityRepo: new DrizzleAvailabilityRepository(txDb),
        classRatePlanRepo: new DrizzleClassRatePlanRepository(txDb),
        // #464: hold the per-(operator, location, class) capacity lock until this
        // tx commits — orders concurrent count-then-insert so two floats can't both
        // pass `demand < capacity` for the last car (proposal §4.2 #4/#5).
        acquireClassCapacityLock: async (operatorId, pickupLocationId, classId) => {
          const key = `${operatorId}:${pickupLocationId}:${classId}`
          await txDb.execute(
            sql`SELECT pg_advisory_xact_lock(${CLASS_CAPACITY_ADVISORY_NAMESPACE}::int4, hashtext(${key}))`,
          )
        },
      })
    })
}
