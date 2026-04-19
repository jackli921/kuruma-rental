import { SYSTEM_CONTEXT } from '../../middleware/auth'
import type {
  BookingRepository,
  DashboardStats,
  StatsRepository,
  VehicleRepository,
} from '../types'

export class InMemoryStatsRepository implements StatsRepository {
  constructor(
    private readonly vehicleRepo: VehicleRepository,
    private readonly bookingRepo: BookingRepository,
  ) {}

  async getDashboardStats(): Promise<DashboardStats> {
    const [vehicleResult, bookings] = await Promise.all([
      this.vehicleRepo.findAll(SYSTEM_CONTEXT, { status: 'AVAILABLE' }),
      this.bookingRepo.findAll(SYSTEM_CONTEXT),
    ])

    return {
      totalBookings: bookings.length,
      activeVehicles: vehicleResult.total,
      totalCustomers: 0, // No users table in InMemory
      unreadMessages: 0, // No messages table yet
    }
  }
}
