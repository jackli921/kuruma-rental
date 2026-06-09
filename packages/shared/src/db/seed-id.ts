import { createHash } from 'node:crypto'

/**
 * Map a readable fixture slug (e.g. `loc_best_kix`) to a STABLE UUID.
 *
 * The demo seed-data keeps human-readable slug ids for cross-referencing, but the
 * app's real ids are UUIDs (`crypto.randomUUID()` defaults) and every FK is
 * validated as `z.string().uuid()` at the API boundary (validators/booking.ts,
 * vehicle.ts, fee-schedule.ts, …). Seeding raw slugs makes read paths work but
 * the live booking POST 400s on `requestedVehicleId`/`pickupLocationId`. So the
 * seed orchestrators run every id + FK through this mapper.
 *
 * Deterministic (SHA-256 of the slug, formatted as a v4-shaped UUID so
 * `z.uuid()` accepts it): the same slug always yields the same UUID, which keeps
 * `onConflictDoUpdate(target: id)` idempotent and lets the two seed scripts
 * resolve each other's FKs without sharing state.
 */
export function seedId(slug: string): string {
  const h = createHash('sha256').update(slug).digest('hex')
  // Force the version (4) and variant (8-b) nibbles to a valid RFC-4122 layout.
  const variant = ((Number.parseInt(h.charAt(16), 16) & 0x3) | 0x8).toString(16)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`
}
