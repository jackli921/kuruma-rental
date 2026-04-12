import { bookings, users, vehicles } from '@kuruma/shared/db/schema'
import { count, eq } from 'drizzle-orm'
import type { DashboardStats, StatsRepository } from '../types'
import type { Db } from './shared'

export class DrizzleStatsRepository implements StatsRepository {
  constructor(private readonly db: Db) {}

  async getDashboardStats(): Promise<DashboardStats> {
    const [bookingCount, vehicleCount, customerCount] = await Promise.all([
      this.db.select({ count: count() }).from(bookings),
      this.db.select({ count: count() }).from(vehicles).where(eq(vehicles.status, 'AVAILABLE')),
      this.db.select({ count: count() }).from(users).where(eq(users.role, 'RENTER')),
    ])

    return {
      totalBookings: bookingCount[0]?.count ?? 0,
      activeVehicles: vehicleCount[0]?.count ?? 0,
      totalCustomers: customerCount[0]?.count ?? 0,
      unreadMessages: 0,
    }
  }
}
