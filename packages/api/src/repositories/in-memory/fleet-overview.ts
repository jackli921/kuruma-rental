import type { FleetVehicleOverview } from '@kuruma/shared/types/fleet'
import { SYSTEM_CONTEXT } from '../../middleware/auth'
import type {
  BookingRepository,
  FleetOverviewRepository,
  MaintenanceLogRepository,
  VehicleRepository,
} from '../types'

// 30-day utilization window, expressed in hours. Used as the denominator
// for the utilization percentage -- if a vehicle were rented every hour
// of the last 30 days, utilization = 100.
const UTILIZATION_WINDOW_HOURS = 30 * 24

function hoursBetween(start: Date, end: Date): number {
  return (end.getTime() - start.getTime()) / (1000 * 60 * 60)
}

function overlapHours(
  bookingStart: Date,
  bookingEnd: Date,
  windowStart: Date,
  windowEnd: Date,
): number {
  const start = bookingStart < windowStart ? windowStart : bookingStart
  const end = bookingEnd > windowEnd ? windowEnd : bookingEnd
  if (end <= start) return 0
  return hoursBetween(start, end)
}

export class InMemoryFleetOverviewRepository implements FleetOverviewRepository {
  constructor(
    private readonly vehicleRepo: VehicleRepository,
    private readonly bookingRepo: BookingRepository,
    private readonly renterNameByUserId: Map<string, string> = new Map(),
    private readonly maintenanceLogRepo?: MaintenanceLogRepository,
  ) {}

  async findFleetOverview(): Promise<FleetVehicleOverview[]> {
    const now = new Date()
    const windowStart = new Date(now.getTime() - UTILIZATION_WINDOW_HOURS * 60 * 60 * 1000)

    const { data: vehicles } = await this.vehicleRepo.findAll()
    const allBookings = await this.bookingRepo.findAll(SYSTEM_CONTEXT)

    return Promise.all(
      vehicles.map(async (vehicle) => {
        const vehicleBookings = allBookings.filter(
          (b) => b.vehicleId === vehicle.id && b.status !== 'CANCELLED',
        )

        const recent = vehicleBookings.filter((b) => b.endAt > windowStart && b.startAt < now)
        const bookedHours = recent.reduce(
          (sum, b) => sum + overlapHours(b.startAt, b.endAt, windowStart, now),
          0,
        )

        const current = vehicleBookings.find((b) => b.startAt <= now && b.endAt > now) ?? null
        const futures = vehicleBookings
          .filter((b) => b.startAt > now)
          .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
        const next = futures[0] ?? null

        const activeLog = this.maintenanceLogRepo
          ? await this.maintenanceLogRepo.findActiveByVehicleId(vehicle.id)
          : undefined

        return {
          ...vehicle,
          utilization: (bookedHours / UTILIZATION_WINDOW_HOURS) * 100,
          bookingCountLast30Days: recent.length,
          currentBooking: current
            ? {
                startAt: current.startAt,
                endAt: current.endAt,
                renterName: this.renterNameByUserId.get(current.renterId) ?? null,
              }
            : null,
          nextBooking: next
            ? {
                startAt: next.startAt,
                endAt: next.endAt,
                renterName: this.renterNameByUserId.get(next.renterId) ?? null,
              }
            : null,
          activeMaintenanceReason: activeLog?.reason ?? null,
        }
      }),
    )
  }
}
