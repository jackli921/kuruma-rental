import { vehicles } from '@kuruma/shared/db/schema'
import { type SQL, and, count, eq, inArray, ne, sql } from 'drizzle-orm'
import type { Vehicle } from '../../stores'
import type { PaginatedResult, VehicleFilters, VehicleRepository } from '../types'
import { type Db, toVehicle, vehicleColumns } from './shared'

export class DrizzleVehicleRepository implements VehicleRepository {
  constructor(private readonly db: Db) {}

  async findAll(filters?: VehicleFilters): Promise<PaginatedResult<Vehicle>> {
    const conditions: SQL[] = []

    if (filters?.status) {
      conditions.push(eq(vehicles.status, filters.status as Vehicle['status']))
    } else if (!filters?.includeRetired) {
      conditions.push(ne(vehicles.status, 'RETIRED'))
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined

    const [countResult, rows] = await Promise.all([
      this.db.select({ value: count() }).from(vehicles).where(where),
      (() => {
        let q = this.db.select(vehicleColumns).from(vehicles).where(where).$dynamic()
        if (filters?.limit != null) q = q.limit(filters.limit)
        if (filters?.offset != null) q = q.offset(filters.offset)
        return q
      })(),
    ])

    return {
      data: rows.map(toVehicle),
      total: countResult[0]?.value ?? 0,
    }
  }

  async findById(id: string): Promise<Vehicle | undefined> {
    const [row] = await this.db.select(vehicleColumns).from(vehicles).where(eq(vehicles.id, id))

    return row ? toVehicle(row) : undefined
  }

  async findByIds(ids: string[]): Promise<Vehicle[]> {
    if (ids.length === 0) return []
    const rows = await this.db
      .select(vehicleColumns)
      .from(vehicles)
      .where(inArray(vehicles.id, ids))
    return rows as Vehicle[]
  }

  async create(data: Omit<Vehicle, 'id' | 'createdAt' | 'updatedAt'>): Promise<Vehicle> {
    const [inserted] = await this.db
      .insert(vehicles)
      .values({
        classId: data.classId,
        name: data.name,
        description: data.description,
        photos: data.photos,
        seats: data.seats,
        transmission: data.transmission,
        fuelType: data.fuelType,
        licensePlate: data.licensePlate,
        status: data.status,
        bufferMinutes: data.bufferMinutes,
        minRentalHours: data.minRentalHours,
        maxRentalHours: data.maxRentalHours,
        advanceBookingHours: data.advanceBookingHours,
        dailyRateJpy: data.dailyRateJpy,
        hourlyRateJpy: data.hourlyRateJpy,
        shakenExpiryDate: data.shakenExpiryDate,
        insuranceExpiryDate: data.insuranceExpiryDate,
      })
      .returning()

    if (!inserted) throw new Error('Failed to insert vehicle')
    return toVehicle(inserted)
  }

  async update(id: string, data: Partial<Vehicle>): Promise<Vehicle | undefined> {
    const { id: _id, createdAt: _createdAt, ...fields } = data
    const [updated] = await this.db
      .update(vehicles)
      .set({ ...fields, updatedAt: sql`now()` })
      .where(eq(vehicles.id, id))
      .returning()

    return updated ? toVehicle(updated) : undefined
  }

  async softDelete(id: string): Promise<Vehicle | undefined> {
    const [retired] = await this.db
      .update(vehicles)
      .set({ status: 'RETIRED', updatedAt: sql`now()` })
      .where(eq(vehicles.id, id))
      .returning()

    return retired ? toVehicle(retired) : undefined
  }

  async bulkUpdateStatus(ids: string[], status: 'AVAILABLE' | 'MAINTENANCE'): Promise<Vehicle[]> {
    if (ids.length === 0) return []
    const rows = await this.db
      .update(vehicles)
      .set({ status, updatedAt: sql`now()` })
      .where(inArray(vehicles.id, ids))
      .returning()
    return rows.map(toVehicle)
  }
}
