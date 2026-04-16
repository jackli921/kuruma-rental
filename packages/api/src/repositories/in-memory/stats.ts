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
    const [vehicles, bookings] = await Promise.all([
      this.vehicleRepo.findAll({ status: 'AVAILABLE' }),
      this.bookingRepo.findAll(SYSTEM_CONTEXT),
    ])

    return {
      totalBookings: bookings.length,
      activeVehicles: vehicles.length,
      totalCustomers: 0, // No users table in InMemory
      unreadMessages: 0, // No messages table yet
    }
  }
}
