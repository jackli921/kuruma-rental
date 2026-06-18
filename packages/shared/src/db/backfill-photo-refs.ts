import { eq } from 'drizzle-orm'
import { wireUrlsToStoredRefs } from '../lib/photo-ref'
import type { getDb } from './index'
import { vehicleClasses, vehicles } from './schema'

type Db = ReturnType<typeof getDb>

export interface PhotoRefBackfillReport {
  /** vehicles rows whose `photos` array gained at least one r2:<key> ref. */
  vehiclesRewritten: number
  /** vehicle_classes rows likewise rewritten. */
  vehicleClassesRewritten: number
}

/**
 * One-off, idempotent backfill (#879 Slice 4): rewrite legacy `photos` rows that
 * stored a resolved public URL (`${base}/<key>`) into the canonical stored form
 * (`r2:<key>`). External image URLs and rows already in r2: form pass through
 * untouched — the decision is the pure {@link wireUrlsToStoredRefs} codec, so a
 * second run is a no-op (a stored `r2:` ref is not one of our wire URLs and is
 * never re-encoded). This function is the thin DB shell: read photos -> encode
 * -> write only the rows that changed -> report.
 *
 * Injectable (DIP) like the other backfills: pass production's neon-http
 * `getDb()` or a TCP postgres-js handle. `publicBaseUrl` MUST be the same
 * `VEHICLE_PHOTOS_PUBLIC_URL` the repos resolve with, or our URLs won't match.
 * `updatedAt` is deliberately not touched — this is a storage-format migration,
 * not a content edit.
 */
export async function backfillPhotoRefs(
  db: Db,
  publicBaseUrl: string,
): Promise<PhotoRefBackfillReport> {
  const vehicleRows = await db.select({ id: vehicles.id, photos: vehicles.photos }).from(vehicles)
  let vehiclesRewritten = 0
  for (const row of vehicleRows) {
    const encoded = wireUrlsToStoredRefs(row.photos, publicBaseUrl)
    if (changed(encoded, row.photos)) {
      await db.update(vehicles).set({ photos: encoded }).where(eq(vehicles.id, row.id))
      vehiclesRewritten += 1
    }
  }

  const classRows = await db
    .select({ id: vehicleClasses.id, photos: vehicleClasses.photos })
    .from(vehicleClasses)
  let vehicleClassesRewritten = 0
  for (const row of classRows) {
    const encoded = wireUrlsToStoredRefs(row.photos, publicBaseUrl)
    if (changed(encoded, row.photos)) {
      await db.update(vehicleClasses).set({ photos: encoded }).where(eq(vehicleClasses.id, row.id))
      vehicleClassesRewritten += 1
    }
  }

  return { vehiclesRewritten, vehicleClassesRewritten }
}

/** True when encoding produced a different array (same length — map is 1:1). */
function changed(encoded: readonly string[], original: readonly string[]): boolean {
  return encoded.some((entry, i) => entry !== original[i])
}
