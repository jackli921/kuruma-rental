import type {
  DailyUtilization,
  VehicleDetail,
  VehicleDetailBooking,
} from '@kuruma/shared/types/vehicle-detail'
import type { Booking } from '../stores'
import type { BookingRepository, VehicleDetailRepository, VehicleRepository } from './types'

const UPCOMING_LIMIT = 10
const _UTILIZATION_DAYS = 30
const MS_PER_HOUR = 60 * 60 * 1000
const MS_PER_DAY = 24 * MS_PER_HOUR

const UPCOMING_STATUSES: ReadonlySet<Booking['status']> = new Set(['CONFIRMED', 'ACTIVE'])

function formatDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function dayStart(d: Date): Date {
  const r = new Date(d)
  r.setHours(0, 0, 0, 0)
  return r
}

export class InMemoryVehicleDetailRepository implements VehicleDetailRepository {
  constructor(
    private readonly vehicleRepo: VehicleRepository,
    private readonly bookingRepo: BookingRepository,
    private readonly renterNameByUserId: Map<string, string> = new Map(),
  ) {}

  async findVehicleDetail(vehicleId: string): Promise<VehicleDetail | undefined> {
    const vehicle = await this.vehicleRepo.findById(vehicleId)
    if (!vehicle) return undefined

    const allBookings = await this.bookingRepo.findAll({ vehicleId })
    const now = new Date()

    return {
      ...vehicle,
      upcomingBookings: this.computeUpcoming(allBookings, now),
      ...this.computeRevenue(allBookings, now),
      utilizationLast30Days: this.computeUtilization(allBookings, now),
    }
  }

  private computeUpcoming(bookings: Booking[], now: Date): VehicleDetailBooking[] {
    return bookings
      .filter((b) => UPCOMING_STATUSES.has(b.status) && b.startAt > now)
      .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
      .slice(0, UPCOMING_LIMIT)
      .map((b) => ({
        id: b.id,
        startAt: b.startAt,
        endAt: b.endAt,
        renterName: this.renterNameByUserId.get(b.renterId) ?? null,
        source: b.source,
        status: b.status as 'CONFIRMED' | 'ACTIVE',
      }))
  }

  private computeRevenue(
    bookings: Booking[],
    now: Date,
  ): { revenueLast7d: number; revenueLast30d: number; revenueAllTime: number } {
    const sevenDaysAgo = new Date(now.getTime() - 7 * MS_PER_DAY)
    const thirtyDaysAgo = new Date(now.getTime() - 30 * MS_PER_DAY)

    const completed = bookings.filter((b) => b.status === 'COMPLETED' && b.totalPrice != null)

    let revenueLast7d = 0
    let revenueLast30d = 0
    let revenueAllTime = 0

    for (const b of completed) {
      const price = b.totalPrice!
      revenueAllTime += price
      if (b.endAt > thirtyDaysAgo) revenueLast30d += price
      if (b.endAt > sevenDaysAgo) revenueLast7d += price
    }

    return { revenueLast7d, revenueLast30d, revenueAllTime }
  }

  private computeUtilization(bookings: Booking[], now: Date): DailyUtilization[] {
    const todayStart = dayStart(now)
    const days: DailyUtilization[] = []

    for (let i = 29; i >= 0; i--) {
      const dayBegin = new Date(todayStart.getTime() - i * MS_PER_DAY)
      const dayEnd = new Date(dayBegin.getTime() + MS_PER_DAY)

      let bookedHours = 0
      for (const b of bookings) {
        if (b.status === 'CANCELLED') continue
        // Overlap with this day
        const overlapStart = b.startAt > dayBegin ? b.startAt : dayBegin
        const overlapEnd = b.endAt < dayEnd ? b.endAt : dayEnd
        if (overlapEnd > overlapStart) {
          bookedHours += (overlapEnd.getTime() - overlapStart.getTime()) / MS_PER_HOUR
        }
      }

      days.push({
        date: formatDate(dayBegin),
        bookedHours: Math.round(bookedHours * 100) / 100,
      })
    }

    return days
  }
}
