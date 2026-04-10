export type { Vehicle, Booking } from '../stores'
export type { DashboardStats } from '@kuruma/shared/types/stats'

import type { DashboardStats } from '@kuruma/shared/types/stats'
import type { Booking, Vehicle } from '../stores'

export interface VehicleRepository {
  findAll(filters?: { status?: string }): Promise<Vehicle[]>
  findById(id: string): Promise<Vehicle | undefined>
  create(data: Omit<Vehicle, 'id' | 'createdAt' | 'updatedAt'>): Promise<Vehicle>
  update(id: string, data: Partial<Vehicle>): Promise<Vehicle | undefined>
  softDelete(id: string): Promise<Vehicle | undefined>
}

export interface BookingRepository {
  findAll(filters?: { status?: string; vehicleId?: string; renterId?: string; from?: Date; to?: Date }): Promise<Booking[]>
  findById(id: string): Promise<Booking | undefined>
  create(data: Omit<Booking, 'id' | 'createdAt' | 'updatedAt'>): Promise<Booking>
  updateStatus(id: string, status: string): Promise<Booking | undefined>
}

export interface StatsRepository {
  getDashboardStats(): Promise<DashboardStats>
}

export interface AvailabilityRepository {
  findAvailableVehicles(from: Date, to: Date): Promise<Vehicle[]>
  checkVehicleAvailability(
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
  >
}
