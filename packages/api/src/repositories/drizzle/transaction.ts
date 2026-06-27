import type { RunTx } from '@kuruma/shared/db'
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
import {
  type PhotoDecoder,
  type PhotoEncoder,
  asTxDb,
  identityPhotoDecoder,
  identityPhotoEncoder,
} from './shared'
import { DrizzleUserRepository } from './user'
import { DrizzleVehicleRepository } from './vehicle'
import { DrizzleVehicleBlockRepository } from './vehicle-block'
import { DrizzleVehicleClassRepository } from './vehicle-class'

export function createDrizzleTransaction(
  runInteractiveTx: RunTx,
  // #1000: thread the SAME photo codecs the non-tx vehicle repo gets (#879) so a
  // tx-bound read decodes r2:<key> refs and a tx-bound write re-encodes wire URLs.
  // Before this the tx repo always defaulted to identity — a latent r2: leak /
  // spoof-guard bypass the day a tx caller touches vehicle.photos. The composition
  // root passes the real codecs; identity defaults stay only for photo-agnostic
  // test callers (booking bundle), mirroring the repo ctor's own default.
  decodePhotos: PhotoDecoder = identityPhotoDecoder,
  encodePhotos: PhotoEncoder = identityPhotoEncoder,
): RunInTransaction {
  // Slice 6 (#392) widens the bundle to all 7 tx-bound repos so the single-
  // transaction booking submit (proposal §4) can validate availability, append
  // the BOOKING_CREATED event, and read vehicle/location/insurance/fee rows at a
  // consistent point-in-time. MaintenanceService still uses only the first two.
  return async (fn) =>
    // runInteractiveTx (runTx in prod) opens a per-call neon-serverless
    // transaction (#493): the neon-http driver getDb() uses can't run
    // interactive transactions on CF Workers.
    runInteractiveTx(async (tx) => {
      const txDb = asTxDb(tx)
      return fn({
        vehicleRepo: new DrizzleVehicleRepository(txDb, decodePhotos, encodePhotos),
        maintenanceLogRepo: new DrizzleMaintenanceLogRepository(txDb),
        bookingRepo: new DrizzleBookingRepository(txDb),
        bookingEventRepo: new DrizzleBookingEventRepository(txDb),
        locationRepo: new DrizzleLocationRepository(txDb),
        insuranceOptionRepo: new DrizzleInsuranceOptionRepository(txDb),
        addOnRepo: new DrizzleAddOnRepository(txDb),
        feeScheduleRepo: new DrizzleFeeScheduleRepository(txDb),
        userRepo: new DrizzleUserRepository(txDb), // #875: walk-in renter, tx-bound
        // #464 2d.1: CLASS_COMBO submit reads in-tx so concurrent rate edits /
        // class reassignments can't race the demand → capacity → insert window.
        availabilityRepo: new DrizzleAvailabilityRepository(txDb, decodePhotos),
        classRatePlanRepo: new DrizzleClassRatePlanRepository(txDb),
        vehicleClassRepo: new DrizzleVehicleClassRepository(txDb, decodePhotos, encodePhotos),
        // #1101: tx-bound so the booking-vs-block NOT EXISTS reads the same
        // point-in-time snapshot as the insert that follows it.
        vehicleBlockRepo: new DrizzleVehicleBlockRepository(txDb),
      })
    })
}
