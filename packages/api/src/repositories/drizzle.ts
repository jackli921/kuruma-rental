import type { getDb } from '@kuruma/shared/db'
import {
  bookings,
  messages,
  threadParticipants,
  threads,
  users,
  vehicles,
} from '@kuruma/shared/db/schema'
import type { FleetVehicleOverview } from '@kuruma/shared/types/fleet'
import { and, asc, count, eq, inArray, ne, sql } from 'drizzle-orm'
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

export type Db = ReturnType<typeof getDb>

const vehicleColumns = {
  id: vehicles.id,
  name: vehicles.name,
  description: vehicles.description,
  photos: vehicles.photos,
  seats: vehicles.seats,
  transmission: vehicles.transmission,
  fuelType: vehicles.fuelType,
  status: vehicles.status,
  bufferMinutes: vehicles.bufferMinutes,
  minRentalHours: vehicles.minRentalHours,
  maxRentalHours: vehicles.maxRentalHours,
  advanceBookingHours: vehicles.advanceBookingHours,
  dailyRateJpy: vehicles.dailyRateJpy,
  hourlyRateJpy: vehicles.hourlyRateJpy,
  createdAt: vehicles.createdAt,
  updatedAt: vehicles.updatedAt,
}

const bookingColumns = {
  id: bookings.id,
  renterId: bookings.renterId,
  vehicleId: bookings.vehicleId,
  startAt: bookings.startAt,
  endAt: bookings.endAt,
  effectiveEndAt: bookings.effectiveEndAt,
  status: bookings.status,
  source: bookings.source,
  externalId: bookings.externalId,
  notes: bookings.notes,
  totalPrice: bookings.totalPrice,
  cancellationFee: bookings.cancellationFee,
  cancelledAt: bookings.cancelledAt,
  idempotencyKey: bookings.idempotencyKey,
  createdAt: bookings.createdAt,
  updatedAt: bookings.updatedAt,
}

export class DrizzleVehicleRepository implements VehicleRepository {
  constructor(private readonly db: Db) {}

  async findAll(filters?: { status?: string }): Promise<Vehicle[]> {
    const query = this.db.select(vehicleColumns).from(vehicles)

    const rows = filters?.status
      ? await query.where(eq(vehicles.status, filters.status as Vehicle['status']))
      : await query

    return rows as Vehicle[]
  }

  async findById(id: string): Promise<Vehicle | undefined> {
    const [row] = await this.db.select(vehicleColumns).from(vehicles).where(eq(vehicles.id, id))

    return (row as Vehicle) ?? undefined
  }

  async create(data: Omit<Vehicle, 'id' | 'createdAt' | 'updatedAt'>): Promise<Vehicle> {
    const [inserted] = await this.db
      .insert(vehicles)
      .values({
        name: data.name,
        description: data.description,
        photos: data.photos,
        seats: data.seats,
        transmission: data.transmission,
        fuelType: data.fuelType,
        status: data.status,
        bufferMinutes: data.bufferMinutes,
        minRentalHours: data.minRentalHours,
        maxRentalHours: data.maxRentalHours,
        advanceBookingHours: data.advanceBookingHours,
        dailyRateJpy: data.dailyRateJpy,
        hourlyRateJpy: data.hourlyRateJpy,
      })
      .returning()

    return inserted as Vehicle
  }

  async update(id: string, data: Partial<Vehicle>): Promise<Vehicle | undefined> {
    const { id: _id, createdAt: _createdAt, ...fields } = data
    const [updated] = await this.db
      .update(vehicles)
      .set({ ...fields, updatedAt: sql`now()` })
      .where(eq(vehicles.id, id))
      .returning()

    return (updated as Vehicle) ?? undefined
  }

  async softDelete(id: string): Promise<Vehicle | undefined> {
    const [retired] = await this.db
      .update(vehicles)
      .set({ status: 'RETIRED', updatedAt: sql`now()` })
      .where(eq(vehicles.id, id))
      .returning()

    return (retired as Vehicle) ?? undefined
  }
}

// Fleet overview: owner-facing aggregated read. Two round-trips instead
// of N+1 — one SELECT for all vehicles, one SELECT for all relevant
// bookings (last 30 days + any future) joined to users for renter name.
// JS does the per-vehicle aggregation. 40-50 cars × maybe 200 bookings
// is trivially fast and much clearer than a window-function CTE. See
// issue #52.
const UTILIZATION_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

function overlapHours(
  bookingStart: Date,
  bookingEnd: Date,
  windowStart: Date,
  windowEnd: Date,
): number {
  const start = bookingStart < windowStart ? windowStart : bookingStart
  const end = bookingEnd > windowEnd ? windowEnd : bookingEnd
  if (end <= start) return 0
  return (end.getTime() - start.getTime()) / (1000 * 60 * 60)
}

export class DrizzleFleetOverviewRepository implements FleetOverviewRepository {
  constructor(private readonly db: Db) {}

  async findFleetOverview(): Promise<FleetVehicleOverview[]> {
    const now = new Date()
    const windowStart = new Date(now.getTime() - UTILIZATION_WINDOW_MS)

    // Round-trip 1: all vehicles.
    const vehicleRows = (await this.db.select(vehicleColumns).from(vehicles)) as Vehicle[]

    // Round-trip 2: bookings we care about — non-CANCELLED, and either
    // overlapping the last-30-day window OR starting in the future.
    // LEFT JOIN users for the renter name.
    const bookingRows = await this.db
      .select({
        id: bookings.id,
        vehicleId: bookings.vehicleId,
        renterId: bookings.renterId,
        startAt: bookings.startAt,
        endAt: bookings.endAt,
        status: bookings.status,
        renterName: users.name,
      })
      .from(bookings)
      .leftJoin(users, eq(bookings.renterId, users.id))
      .where(
        and(
          ne(bookings.status, 'CANCELLED'),
          sql`(${bookings.endAt} > ${windowStart.toISOString()} OR ${bookings.startAt} > ${now.toISOString()})`,
        ),
      )

    const bookingsByVehicleId = new Map<string, typeof bookingRows>()
    for (const row of bookingRows) {
      const list = bookingsByVehicleId.get(row.vehicleId) ?? []
      list.push(row)
      bookingsByVehicleId.set(row.vehicleId, list)
    }

    return vehicleRows.map((vehicle) => {
      const vb = bookingsByVehicleId.get(vehicle.id) ?? []

      const recent = vb.filter((b) => b.endAt > windowStart && b.startAt < now)
      const bookedHours = recent.reduce(
        (sum, b) => sum + overlapHours(b.startAt, b.endAt, windowStart, now),
        0,
      )

      const current = vb.find((b) => b.startAt <= now && b.endAt > now) ?? null
      const futures = vb
        .filter((b) => b.startAt > now)
        .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
      const next = futures[0] ?? null

      return {
        ...vehicle,
        utilization: (bookedHours / (30 * 24)) * 100,
        bookingCountLast30Days: recent.length,
        currentBooking: current
          ? { startAt: current.startAt, endAt: current.endAt, renterName: current.renterName }
          : null,
        nextBooking: next
          ? { startAt: next.startAt, endAt: next.endAt, renterName: next.renterName }
          : null,
      }
    })
  }
}

export class DrizzleAvailabilityRepository implements AvailabilityRepository {
  constructor(private readonly db: Db) {}

  async findAvailableVehicles(from: Date, to: Date): Promise<Vehicle[]> {
    const fromIso = from.toISOString()
    const toIso = to.toISOString()

    const rows = await this.db
      .select(vehicleColumns)
      .from(vehicles)
      .where(
        and(
          eq(vehicles.status, 'AVAILABLE'),
          sql`NOT EXISTS (
            SELECT 1 FROM bookings b
            WHERE b."vehicleId" = ${vehicles.id}
            AND b.status IN ('CONFIRMED', 'ACTIVE')
            AND tstzrange(b."startAt", b."effectiveEndAt") && tstzrange(${fromIso}::timestamptz, ${toIso}::timestamptz)
          )`,
        ),
      )
    return rows as Vehicle[]
  }

  async checkVehicleAvailability(
    vehicleId: string,
    from: Date,
    to: Date,
  ): Promise<{ available: boolean; vehicle: Vehicle; conflicts: Booking[] } | undefined> {
    const [vehicle] = await this.db
      .select(vehicleColumns)
      .from(vehicles)
      .where(eq(vehicles.id, vehicleId))

    if (!vehicle) return undefined

    const fromIso = from.toISOString()
    const toIso = to.toISOString()

    const conflicts = await this.db
      .select(bookingColumns)
      .from(bookings)
      .where(
        and(
          eq(bookings.vehicleId, vehicleId),
          sql`status IN ('CONFIRMED', 'ACTIVE')`,
          sql`tstzrange("startAt", "effectiveEndAt") && tstzrange(${fromIso}::timestamptz, ${toIso}::timestamptz)`,
        ),
      )

    return {
      available: conflicts.length === 0,
      vehicle: vehicle as Vehicle,
      conflicts: conflicts as Booking[],
    }
  }
}

export class DrizzleBookingRepository implements BookingRepository {
  constructor(private readonly db: Db) {}

  async findAll(filters?: {
    status?: string
    vehicleId?: string
    renterId?: string
    from?: Date
    to?: Date
  }): Promise<Booking[]> {
    const conditions = []

    if (filters?.status) {
      conditions.push(eq(bookings.status, filters.status as Booking['status']))
    }
    if (filters?.vehicleId) {
      conditions.push(eq(bookings.vehicleId, filters.vehicleId))
    }
    if (filters?.renterId) {
      conditions.push(eq(bookings.renterId, filters.renterId))
    }
    if (filters?.from && filters?.to) {
      const fromIso = filters.from.toISOString()
      const toIso = filters.to.toISOString()
      conditions.push(
        sql`tstzrange("startAt", "effectiveEndAt") && tstzrange(${fromIso}::timestamptz, ${toIso}::timestamptz)`,
      )
    }

    const query = this.db.select(bookingColumns).from(bookings)

    const rows = conditions.length > 0 ? await query.where(and(...conditions)) : await query

    return rows as Booking[]
  }

  async findById(id: string): Promise<Booking | undefined> {
    const [row] = await this.db.select(bookingColumns).from(bookings).where(eq(bookings.id, id))

    return (row as Booking) ?? undefined
  }

  async findByIdempotencyKey(key: string): Promise<Booking | undefined> {
    const [row] = await this.db
      .select(bookingColumns)
      .from(bookings)
      .where(eq(bookings.idempotencyKey, key))

    return (row as Booking) ?? undefined
  }

  async create(data: Omit<Booking, 'id' | 'createdAt' | 'updatedAt'>): Promise<Booking> {
    const [inserted] = await this.db
      .insert(bookings)
      .values({
        renterId: data.renterId,
        vehicleId: data.vehicleId,
        startAt: data.startAt,
        endAt: data.endAt,
        effectiveEndAt: data.effectiveEndAt,
        status: data.status,
        source: data.source,
        externalId: data.externalId,
        notes: data.notes,
        totalPrice: data.totalPrice,
        idempotencyKey: data.idempotencyKey,
      })
      .returning()

    return inserted as Booking
  }

  async updateStatus(id: string, status: string): Promise<Booking | undefined> {
    const [updated] = await this.db
      .update(bookings)
      .set({ status: status as Booking['status'], updatedAt: sql`now()` })
      .where(eq(bookings.id, id))
      .returning()

    return (updated as Booking) ?? undefined
  }

  async cancel(
    id: string,
    cancellationFee: number,
    cancelledAt: Date,
  ): Promise<Booking | undefined> {
    const [cancelled] = await this.db
      .update(bookings)
      .set({
        status: 'CANCELLED',
        cancellationFee,
        cancelledAt,
        updatedAt: sql`now()`,
      })
      .where(eq(bookings.id, id))
      .returning()

    return (cancelled as Booking) ?? undefined
  }
}

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

// Explicit column lists. Following the pattern in DrizzleVehicleRepository
// (and the rule from issue #19 — never SELECT *) so adding a column to the
// schema can never silently leak into API responses.
const threadColumns = {
  id: threads.id,
  bookingId: threads.bookingId,
  createdAt: threads.createdAt,
  updatedAt: threads.updatedAt,
}

const participantColumns = {
  id: threadParticipants.id,
  threadId: threadParticipants.threadId,
  userId: threadParticipants.userId,
  unreadCount: threadParticipants.unreadCount,
}

const messageColumns = {
  id: messages.id,
  threadId: messages.threadId,
  senderId: messages.senderId,
  content: messages.content,
  sourceLanguage: messages.sourceLanguage,
  translations: messages.translations,
  createdAt: messages.createdAt,
}

// `messages.translations` is a nullable text column with a default of '{}'.
// The shared `Message` type declares it as `string` (non-null), so we
// normalise NULL → '{}' at the boundary rather than leak the DB nuance.
function normaliseMessage(row: {
  id: string
  threadId: string
  senderId: string
  content: string
  sourceLanguage: string | null
  translations: string | null
  createdAt: Date
}): Message {
  return {
    id: row.id,
    threadId: row.threadId,
    senderId: row.senderId,
    content: row.content,
    sourceLanguage: row.sourceLanguage,
    translations: row.translations ?? '{}',
    createdAt: row.createdAt,
  }
}

export class DrizzleThreadRepository implements ThreadRepository {
  constructor(private readonly db: Db) {}

  async findAll(
    userId: string,
  ): Promise<Array<Thread & { participants: ThreadParticipant[]; lastMessage: Message | null }>> {
    // Step 1: which threads does this user participate in?
    const myParticipations = await this.db
      .select({ threadId: threadParticipants.threadId })
      .from(threadParticipants)
      .where(eq(threadParticipants.userId, userId))

    const threadIds = [...new Set(myParticipations.map((p) => p.threadId))]
    if (threadIds.length === 0) return []

    // Step 2: fetch the threads themselves.
    const threadRows = (await this.db
      .select(threadColumns)
      .from(threads)
      .where(inArray(threads.id, threadIds))) as Thread[]

    // Step 3: fetch all participants for those threads in one round-trip.
    const participantRows = (await this.db
      .select(participantColumns)
      .from(threadParticipants)
      .where(inArray(threadParticipants.threadId, threadIds))) as ThreadParticipant[]

    // Step 4: fetch only the latest message per thread. The DISTINCT ON
    // pattern keeps this O(threads) instead of O(messages) — important once
    // any single conversation grows beyond a few dozen messages.
    const lastMessageRows = await this.db.execute<{
      id: string
      threadId: string
      senderId: string
      content: string
      sourceLanguage: string | null
      translations: string | null
      createdAt: Date
    }>(sql`
      SELECT DISTINCT ON ("threadId")
        "id", "threadId", "senderId", "content", "sourceLanguage", "translations", "createdAt"
      FROM "messages"
      WHERE "threadId" IN (${sql.join(
        threadIds.map((id) => sql`${id}`),
        sql`, `,
      )})
      ORDER BY "threadId", "createdAt" DESC
    `)

    // postgres-js returns rows on the result directly; neon-http wraps in {rows}.
    // Coerce both shapes into a single array.
    const lastMessageList = (
      Array.isArray(lastMessageRows)
        ? lastMessageRows
        : ((lastMessageRows as { rows?: unknown[] }).rows ?? [])
    ) as Array<{
      id: string
      threadId: string
      senderId: string
      content: string
      sourceLanguage: string | null
      translations: string | null
      createdAt: Date
    }>

    const lastMessageByThreadId = new Map<string, Message>()
    for (const row of lastMessageList) {
      lastMessageByThreadId.set(row.threadId, normaliseMessage(row))
    }

    return threadRows.map((thread) => ({
      ...thread,
      participants: participantRows.filter((p) => p.threadId === thread.id),
      lastMessage: lastMessageByThreadId.get(thread.id) ?? null,
    }))
  }

  async findById(
    id: string,
  ): Promise<(Thread & { participants: ThreadParticipant[]; messages: Message[] }) | undefined> {
    const [thread] = (await this.db
      .select(threadColumns)
      .from(threads)
      .where(eq(threads.id, id))) as Thread[]

    if (!thread) return undefined

    const [participantRows, messageRows] = await Promise.all([
      this.db
        .select(participantColumns)
        .from(threadParticipants)
        .where(eq(threadParticipants.threadId, id)),
      this.db
        .select(messageColumns)
        .from(messages)
        .where(eq(messages.threadId, id))
        .orderBy(asc(messages.createdAt)),
    ])

    return {
      ...thread,
      participants: participantRows as ThreadParticipant[],
      messages: (messageRows as Array<Parameters<typeof normaliseMessage>[0]>).map(
        normaliseMessage,
      ),
    }
  }

  async create(bookingId: string | null, participantIds: string[]): Promise<Thread> {
    // Two-statement sequence: insert the thread row, then insert all
    // participants in one batch. Cleaner than a transaction for this case;
    // if the participant insert fails, the thread row is orphaned but
    // harmless and can be GC'd later. (postgres-js + neon-http both support
    // .transaction() but the behaviour differs slightly across drivers and
    // we don't need atomicity here for correctness.)
    const [insertedThread] = (await this.db
      .insert(threads)
      .values({ bookingId })
      .returning(threadColumns)) as Thread[]

    if (!insertedThread) {
      throw new Error('Failed to insert thread')
    }

    if (participantIds.length > 0) {
      await this.db.insert(threadParticipants).values(
        participantIds.map((userId) => ({
          threadId: insertedThread.id,
          userId,
          unreadCount: 0,
        })),
      )
    }

    return insertedThread
  }

  async markAsRead(threadId: string, userId: string): Promise<void> {
    // Single UPDATE — no read-modify-write, no race window.
    await this.db
      .update(threadParticipants)
      .set({ unreadCount: 0 })
      .where(and(eq(threadParticipants.threadId, threadId), eq(threadParticipants.userId, userId)))
  }
}

export class DrizzleMessageRepository implements MessageRepository {
  constructor(private readonly db: Db) {}

  async create(threadId: string, senderId: string, content: string): Promise<Message> {
    // Insert the message AND atomically bump every other participant's
    // unread count in a single round-trip pair. The unread bump uses a
    // SQL arithmetic expression (`unreadCount + 1`) so concurrent inserts
    // can never lose an increment — this is the Check-Then-Act race fix
    // called out in the issue.
    const [inserted] = (await this.db
      .insert(messages)
      .values({ threadId, senderId, content })
      .returning(messageColumns)) as Array<Parameters<typeof normaliseMessage>[0]>

    if (!inserted) {
      throw new Error('Failed to insert message')
    }

    await this.db
      .update(threadParticipants)
      .set({ unreadCount: sql`${threadParticipants.unreadCount} + 1` })
      .where(
        and(
          eq(threadParticipants.threadId, threadId),
          sql`${threadParticipants.userId} <> ${senderId}`,
        ),
      )

    // Touch the parent thread's updatedAt so findAll can sort by recency
    // later if/when needed. Cheap and keeps invariants honest.
    await this.db.update(threads).set({ updatedAt: sql`now()` }).where(eq(threads.id, threadId))

    return normaliseMessage(inserted)
  }

  async findByThreadId(threadId: string): Promise<Message[]> {
    const rows = (await this.db
      .select(messageColumns)
      .from(messages)
      .where(eq(messages.threadId, threadId))
      .orderBy(asc(messages.createdAt))) as Array<Parameters<typeof normaliseMessage>[0]>

    return rows.map(normaliseMessage)
  }
}
