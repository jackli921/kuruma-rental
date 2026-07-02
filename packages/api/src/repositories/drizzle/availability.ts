import { bookings, operators, vehicleBlocks, vehicles } from '@kuruma/shared/db/schema'
import { jstDateString } from '@kuruma/shared/lib/compliance'
import { type SQL, and, eq, inArray, sql } from 'drizzle-orm'
import type { Booking, Vehicle } from '../../stores'
import type { AvailabilityFilters, AvailabilityRepository } from '../types'
import {
  type Db,
  type PhotoDecoder,
  bookingColumns,
  identityPhotoDecoder,
  toBooking,
  toVehicle,
  vehicleColumns,
} from './shared'

// #1101/#1141: a vehicle is off the calendar when a vehicle_blocks row overlaps
// the requested window — half-open tstzrange overlap (a block ending exactly at
// the window start does not overlap), correlated on vehicles.id. Single source
// of the block-subtraction predicate shared by findAvailableVehicles and
// countClassCapacity. checkVehicleAvailability needs the count (not existence),
// so it keeps its own form.
function blockOverlapNotExists(fromIso: string, toIso: string): SQL {
  return sql`NOT EXISTS (
        SELECT 1 FROM vehicle_blocks vb
        WHERE vb."vehicleId" = ${vehicles.id}
        AND tstzrange(vb."startAt", vb."endAt") && tstzrange(${fromIso}::timestamptz, ${toIso}::timestamptz)
      )`
}

export class DrizzleAvailabilityRepository implements AvailabilityRepository {
  constructor(
    private readonly db: Db,
    private readonly decodePhotos: PhotoDecoder = identityPhotoDecoder,
  ) {}

  async findAvailableVehicles(
    from: Date,
    to: Date,
    filters?: AvailabilityFilters,
  ): Promise<Vehicle[]> {
    const fromIso = from.toISOString()
    const toIso = to.toISOString()
    // §5.2 (#916): both documents must be valid THROUGH the requested return
    // date — the same JST clock as the direct/create gates (§4 time basis). A
    // NULL column yields `NULL >= asOf` = NULL = excluded, so UNKNOWN docs are
    // gated for free (mirrors `isRoadLegal`'s null handling).
    const asOf = jstDateString(to)

    const conditions: SQL[] = [
      eq(vehicles.status, 'AVAILABLE'),
      sql`${vehicles.shakenExpiryDate} >= ${asOf}::date AND ${vehicles.insuranceExpiryDate} >= ${asOf}::date`,
      sql`NOT EXISTS (
            SELECT 1 FROM bookings b
            WHERE b."assignedVehicleId" = ${vehicles.id}
            AND b.status IN ('CONFIRMED', 'ACTIVE')
            AND tstzrange(b."startAt", b."effectiveEndAt") && tstzrange(${fromIso}::timestamptz, ${toIso}::timestamptz)
          )`,
      // #1101: subtract scheduled blocks — a vehicle with a block overlapping the
      // requested window is off the calendar (maintenance / out-of-service /
      // manual hold); mirrored by the in-memory path.
      blockOverlapNotExists(fromIso, toIso),
      // #1224: hide a soft-deactivated operator's cars — correlated existence on
      // operatorId. A deactivated operator (operators.deactivatedAt set) removes all
      // its vehicles from availability, closing the /availability + class-availability
      // info-disclosure gap left by #1206. NOT EXISTS keeps orphan vehicles (no
      // operators row) available, matching the in-memory path; mirrors the storefront
      // seam that already drops deactivated operators from the public catalog.
      sql`NOT EXISTS (
            SELECT 1 FROM ${operators} o
            WHERE o.id = ${vehicles.operatorId}
            AND o."deactivatedAt" IS NOT NULL
          )`,
    ]
    // Storefront scope (#391): INNER match on the nullable pickupLocationId — a
    // vehicle with no assigned location matches no locationId, so it is
    // invisible to storefront search (§9 item 8). Additive; existing callers
    // pass no filter and scan the whole fleet unchanged.
    if (filters?.locationId) conditions.push(eq(vehicles.pickupLocationId, filters.locationId))
    // Region scope (#651 §1c): bound the scan to the in-region storefronts via the
    // idx_vehicles_pickupLocationId index. An empty set means "no in-region
    // storefront" → no vehicles (mirrors DrizzleStorefrontRepository's regionIds
    // short-circuit). A null pickupLocationId is never IN the set.
    if (filters?.locationIds) {
      if (filters.locationIds.length === 0) return []
      conditions.push(inArray(vehicles.pickupLocationId, filters.locationIds))
    }
    if (filters?.operatorId) conditions.push(eq(vehicles.operatorId, filters.operatorId))
    if (filters?.classId) conditions.push(eq(vehicles.classId, filters.classId))

    const rows = await this.db
      .select(vehicleColumns)
      .from(vehicles)
      .where(and(...conditions))
    return rows.map((r) => toVehicle(r, this.decodePhotos))
  }

  async checkVehicleAvailability(
    vehicleId: string,
    from: Date,
    to: Date,
  ): Promise<{ available: boolean; vehicle: Vehicle; conflicts: Booking[] } | undefined> {
    const [vehicle] = await this.db
      .select(vehicleColumns)
      .from(vehicles)
      .where(
        and(
          eq(vehicles.id, vehicleId),
          // #1268: a targeted lookup by a known vehicleId must not leak a
          // soft-deactivated operator's car — same NOT EXISTS(operators …
          // deactivatedAt) seam as findAvailableVehicles above. No row -> not_found.
          // Orphan vehicles (no operators row) are kept, matching that predicate.
          sql`NOT EXISTS (
                SELECT 1 FROM ${operators} o
                WHERE o.id = ${vehicles.operatorId}
                AND o."deactivatedAt" IS NOT NULL
              )`,
        ),
      )

    if (!vehicle) return undefined

    const fromIso = from.toISOString()
    const toIso = to.toISOString()

    const conflicts = await this.db
      .select(bookingColumns)
      .from(bookings)
      .where(
        and(
          eq(bookings.assignedVehicleId, vehicleId),
          sql`status IN ('CONFIRMED', 'ACTIVE')`,
          sql`tstzrange("startAt", "effectiveEndAt") && tstzrange(${fromIso}::timestamptz, ${toIso}::timestamptz)`,
        ),
      )

    // #1101: a scheduled block makes the car unavailable too. Counted separately
    // (blocks are NOT bookings — they stay out of `conflicts`, only flipping
    // `available`); same half-open overlap as the booking guard.
    const [blockOverlap] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(vehicleBlocks)
      .where(
        and(
          eq(vehicleBlocks.vehicleId, vehicleId),
          sql`tstzrange("startAt", "endAt") && tstzrange(${fromIso}::timestamptz, ${toIso}::timestamptz)`,
        ),
      )

    return {
      available: conflicts.length === 0 && (blockOverlap?.count ?? 0) === 0,
      vehicle: toVehicle(vehicle, this.decodePhotos),
      conflicts: conflicts.map(toBooking),
    }
  }

  async countClassDemand(
    operatorId: string,
    classId: string,
    pickupLocationId: string,
    from: Date,
    to: Date,
  ): Promise<number> {
    const fromIso = from.toISOString()
    const toIso = to.toISOString()
    // Same blocking-status + tstzrange overlap predicate as checkVehicleAvailability
    // / 0037.sql, keyed on the (operator, class, location) triple — a floating
    // CLASS_COMBO (null assignedVehicleId) is counted via bookings.classId.
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(bookings)
      .where(
        and(
          eq(bookings.operatorId, operatorId),
          eq(bookings.classId, classId),
          eq(bookings.pickupLocationId, pickupLocationId),
          sql`status IN ('CONFIRMED', 'ACTIVE')`,
          sql`tstzrange("startAt", "effectiveEndAt") && tstzrange(${fromIso}::timestamptz, ${toIso}::timestamptz)`,
          // #1268: keep the demand seam consistent with the capacity seam — a
          // soft-deactivated operator contributes no demand either, so the pair
          // stays symmetric and neither becomes a latent caller-dependent hole.
          sql`NOT EXISTS (
                SELECT 1 FROM ${operators} o
                WHERE o.id = ${bookings.operatorId}
                AND o."deactivatedAt" IS NOT NULL
              )`,
        ),
      )
    return row?.count ?? 0
  }

  async lockComboCapacity(
    operatorId: string,
    classId: string,
    pickupLocationId: string,
  ): Promise<() => void> {
    // #464 2d.4: serialize concurrent CLASS_COMBO submits on the (op, class,
    // loc) triple. hashtextextended yields a stable 64-bit int from the keyed
    // string for Postgres' single-arg advisory lock; auto-released at tx
    // commit/rollback, so the returned thunk is a no-op.
    const key = `combo:${operatorId}|${classId}|${pickupLocationId}`
    await this.db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`)
    return () => {}
  }

  async countClassCapacity(
    operatorId: string,
    classId: string,
    pickupLocationId: string,
    from: Date,
    to: Date,
    asOf: Date,
  ): Promise<number> {
    // #464 2d.2 / #1193: road-legal supply side of the combo guard. Counts only
    // status = 'AVAILABLE' — the exact predicate the assign gate enforces, and
    // the same one findAvailableVehicles uses. RETIRED (permanent exit) and
    // MAINTENANCE (temporary, unassignable, no known return) both fail it;
    // counting either admits a float with no assignable car → overbook. Both
    // certificates must cover THROUGH the JST asOf day — same NULL≠current
    // handling as findAvailableVehicles (NULL >= date is NULL, excluded).
    const asOfIso = jstDateString(asOf)
    const fromIso = from.toISOString()
    const toIso = to.toISOString()
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(vehicles)
      .where(
        and(
          eq(vehicles.operatorId, operatorId),
          eq(vehicles.classId, classId),
          eq(vehicles.pickupLocationId, pickupLocationId),
          eq(vehicles.status, 'AVAILABLE'),
          sql`${vehicles.shakenExpiryDate} >= ${asOfIso}::date AND ${vehicles.insuranceExpiryDate} >= ${asOfIso}::date`,
          // #1141: subtract cars scheduled off for the demand window — a block
          // overlapping [from, to) makes the car unavailable, so it is not real
          // class supply. Shares the predicate with findAvailableVehicles; the
          // in-memory path mirrors it.
          blockOverlapNotExists(fromIso, toIso),
          // #1268: a soft-deactivated operator produces zero real class supply.
          // Today the CLASS_COMBO producer only reaches here for operators the
          // findActiveStorefronts seam already kept, but enforcing it in the data
          // (not the caller) closes the latent hole a future caller would reopen.
          // NOT EXISTS keeps orphan vehicles, matching findAvailableVehicles.
          sql`NOT EXISTS (
                SELECT 1 FROM ${operators} o
                WHERE o.id = ${vehicles.operatorId}
                AND o."deactivatedAt" IS NOT NULL
              )`,
        ),
      )
    return row?.count ?? 0
  }
}
