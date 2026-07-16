import { getDb } from '../packages/shared/src/db'
import { seedBookings } from '../packages/shared/src/db/seed-bookings'

// CLI entry for `bun run db:seed-bookings` — run AFTER db:seed (needs the seeded
// fleet). Seeds the Neon DATABASE_URL; CI uses scripts/seed-tcp.ts for a local DB.
//
// Pin the OWNER url explicitly (not the DATABASE_URL_RUNTIME the app prefers):
// seed cleanup deletes consent_acceptances rows (seed-bookings.ts:167), which the
// reduced-privilege runtime role is forbidden to do (#1553 append-only seal). Seed
// is a break-glass tool and runs as owner.
seedBookings(getDb(process.env.DATABASE_URL))
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Seed bookings failed:', err)
    process.exit(1)
  })
