import { getDb } from '../packages/shared/src/db'
import { seed } from '../packages/shared/src/db/seed'

// CLI entry for `bun run db:seed` — seeds the Neon DATABASE_URL via the
// production neon-http getDb(). The seeding logic is the pure, injectable seed()
// in @kuruma/shared; CI seeds a local container instead via scripts/seed-tcp.ts.
//
// Pin the OWNER url explicitly (not the DATABASE_URL_RUNTIME the app prefers):
// seed cleanup deletes consent_acceptances rows, which the reduced-privilege
// runtime role is forbidden to do (#1553 append-only seal). Seed is a break-glass
// tool and runs as owner.
seed(getDb(process.env.DATABASE_URL))
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Seed failed:', err)
    process.exit(1)
  })
