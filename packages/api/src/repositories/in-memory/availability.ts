import { isRoadLegal, jstDateString } from '@kuruma/shared/lib/compliance'
import { SYSTEM_CONTEXT } from '../../middleware/auth'
import type { Booking, Vehicle } from '../../stores'
import type {
  AvailabilityFilters,
  AvailabilityRepository,
  BookingRepository,
  VehicleRepository,
} from '../types'
import { BLOCKING_STATUSES, getConflictingBookings } from './booking'

export class InMemoryAvailabilityRepository implements AvailabilityRepository {
  constructor(
    private readonly vehicleRepo: VehicleRepository,
    private readonly bookingRepo: BookingRepository,
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

    return vehicles.filter((vehicle) => {
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

    return {
      available: conflicts.length === 0,
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

  async countClassCapacity(
    operatorId: string,
    classId: string,
    pickupLocationId: string,
    asOf: Date,
  ): Promise<number> {
    // #464 2d.2: road-legal supply side of the combo guard. RETIRED is the
    // permanent fleet exit (never counts); MAINTENANCE is temporary and still
    // belongs to the class fleet (counts). Doc-validity uses the same JST
    // clock as findAvailableVehicles (§4 "one clock").
    const { data: vehicles } = await this.vehicleRepo.findAll(SYSTEM_CONTEXT, {})
    const asOfIso = jstDateString(asOf)
    return vehicles.filter(
      (v) =>
        v.operatorId === operatorId &&
        v.classId === classId &&
        v.pickupLocationId === pickupLocationId &&
        v.status !== 'RETIRED' &&
        isRoadLegal(v, asOfIso),
    ).length
  }
}
