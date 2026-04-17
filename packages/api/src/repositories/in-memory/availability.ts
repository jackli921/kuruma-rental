import { SYSTEM_CONTEXT } from '../../middleware/auth'
import type { Booking, Vehicle } from '../../stores'
import type { AvailabilityRepository, BookingRepository, VehicleRepository } from '../types'
import { getConflictingBookings } from './booking'

export class InMemoryAvailabilityRepository implements AvailabilityRepository {
  constructor(
    private readonly vehicleRepo: VehicleRepository,
    private readonly bookingRepo: BookingRepository,
  ) {}

  async countClassAvailability(
    classId: string,
    from: Date,
    to: Date,
  ): Promise<{ total: number; available: number }> {
    const { data: all } = await this.vehicleRepo.findAll({ includeRetired: true })
    const inClass = all.filter((v) => v.classId === classId && v.status !== 'RETIRED')
    const total = inClass.length
    if (total === 0) return { total: 0, available: 0 }

    const allBookings = await this.bookingRepo.findAll(SYSTEM_CONTEXT)
    const available = inClass.filter((v) => {
      if (v.status !== 'AVAILABLE') return false
      const conflicts = getConflictingBookings(allBookings, v.id, v.bufferMinutes, from, to)
      return conflicts.length === 0
    }).length
    return { total, available }
  }

  async findAvailableVehicles(from: Date, to: Date): Promise<Vehicle[]> {
    const { data: vehicles } = await this.vehicleRepo.findAll({ status: 'AVAILABLE' })
    const allBookings = await this.bookingRepo.findAll(SYSTEM_CONTEXT)

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

    const allBookings = await this.bookingRepo.findAll(SYSTEM_CONTEXT)
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
