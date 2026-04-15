import { vehicleClasses } from '@kuruma/shared/db/schema'
import { eq, ne, sql } from 'drizzle-orm'
import type { VehicleClass } from '../../stores'
import type { VehicleClassFilters, VehicleClassRepository } from '../types'
import { type Db, toVehicleClass, vehicleClassColumns } from './shared'

export class DrizzleVehicleClassRepository implements VehicleClassRepository {
  constructor(private readonly db: Db) {}

  async findAll(filters?: VehicleClassFilters): Promise<VehicleClass[]> {
    const query = this.db.select(vehicleClassColumns).from(vehicleClasses)

    if (filters?.status) {
      const rows = await query.where(
        eq(vehicleClasses.status, filters.status as VehicleClass['status']),
      )
      return rows.map(toVehicleClass)
    }

    const rows = filters?.includeArchived
      ? await query
      : await query.where(ne(vehicleClasses.status, 'ARCHIVED'))

    return rows.map(toVehicleClass)
  }

  async findById(id: string): Promise<VehicleClass | undefined> {
    const [row] = await this.db
      .select(vehicleClassColumns)
      .from(vehicleClasses)
      .where(eq(vehicleClasses.id, id))

    return row ? toVehicleClass(row) : undefined
  }

  async findBySlug(slug: string): Promise<VehicleClass | undefined> {
    const [row] = await this.db
      .select(vehicleClassColumns)
      .from(vehicleClasses)
      .where(eq(vehicleClasses.slug, slug))

    return row ? toVehicleClass(row) : undefined
  }

  async create(
    data: Omit<VehicleClass, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<VehicleClass> {
    const [inserted] = await this.db
      .insert(vehicleClasses)
      .values({
        name: data.name,
        slug: data.slug,
        description: data.description,
        photos: data.photos,
        seats: data.seats,
        luggageCapacity: data.luggageCapacity,
        transmission: data.transmission,
        fuelType: data.fuelType,
        dailyRateJpy: data.dailyRateJpy,
        hourlyRateJpy: data.hourlyRateJpy,
        sortOrder: data.sortOrder,
        status: data.status,
      })
      .returning()

    if (!inserted) throw new Error('Failed to insert vehicle class')
    return toVehicleClass(inserted)
  }

  async update(
    id: string,
    data: Partial<VehicleClass>,
  ): Promise<VehicleClass | undefined> {
    const { id: _id, createdAt: _createdAt, ...fields } = data
    const [updated] = await this.db
      .update(vehicleClasses)
      .set({ ...fields, updatedAt: sql`now()` })
      .where(eq(vehicleClasses.id, id))
      .returning()

    return updated ? toVehicleClass(updated) : undefined
  }

  async archive(id: string): Promise<VehicleClass | undefined> {
    const [archived] = await this.db
      .update(vehicleClasses)
      .set({ status: 'ARCHIVED', updatedAt: sql`now()` })
      .where(eq(vehicleClasses.id, id))
      .returning()

    return archived ? toVehicleClass(archived) : undefined
  }
}
