import type { FleetVehicleOverview } from '@kuruma/shared/types/fleet'
import type { Booking, Message, Thread, ThreadParticipant, Vehicle } from '../stores'
import type {
  AvailabilityRepository,
  BookingRepository,
  DashboardStats,
  FleetOverviewRepository,
  MessageRepository,
  StatsRepository,
  ThreadRepository,
  VehicleRepository,
} from './types'

const BLOCKING_STATUSES: ReadonlySet<Booking['status']> = new Set(['CONFIRMED', 'ACTIVE'])

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

  async findByIdempotencyKey(key: string): Promise<Booking | undefined> {
    for (const booking of this.store.values()) {
      if (booking.idempotencyKey === key) return booking
    }
    return undefined
  }

  async create(data: Omit<Booking, 'id' | 'createdAt' | 'updatedAt'>): Promise<Booking> {
    // Mirror the DB-level `bookings_no_overlap` exclusion constraint so in-memory
    // tests exercise the same conflict behavior as real Postgres.
    if (BLOCKING_STATUSES.has(data.status)) {
      for (const existing of this.store.values()) {
        if (existing.vehicleId !== data.vehicleId) continue
        if (!BLOCKING_STATUSES.has(existing.status)) continue
        const overlaps =
          data.startAt < existing.effectiveEndAt && existing.startAt < data.effectiveEndAt
        if (overlaps) {
          const err = new Error('bookings_no_overlap violation') as Error & { code: string }
          err.code = '23P01'
          throw err
        }
      }
    }

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

// 30-day utilization window, expressed in hours. Used as the denominator
// for the utilization percentage — if a vehicle were rented every hour
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
  ) {}

  async findFleetOverview(): Promise<FleetVehicleOverview[]> {
    const now = new Date()
    const windowStart = new Date(now.getTime() - UTILIZATION_WINDOW_HOURS * 60 * 60 * 1000)

    const vehicles = await this.vehicleRepo.findAll()
    const allBookings = await this.bookingRepo.findAll()

    return vehicles.map((vehicle) => {
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
      }
    })
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

export class InMemoryThreadRepository implements ThreadRepository {
  private readonly threads = new Map<string, Thread>()
  private readonly participants = new Map<string, ThreadParticipant>()
  private readonly messages = new Map<string, Message>()

  async findAll(
    userId: string,
  ): Promise<Array<Thread & { participants: ThreadParticipant[]; lastMessage: Message | null }>> {
    const userParticipations = [...this.participants.values()].filter((p) => p.userId === userId)
    const threadIds = new Set(userParticipations.map((p) => p.threadId))

    return [...this.threads.values()]
      .filter((t) => threadIds.has(t.id))
      .map((thread) => {
        const threadParticipants = [...this.participants.values()].filter(
          (p) => p.threadId === thread.id,
        )
        const threadMessages = [...this.messages.values()]
          .filter((m) => m.threadId === thread.id)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        const lastMessage = threadMessages.at(-1) ?? null

        return { ...thread, participants: threadParticipants, lastMessage }
      })
  }

  async findById(
    id: string,
  ): Promise<(Thread & { participants: ThreadParticipant[]; messages: Message[] }) | undefined> {
    const thread = this.threads.get(id)
    if (!thread) return undefined

    const threadParticipants = [...this.participants.values()].filter((p) => p.threadId === id)
    const threadMessages = [...this.messages.values()]
      .filter((m) => m.threadId === id)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())

    return { ...thread, participants: threadParticipants, messages: threadMessages }
  }

  async create(bookingId: string | null, participantIds: string[]): Promise<Thread> {
    const now = new Date()
    const thread: Thread = {
      id: crypto.randomUUID(),
      bookingId,
      createdAt: now,
      updatedAt: now,
    }
    this.threads.set(thread.id, thread)

    for (const userId of participantIds) {
      const participant: ThreadParticipant = {
        id: crypto.randomUUID(),
        threadId: thread.id,
        userId,
        unreadCount: 0,
      }
      this.participants.set(participant.id, participant)
    }

    return thread
  }

  async markAsRead(threadId: string, userId: string): Promise<void> {
    for (const [key, p] of this.participants) {
      if (p.threadId === threadId && p.userId === userId) {
        this.participants.set(key, { ...p, unreadCount: 0 })
      }
    }
  }

  // Exposed for InMemoryMessageRepository to add messages
  _addMessage(message: Message): void {
    this.messages.set(message.id, message)
    // Increment unread count for all participants except sender
    for (const [key, p] of this.participants) {
      if (p.threadId === message.threadId && p.userId !== message.senderId) {
        this.participants.set(key, { ...p, unreadCount: p.unreadCount + 1 })
      }
    }
  }
}

export class InMemoryMessageRepository implements MessageRepository {
  constructor(private readonly threadRepo: InMemoryThreadRepository) {}

  async create(threadId: string, senderId: string, content: string): Promise<Message> {
    const message: Message = {
      id: crypto.randomUUID(),
      threadId,
      senderId,
      content,
      sourceLanguage: null,
      translations: '{}',
      createdAt: new Date(),
    }
    this.threadRepo._addMessage(message)
    return message
  }

  async findByThreadId(threadId: string): Promise<Message[]> {
    const thread = await this.threadRepo.findById(threadId)
    return thread?.messages ?? []
  }
}
