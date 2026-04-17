import type { RunInTransaction } from '../types'
import type { Db } from './shared'
import { DrizzleMaintenanceLogRepository } from './maintenance-log'
import { DrizzleVehicleRepository } from './vehicle'

export function createDrizzleTransaction(db: Db): RunInTransaction {
  return async (fn) =>
    db.transaction(async (tx) =>
      fn({
        vehicleRepo: new DrizzleVehicleRepository(tx as unknown as Db),
        maintenanceLogRepo: new DrizzleMaintenanceLogRepository(tx as unknown as Db),
      }),
    )
}
