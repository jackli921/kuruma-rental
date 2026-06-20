import { getDb } from '../packages/shared/src/db'
import { backfillVehicleExpiry } from '../packages/shared/src/db/backfill-vehicle-expiry'

// CLI entry for `bun run db:backfill-vehicle-expiry [--dry-run]` — stamp a future
// shaken/insurance date onto any vehicle whose column is NULL, against the Neon
// DATABASE_URL (#991). Required before every `develop → beta` promotion: the
// #916 road-legal gate hides NULL-doc vehicles, and beta's seeded fleet has NULL
// insurance, so an un-backfilled promotion silently empties the storefront.
// Idempotent — re-running once no NULL rows remain is a no-op. `--dry-run` only
// counts what it would touch (the pre-flight check), writing nothing.
const dryRun = process.argv.includes('--dry-run')

backfillVehicleExpiry(getDb(), { dryRun })
  .then((report) => {
    const verb = dryRun ? 'would stamp' : 'stamped'
    console.log(
      `Vehicle-expiry backfill ${dryRun ? '(dry run) ' : ''}complete: ${verb} ` +
        `${report.shakenStamped} NULL shaken and ${report.insuranceStamped} NULL insurance date(s).`,
    )
    process.exit(0)
  })
  .catch((err) => {
    console.error('Vehicle-expiry backfill failed:', err)
    process.exit(1)
  })
