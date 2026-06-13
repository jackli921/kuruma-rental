import { SYSTEM_CONTEXT } from '../../middleware/auth'
import type { Booking, Vehicle } from '../../stores'
import type {
  AvailabilityFilters,
  AvailabilityRepository,
  BookingRepository,
  VehicleRepository,
} from '../types'
import { getConflictingBookings } from './booking'

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
    const { data: vehicles } = await this.vehicleRepo.findAll(SYSTEM_CONTEXT, {
      status: 'AVAILABLE',
    })
    const allBookings = await this.bookingRepo.findAll(SYSTEM_CONTEXT)

    return vehicles.filter((vehicle) => {
      // Storefront scope (#391): a null pickupLocationId never matches a
      // locationId filter, so unassigned vehicles are invisible to search.
      if (filters?.locationId && vehicle.pickupLocationId !== filters.locationId) return false
      // Region scope (#651 §1c): bound to a set of locations. Empty set or a null
      // pickupLocationId matches nothing — mirrors the singular locationId above.
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
}
