import { getDb } from '../packages/shared/src/db'
import { seed } from '../packages/shared/src/db/seed'

// CLI entry for `bun run db:seed` — seeds the Neon DATABASE_URL via the
// production neon-http getDb(). The seeding logic is the pure, injectable seed()
// in @kuruma/shared; CI seeds a local container instead via scripts/seed-tcp.ts.
seed(getDb())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Seed failed:', err)
    process.exit(1)
  })
