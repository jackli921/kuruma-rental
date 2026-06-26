import { isRoadLegal, jstDateString } from '@kuruma/shared/lib/compliance'
import { SYSTEM_CONTEXT } from '../../middleware/auth'
import type { Booking, Vehicle } from '../../stores'
import type {
  AvailabilityFilters,
  AvailabilityRepository,
  BookingRepository,
  VehicleBlockRepository,
  VehicleRepository,
} from '../types'
import { BLOCKING_STATUSES, getConflictingBookings } from './booking'

export class InMemoryAvailabilityRepository implements AvailabilityRepository {
  // #464 2d.4: per-(op, class, loc) Promise-chain mutex. The tail of each
  // chain is the in-flight holder's release promise; a new acquire awaits
  // the tail and replaces it with its own. Models Postgres' advisory-lock
  // serialize-per-key under a single-threaded event loop.
  private readonly comboLockTails = new Map<string, Promise<void>>()

  constructor(
    private readonly vehicleRepo: VehicleRepository,
    private readonly bookingRepo: BookingRepository,
    // #1101: the block store availability subtracts from (mirrors the Drizzle
    // NOT EXISTS — must-fix #2 parity). Required, not defaulted: constructing a
    // concrete repo here would breach the composition-root boundary, and a
    // shared instance is what makes a block created via the blocks route visible
    // to availability. Suites that never schedule a block pass a fresh empty one.
    private readonly vehicleBlockRepo: VehicleBlockRepository,
  ) {}

  async findAvailableVehicles(
    from: Date,
    to: Date,
    filters?: AvailabilityFilters,
  ): Promise<Vehicle[]> {
    // Region scope (#651 §1c): an empty set means "no in-region storefront" → no
    // vehicles; short-circuit before loading (mirrors the Drizzle path).
    if (filters?.locationIds?.length === 0) return []

    const { data: vehicles } = await this.vehicleRepo.findAll(SYSTEM_CONTEXT, {
      status: 'AVAILABLE',
    })
    const allBookings = await this.bookingRepo.findAll(SYSTEM_CONTEXT)
    // §5.2 (#916): the car must be road-legal THROUGH the requested return date —
    // the same JST clock as the direct/create gates, so a future-dated search
    // never surfaces a car whose docs lapse before `to`.
    const asOf = jstDateString(to)

    const candidates = vehicles.filter((vehicle) => {
      if (!isRoadLegal(vehicle, asOf)) return false
      // Storefront scope (#391): a null pickupLocationId never matches a
      // locationId filter, so unassigned vehicles are invisible to search.
      if (filters?.locationId && vehicle.pickupLocationId !== filters.locationId) return false
      // Region scope (#651 §1c): a null pickupLocationId is never in the set; the
      // empty-set case is short-circuited above.
      if (
        filters?.locationIds &&
        (!vehicle.pickupLocationId || !filters.locationIds.includes(vehicle.pickupLocationId))
      )
        return false
      if (filters?.operatorId && vehicle.operatorId !== filters.operatorId) return false
      if (filters?.classId && vehicle.classId !== filters.classId) return false

      // Turnaround is location-derived now (#392); the vehicle buffer is gone.
      const conflicts = getConflictingBookings(allBookings, vehicle.id, from, to)
      return conflicts.length === 0
    })

    // #1101: subtract scheduled blocks — a vehicle with ANY block overlapping
    // [from, to) is off the calendar. Resolved per-candidate (mirrors the
    // Drizzle NOT EXISTS subquery); Promise.all keeps it off the await-in-loop
    // path even though the in-memory store is a synchronous Map scan.
    const blockHits = await Promise.all(
      candidates.map((v) => this.vehicleBlockRepo.findOverlapping(v.id, from, to)),
    )
    return candidates.filter((_, i) => blockHits[i]!.length === 0)
  }

  async checkVehicleAvailability(
    vehicleId: string,
    from: Date,
    to: Date,
  ): Promise<
    | {
        available: boolean
        vehicle: Vehicle
        conflicts: Booking[]
      }
    | undefined
  > {
    const vehicle = await this.vehicleRepo.findById(SYSTEM_CONTEXT, vehicleId)
    if (!vehicle) return undefined

    const allBookings = await this.bookingRepo.findAll(SYSTEM_CONTEXT)
    const conflicts = getConflictingBookings(allBookings, vehicle.id, from, to)
    // #1101: a scheduled block makes the car unavailable too. Blocks are NOT
    // bookings, so they stay out of `conflicts` — they only flip `available`.
    const blocks = await this.vehicleBlockRepo.findOverlapping(vehicle.id, from, to)

    return {
      available: conflicts.length === 0 && blocks.length === 0,
      vehicle,
      conflicts,
    }
  }

  async countClassDemand(
    operatorId: string,
    classId: string,
    pickupLocationId: string,
    from: Date,
    to: Date,
  ): Promise<number> {
    const allBookings = await this.bookingRepo.findAll(SYSTEM_CONTEXT)
    // Same blocking-status + half-open overlap as getConflictingBookings, but
    // keyed on the (operator, class, location) triple instead of a single car —
    // so a floating CLASS_COMBO (null assignedVehicleId) still counts.
    return allBookings.filter(
      (b) =>
        b.operatorId === operatorId &&
        b.classId === classId &&
        b.pickupLocationId === pickupLocationId &&
        BLOCKING_STATUSES.has(b.status) &&
        b.startAt < to &&
        b.effectiveEndAt > from,
    ).length
  }

  async lockComboCapacity(
    operatorId: string,
    classId: string,
    pickupLocationId: string,
  ): Promise<() => void> {
    const key = `combo:${operatorId}|${classId}|${pickupLocationId}`
    const prev = this.comboLockTails.get(key) ?? Promise.resolve()
    let release: () => void = () => {}
    const held = new Promise<void>((r) => {
      release = r
    })
    // Tail = `held` (not `prev.then(() => held)`) so the per-key chain stops
    // growing unboundedly across many acquisitions; the next waiter only needs
    // to await us, and `prev` ordering is already preserved by `await prev`
    // below. When we release and nobody has taken over, drop the entry so the
    // Map doesn't keep stale (op, class, loc) keys forever (maintainability
    // review 2026-06-24, finding #3).
    this.comboLockTails.set(key, held)
    await prev
    void held.then(() => {
      if (this.comboLockTails.get(key) === held) {
        this.comboLockTails.delete(key)
      }
    })
    return release
  }

  async countClassCapacity(
    operatorId: string,
    classId: string,
    pickupLocationId: string,
    asOf: Date,
    from: Date,
    to: Date,
  ): Promise<number> {
    // #464 2d.2: road-legal supply side of the combo guard. RETIRED is the
    // permanent fleet exit (never counts); MAINTENANCE is temporary and still
    // belongs to the class fleet (counts). Doc-validity uses the same JST
    // clock as findAvailableVehicles (§4 "one clock").
    const { data: vehicles } = await this.vehicleRepo.findAll(SYSTEM_CONTEXT, {})
    const asOfIso = jstDateString(asOf)
    const roadLegal = vehicles.filter(
      (v) =>
        v.operatorId === operatorId &&
        v.classId === classId &&
        v.pickupLocationId === pickupLocationId &&
        v.status !== 'RETIRED' &&
        isRoadLegal(v, asOfIso),
    )

    // #1141: a car scheduled off for the demand window is not real supply — drop
    // any vehicle with a block overlapping [from, to). Mirrors the NOT EXISTS in
    // findAvailableVehicles and the SPECIFIC guard's per-car block check, so the
    // combo guard can't admit a float with no assignable car. Promise.all keeps
    // it off the await-in-loop path even on the synchronous Map scan.
    const blockHits = await Promise.all(
      roadLegal.map((v) => this.vehicleBlockRepo.findOverlapping(v.id, from, to)),
    )
    return roadLegal.filter((_, i) => blockHits[i]!.length === 0).length
  }
}
