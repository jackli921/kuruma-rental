import { getDb } from '../packages/shared/src/db'
import { backfillLocationRegions } from '../packages/shared/src/db/backfill-regions'

// CLI entry for `bun run db:backfill-regions` — assigns every region-less ACTIVE
// location to its nearest assignable area against the Neon DATABASE_URL. The
// matching logic is the pure, injectable backfillLocationRegions in @kuruma/shared.
backfillLocationRegions(getDb())
  .then((report) => {
    console.log(`Region backfill complete: ${report.assigned} location(s) assigned.`)
    if (report.unassigned.length > 0) {
      console.warn(
        `${report.unassigned.length} location(s) left unassigned (no assignable area within radius):`,
      )
      for (const id of report.unassigned) console.warn(`  - ${id}`)
    }
    process.exit(0)
  })
  .catch((err) => {
    console.error('Region backfill failed:', err)
    process.exit(1)
  })
