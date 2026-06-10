import type { RunTx } from '@kuruma/shared/db'
import type { RunInTransaction } from '../types'
import { DrizzleAddOnRepository } from './add-on'
import { DrizzleBookingRepository } from './booking'
import { DrizzleBookingEventRepository } from './booking-event'
import { DrizzleFeeScheduleRepository } from './fee-schedule'
import { DrizzleInsuranceOptionRepository } from './insurance-option'
import { DrizzleLocationRepository } from './location'
import { DrizzleMaintenanceLogRepository } from './maintenance-log'
import type { Db } from './shared'
import { DrizzleVehicleRepository } from './vehicle'

export function createDrizzleTransaction(runInteractiveTx: RunTx): RunInTransaction {
  // Drizzle's tx exposes the same query-builder API (select/insert/update/delete)
  // as db. The cast is safe because repos only use those methods. If Db ever gains
  // a method tx lacks (e.g. nested transactions), this will fail at runtime — revisit
  // if Drizzle ships a Transaction utility type.
  //
  // Slice 6 (#392) widens the bundle to all 7 tx-bound repos so the single-
  // transaction booking submit (proposal §4) can validate availability, append
  // the BOOKING_CREATED event, and read vehicle/location/insurance/fee rows at a
  // consistent point-in-time. MaintenanceService still uses only the first two.
  return async (fn) =>
    // runInteractiveTx (runTx in prod) opens a per-call neon-serverless
    // transaction (#493): the neon-http driver getDb() uses can't run
    // interactive transactions on CF Workers.
    runInteractiveTx(async (tx) => {
      const txDb = tx as unknown as Db
      return fn({
        vehicleRepo: new DrizzleVehicleRepository(txDb),
        maintenanceLogRepo: new DrizzleMaintenanceLogRepository(txDb),
        bookingRepo: new DrizzleBookingRepository(txDb),
        bookingEventRepo: new DrizzleBookingEventRepository(txDb),
        locationRepo: new DrizzleLocationRepository(txDb),
        insuranceOptionRepo: new DrizzleInsuranceOptionRepository(txDb),
        addOnRepo: new DrizzleAddOnRepository(txDb),
        feeScheduleRepo: new DrizzleFeeScheduleRepository(txDb),
      })
    })
}
