import { getDb } from '../packages/shared/src/db'
import { seedBookings } from '../packages/shared/src/db/seed-bookings'

// CLI entry for `bun run db:seed-bookings` — run AFTER db:seed (needs the seeded
// fleet). Seeds the Neon DATABASE_URL; CI uses scripts/seed-tcp.ts for a local DB.
seedBookings(getDb())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Seed bookings failed:', err)
    process.exit(1)
  })
