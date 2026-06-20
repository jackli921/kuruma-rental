import { count, isNull } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import type { getDb } from './index'
import { vehicles } from './schema'

type Db = ReturnType<typeof getDb>

// Mirrors the demo seed's horizons (packages/shared/src/db/seed.ts —
// SHAKEN_VALIDITY_DAYS / INSURANCE_VALIDITY_DAYS), kept independent on purpose:
// this is a one-shot ops script and the §5.2 gate only requires a *future*
// date. Distinct horizons keep the two documents reading as independent cycles.
const SHAKEN_BACKFILL_DAYS = 365
const INSURANCE_BACKFILL_DAYS = 400

export interface VehicleExpiryBackfillReport {
  /** vehicles whose NULL shakenExpiryDate was (or would be) stamped. */
  shakenStamped: number
  /** vehicles whose NULL insuranceExpiryDate was (or would be) stamped. */
  insuranceStamped: number
}

export interface VehicleExpiryBackfillOptions {
  /** Count the NULL rows without writing — the develop→beta pre-flight check. */
  dryRun?: boolean
}

/**
 * One-shot, idempotent backfill (#991). The #916 road-legal gate hides any
 * vehicle whose shaken OR insurance date is NULL or lapsed from the storefront
 * (read-path SQL + service guards). Beta's seeded fleet predates the insurance
 * stamp, so promoting `develop → beta` would silently empty the storefront.
 * This stamps a realistic FUTURE date onto NULL columns only — lapsed (non-null,
 * past) dates are left untouched as genuinely non-compliant for the §5.4 digest
 * to surface. Re-running is a no-op once no NULL rows remain.
 *
 * Injectable (DIP) like the other backfills: pass production's neon-http
 * `getDb()` or a TCP postgres-js handle. `updatedAt` is deliberately not touched
 * — this is a compliance-data fix, not a content edit.
 */
export async function backfillVehicleExpiry(
  db: Db,
  options: VehicleExpiryBackfillOptions = {},
): Promise<VehicleExpiryBackfillReport> {
  const shakenStamped = await countNulls(db, vehicles.shakenExpiryDate)
  const insuranceStamped = await countNulls(db, vehicles.insuranceExpiryDate)

  if (!options.dryRun) {
    if (shakenStamped > 0) {
      await db
        .update(vehicles)
        .set({ shakenExpiryDate: futureDate(SHAKEN_BACKFILL_DAYS) })
        .where(isNull(vehicles.shakenExpiryDate))
    }
    if (insuranceStamped > 0) {
      await db
        .update(vehicles)
        .set({ insuranceExpiryDate: futureDate(INSURANCE_BACKFILL_DAYS) })
        .where(isNull(vehicles.insuranceExpiryDate))
    }
  }

  return { shakenStamped, insuranceStamped }
}

/** Count rows whose `column` is NULL — what the backfill would stamp. */
async function countNulls(db: Db, column: AnyPgColumn): Promise<number> {
  const rows = await db.select({ n: count() }).from(vehicles).where(isNull(column))
  return Number(rows[0]?.n ?? 0)
}

/** A YYYY-MM-DD date `daysOut` in the future (matches the seed's `date` mode). */
function futureDate(daysOut: number): string {
  const expiry = new Date()
  expiry.setDate(expiry.getDate() + daysOut)
  return expiry.toISOString().slice(0, 10)
}
