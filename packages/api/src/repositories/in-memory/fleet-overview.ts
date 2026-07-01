import type { FleetVehicleOverview } from '@kuruma/shared/types/fleet'
import type { CallerContext } from '../../middleware/auth'
import { operatorReadScope } from '../../tenancy'
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

  async findFleetOverview(
    ctx: CallerContext,
    now: Date,
    operatorId?: string,
  ): Promise<FleetVehicleOverview[]> {
    const windowStart = new Date(now.getTime() - UTILIZATION_WINDOW_HOURS * 60 * 60 * 1000)

    // Scope BOTH reads to the caller's tenant (#594). VehicleRepository.findAll
    // and BookingRepository.findAll each apply their own operator scope, so an
    // OPERATOR_* caller never reads another tenant's rows (isolation at the read,
    // not the projection) while bypass roles see all. Mirrors the Drizzle repo,
    // which scopes vehicles by operatorId and bookings to those vehicle ids.
    //
    // includeRetired (#600): the Fleet page lists every status (RETIRED is a
    // first-class filter facet, shown by default), so the overview must include
    // retired cars. findAll hides RETIRED by default; the Drizzle overview repo
    // applies no status filter, so this flag keeps the two repos in parity.
    const { data: allVehicles } = await this.vehicleRepo.findAll(ctx, { includeRetired: true })
    // Picker narrowing (#407 slice 4): a bypass (`all`) caller who named an
    // operator sees just that operator's cars; a tenant caller already reads only
    // its own vehicles above, so the filter is honored ONLY for `all` — a foreign
    // id can never widen a tenant, and bookings narrow with the vehicle set below.
    const vehicles =
      operatorReadScope(ctx).kind === 'all' && operatorId
        ? allVehicles.filter((v) => v.operatorId === operatorId)
        : allVehicles
    const allBookings = await this.bookingRepo.findAll(ctx)

    return Promise.all(
      vehicles.map(async (vehicle) => {
        const vehicleBookings = allBookings.filter(
          (b) => b.assignedVehicleId === vehicle.id && b.status !== 'CANCELLED',
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
