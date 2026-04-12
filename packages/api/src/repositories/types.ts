export type { Vehicle, Booking, Thread, ThreadParticipant, Message } from '../stores'
export type { DashboardStats } from '@kuruma/shared/types/stats'
export type { FleetVehicleOverview, FleetBookingSummary } from '@kuruma/shared/types/fleet'
export type { VehicleDetail } from '@kuruma/shared/types/vehicle-detail'

import type { FleetVehicleOverview } from '@kuruma/shared/types/fleet'
import type { DashboardStats } from '@kuruma/shared/types/stats'
import type { VehicleDetail } from '@kuruma/shared/types/vehicle-detail'
import type { Booking, Message, Thread, ThreadParticipant, Vehicle } from '../stores'

export interface VehicleRepository {
  findAll(filters?: { status?: string }): Promise<Vehicle[]>
  findById(id: string): Promise<Vehicle | undefined>
  create(data: Omit<Vehicle, 'id' | 'createdAt' | 'updatedAt'>): Promise<Vehicle>
  update(id: string, data: Partial<Vehicle>): Promise<Vehicle | undefined>
  softDelete(id: string): Promise<Vehicle | undefined>
}

// Aggregated read for the owner-facing /manage/vehicles list. Enriches
// each vehicle with utilization %, booking count, and current/next
// booking state. Computed per-request — NOT denormalized into the
// vehicles table. See issue #52 and @kuruma/shared/types/fleet.
//
// Split from VehicleRepository because it reads across multiple tables
// (vehicles + bookings + users.name) — following the same boundary as
// AvailabilityRepository, which also reads vehicles + bookings.
export interface FleetOverviewRepository {
  findFleetOverview(): Promise<FleetVehicleOverview[]>
}

export interface BookingRepository {
  findAll(filters?: {
    status?: string
    vehicleId?: string
    renterId?: string
    from?: Date
    to?: Date
  }): Promise<Booking[]>
  findById(id: string): Promise<Booking | undefined>
  create(data: Omit<Booking, 'id' | 'createdAt' | 'updatedAt'>): Promise<Booking>
  updateStatus(id: string, status: string): Promise<Booking | undefined>
  cancel(id: string, cancellationFee: number, cancelledAt: Date): Promise<Booking | undefined>
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

// Enriched read for the owner-facing /manage/vehicles/[id] detail page.
// Returns a single vehicle with upcoming bookings, revenue, and utilization.
// See issue #53.
export interface VehicleDetailRepository {
  findVehicleDetail(vehicleId: string): Promise<VehicleDetail | undefined>
}

export interface ThreadRepository {
  findAll(
    userId: string,
  ): Promise<Array<Thread & { participants: ThreadParticipant[]; lastMessage: Message | null }>>
  findById(
    id: string,
  ): Promise<(Thread & { participants: ThreadParticipant[]; messages: Message[] }) | undefined>
  create(bookingId: string | null, participantIds: string[]): Promise<Thread>
  markAsRead(threadId: string, userId: string): Promise<void>
}

export interface MessageRepository {
  create(threadId: string, senderId: string, content: string): Promise<Message>
  findByThreadId(threadId: string): Promise<Message[]>
}
