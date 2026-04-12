import type { Booking, Vehicle } from '../../stores'
import type { AvailabilityRepository, BookingRepository, VehicleRepository } from '../types'
import { getConflictingBookings } from './booking'

export class InMemoryAvailabilityRepository implements AvailabilityRepository {
  constructor(
    private readonly vehicleRepo: VehicleRepository,
    private readonly bookingRepo: BookingRepository,
  ) {}

  async findAvailableVehicles(from: Date, to: Date): Promise<Vehicle[]> {
    const vehicles = await this.vehicleRepo.findAll({ status: 'AVAILABLE' })
    const allBookings = await this.bookingRepo.findAll()

    return vehicles.filter((vehicle) => {
      const conflicts = getConflictingBookings(
        allBookings,
        vehicle.id,
        vehicle.bufferMinutes,
        from,
        to,
      )
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
    const vehicle = await this.vehicleRepo.findById(vehicleId)
    if (!vehicle) return undefined

    const allBookings = await this.bookingRepo.findAll()
    const conflicts = getConflictingBookings(
      allBookings,
      vehicle.id,
      vehicle.bufferMinutes,
      from,
      to,
    )

    return {
      available: conflicts.length === 0,
      vehicle,
      conflicts,
    }
  }
}
