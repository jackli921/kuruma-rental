import { getDb } from '../packages/shared/src/db'
import { backfillPhotoRefs } from '../packages/shared/src/db/backfill-photo-refs'

// CLI entry for `bun run db:backfill-photo-refs` — rewrite legacy resolved photo
// URLs (`${VEHICLE_PHOTOS_PUBLIC_URL}/<key>`) into canonical r2:<key> stored refs
// against the Neon DATABASE_URL (#879 Slice 4). Idempotent: externals and rows
// already in r2: form pass through. The migration logic is the pure, injectable
// backfillPhotoRefs in @kuruma/shared.
const publicBaseUrl = process.env.VEHICLE_PHOTOS_PUBLIC_URL
if (!publicBaseUrl) {
  console.error(
    'VEHICLE_PHOTOS_PUBLIC_URL is required — it is the base whose URLs collapse to r2: refs.',
  )
  process.exit(1)
}

backfillPhotoRefs(getDb(), publicBaseUrl)
  .then((report) => {
    console.log(
      `Photo-ref backfill complete: ${report.vehiclesRewritten} vehicle(s) and ` +
        `${report.vehicleClassesRewritten} class(es) rewritten to r2: refs.`,
    )
    process.exit(0)
  })
  .catch((err) => {
    console.error('Photo-ref backfill failed:', err)
    process.exit(1)
  })
