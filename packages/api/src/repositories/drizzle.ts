import type { getDb } from '@kuruma/shared/db'
import { bookings, vehicles } from '@kuruma/shared/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import type { Booking, Vehicle } from '../stores'
import type { AvailabilityRepository, BookingRepository, VehicleRepository } from './types'

type Db = ReturnType<typeof getDb>

export class DrizzleVehicleRepository implements VehicleRepository {
  constructor(private readonly db: Db) {}

  async findAll(filters?: { status?: string }): Promise<Vehicle[]> {
    const query = this.db.select().from(vehicles)

    const rows = filters?.status
      ? await query.where(eq(vehicles.status, filters.status as Vehicle['status']))
      : await query

    return rows as Vehicle[]
  }

  async findById(id: string): Promise<Vehicle | undefined> {
    const [row] = await this.db.select().from(vehicles).where(eq(vehicles.id, id))

    return (row as Vehicle) ?? undefined
  }

  async create(data: Omit<Vehicle, 'id' | 'createdAt' | 'updatedAt'>): Promise<Vehicle> {
    const [inserted] = await this.db
      .insert(vehicles)
      .values({
        name: data.name,
        description: data.description,
        seats: data.seats,
        transmission: data.transmission,
        fuelType: data.fuelType,
        status: data.status,
        bufferMinutes: data.bufferMinutes,
        minRentalHours: data.minRentalHours,
        maxRentalHours: data.maxRentalHours,
        advanceBookingHours: data.advanceBookingHours,
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

export class DrizzleAvailabilityRepository implements AvailabilityRepository {
  constructor(private readonly db: Db) {}

  async findAvailableVehicles(from: Date, to: Date): Promise<Vehicle[]> {
    const fromIso = from.toISOString()
    const toIso = to.toISOString()

    const rows = await this.db
      .select()
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
    const [vehicle] = await this.db.select().from(vehicles).where(eq(vehicles.id, vehicleId))

    if (!vehicle) return undefined

    const fromIso = from.toISOString()
    const toIso = to.toISOString()

    const conflicts = await this.db
      .select()
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

  async findAll(filters?: { status?: string; vehicleId?: string }): Promise<Booking[]> {
    const conditions = []

    if (filters?.status) {
      conditions.push(eq(bookings.status, filters.status as Booking['status']))
    }
    if (filters?.vehicleId) {
      conditions.push(eq(bookings.vehicleId, filters.vehicleId))
    }

    const query = this.db.select().from(bookings)

    const rows = conditions.length > 0 ? await query.where(and(...conditions)) : await query

    return rows as Booking[]
  }

  async findById(id: string): Promise<Booking | undefined> {
    const [row] = await this.db.select().from(bookings).where(eq(bookings.id, id))

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
}
