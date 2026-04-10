import type { Booking, Vehicle } from '../stores'
import type {
  AvailabilityRepository,
  BookingRepository,
  DashboardStats,
  StatsRepository,
  VehicleRepository,
} from './types'

export class InMemoryVehicleRepository implements VehicleRepository {
  private readonly store: Map<string, Vehicle>

  constructor(store?: Map<string, Vehicle>) {
    this.store = store ?? new Map()
  }

  async findAll(filters?: { status?: string }): Promise<Vehicle[]> {
    const vehicles = [...this.store.values()]
    if (!filters?.status) return vehicles
    return vehicles.filter((v) => v.status === filters.status)
  }

  async findById(id: string): Promise<Vehicle | undefined> {
    return this.store.get(id)
  }

  async create(data: Omit<Vehicle, 'id' | 'createdAt' | 'updatedAt'>): Promise<Vehicle> {
    const now = new Date()
    const vehicle: Vehicle = {
      ...data,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    }
    this.store.set(vehicle.id, vehicle)
    return vehicle
  }

  async update(id: string, data: Partial<Vehicle>): Promise<Vehicle | undefined> {
    const existing = this.store.get(id)
    if (!existing) return undefined

    const updated: Vehicle = {
      ...existing,
      ...data,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
    }
    this.store.set(updated.id, updated)
    return updated
  }

  async softDelete(id: string): Promise<Vehicle | undefined> {
    const existing = this.store.get(id)
    if (!existing) return undefined

    const retired: Vehicle = {
      ...existing,
      status: 'RETIRED',
      updatedAt: new Date(),
    }
    this.store.set(retired.id, retired)
    return retired
  }
}

export class InMemoryBookingRepository implements BookingRepository {
  private readonly store: Map<string, Booking>

  constructor(store?: Map<string, Booking>) {
    this.store = store ?? new Map()
  }

  async findAll(filters?: {
    status?: string
    vehicleId?: string
    renterId?: string
    from?: Date
    to?: Date
  }): Promise<Booking[]> {
    let results = [...this.store.values()]

    if (filters?.status) {
      results = results.filter((b) => b.status === filters.status)
    }
    if (filters?.vehicleId) {
      results = results.filter((b) => b.vehicleId === filters.vehicleId)
    }
    if (filters?.renterId) {
      results = results.filter((b) => b.renterId === filters.renterId)
    }
    if (filters?.from && filters?.to) {
      const from = filters.from
      const to = filters.to
      results = results.filter((b) => b.startAt < to && b.effectiveEndAt > from)
    }

    return results
  }

  async findById(id: string): Promise<Booking | undefined> {
    return this.store.get(id)
  }

  async create(data: Omit<Booking, 'id' | 'createdAt' | 'updatedAt'>): Promise<Booking> {
    const now = new Date()
    const booking: Booking = {
      ...data,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    }
    this.store.set(booking.id, booking)
    return booking
  }

  async updateStatus(id: string, status: string): Promise<Booking | undefined> {
    const existing = this.store.get(id)
    if (!existing) return undefined

    const updated: Booking = {
      ...existing,
      status: status as Booking['status'],
      updatedAt: new Date(),
    }
    this.store.set(updated.id, updated)
    return updated
  }

  async cancel(
    id: string,
    cancellationFee: number,
    cancelledAt: Date,
  ): Promise<Booking | undefined> {
    const existing = this.store.get(id)
    if (!existing) return undefined

    const cancelled: Booking = {
      ...existing,
      status: 'CANCELLED',
      cancellationFee,
      cancelledAt,
      updatedAt: new Date(),
    }
    this.store.set(cancelled.id, cancelled)
    return cancelled
  }
}

const BLOCKING_STATUSES: ReadonlySet<Booking['status']> = new Set(['CONFIRMED', 'ACTIVE'])

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

export class InMemoryStatsRepository implements StatsRepository {
  constructor(
    private readonly vehicleRepo: VehicleRepository,
    private readonly bookingRepo: BookingRepository,
  ) {}

  async getDashboardStats(): Promise<DashboardStats> {
    const [vehicles, bookings] = await Promise.all([
      this.vehicleRepo.findAll({ status: 'AVAILABLE' }),
      this.bookingRepo.findAll(),
    ])

    return {
      totalBookings: bookings.length,
      activeVehicles: vehicles.length,
      totalCustomers: 0, // No users table in InMemory
      unreadMessages: 0, // No messages table yet
    }
  }
}

function getConflictingBookings(
  bookings: Booking[],
  vehicleId: string,
  _bufferMinutes: number,
  from: Date,
  to: Date,
): Booking[] {
  return bookings.filter((booking) => {
    if (booking.vehicleId !== vehicleId) return false
    if (!BLOCKING_STATUSES.has(booking.status)) return false

    // Use effectiveEndAt (which includes buffer) instead of computing at runtime
    const effectiveEnd = booking.effectiveEndAt

    // Overlap: booking starts before requested end AND effective end is after requested start
    return booking.startAt < to && effectiveEnd > from
  })
}
