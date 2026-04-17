import type { RunInTransaction } from '../types'
import type { Db } from './shared'
import { DrizzleMaintenanceLogRepository } from './maintenance-log'
import { DrizzleVehicleRepository } from './vehicle'

export function createDrizzleTransaction(db: Db): RunInTransaction {
  // Drizzle's tx exposes the same query-builder API (select/insert/update/delete)
  // as db. The cast is safe because repos only use those methods. If Db ever gains
  // a method tx lacks (e.g. nested transactions), this will fail at runtime — revisit
  // if Drizzle ships a Transaction utility type.
  return async (fn) =>
    db.transaction(async (tx) =>
      fn({
        vehicleRepo: new DrizzleVehicleRepository(tx as unknown as Db),
        maintenanceLogRepo: new DrizzleMaintenanceLogRepository(tx as unknown as Db),
      }),
    )
}
