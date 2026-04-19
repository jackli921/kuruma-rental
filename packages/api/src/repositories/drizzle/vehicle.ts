import { vehicles } from '@kuruma/shared/db/schema'
import { type SQL, and, count, eq, inArray, ne, sql } from 'drizzle-orm'
import { type CallerContext, requireStaffContext } from '../../middleware/auth'
import type { Vehicle } from '../../stores'
import type {
  PaginatedResult,
  VehicleFilters,
  VehicleRepository,
  VehicleUpdateOptions,
} from '../types'
import { type Db, toVehicle, vehicleColumns } from './shared'

export class DrizzleVehicleRepository implements VehicleRepository {
  constructor(private readonly db: Db) {}

  async findAll(
    _ctx: CallerContext,
    filters?: VehicleFilters,
  ): Promise<PaginatedResult<Vehicle>> {
    const conditions: SQL[] = []

    if (filters?.status) {
      conditions.push(eq(vehicles.status, filters.status as Vehicle['status']))
    } else if (!filters?.includeRetired) {
      conditions.push(ne(vehicles.status, 'RETIRED'))
    }

    if (filters?.classId !== undefined) {
      conditions.push(eq(vehicles.classId, filters.classId))
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

  async findById(_ctx: CallerContext, id: string): Promise<Vehicle | undefined> {
    const [row] = await this.db.select(vehicleColumns).from(vehicles).where(eq(vehicles.id, id))

    return row ? toVehicle(row) : undefined
  }

  async findByIds(_ctx: CallerContext, ids: string[]): Promise<Vehicle[]> {
    if (ids.length === 0) return []
    const rows = await this.db
      .select(vehicleColumns)
      .from(vehicles)
      .where(inArray(vehicles.id, ids))
    return rows.map(toVehicle)
  }

  async create(
    ctx: CallerContext,
    data: Omit<Vehicle, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<Vehicle> {
    requireStaffContext(ctx)
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

  async update(
    ctx: CallerContext,
    id: string,
    data: Partial<Vehicle>,
    options?: VehicleUpdateOptions,
  ): Promise<Vehicle | undefined> {
    requireStaffContext(ctx)
    const { id: _id, createdAt: _createdAt, ...fields } = data
    const conditions = [eq(vehicles.id, id)]
    if (options?.expectedStatus) {
      conditions.push(eq(vehicles.status, options.expectedStatus))
    }
    const [updated] = await this.db
      .update(vehicles)
      .set({ ...fields, updatedAt: sql`now()` })
      .where(and(...conditions))
      .returning()

    return updated ? toVehicle(updated) : undefined
  }

  async softDelete(ctx: CallerContext, id: string): Promise<Vehicle | undefined> {
    requireStaffContext(ctx)
    const [retired] = await this.db
      .update(vehicles)
      .set({ status: 'RETIRED', updatedAt: sql`now()` })
      .where(eq(vehicles.id, id))
      .returning()

    return retired ? toVehicle(retired) : undefined
  }

  async bulkUpdateStatus(
    ctx: CallerContext,
    ids: string[],
    status: 'AVAILABLE' | 'MAINTENANCE',
  ): Promise<Vehicle[]> {
    requireStaffContext(ctx)
    if (ids.length === 0) return []
    const rows = await this.db
      .update(vehicles)
      .set({ status, updatedAt: sql`now()` })
      .where(inArray(vehicles.id, ids))
      .returning()
    return rows.map(toVehicle)
  }

  async appendPhotos(
    ctx: CallerContext,
    id: string,
    urls: string[],
    maxPhotos: number,
  ): Promise<
    { outcome: 'ok'; vehicle: Vehicle } | { outcome: 'cap_exceeded' } | { outcome: 'not_found' }
  > {
    requireStaffContext(ctx)
    // Single-statement conditional append: only succeed if the resulting
    // cardinality stays within the cap. Concurrent callers serialize at
    // the row level, so two racing uploads cannot both pass the guard.
    // URLs are chained via array_append to keep them as bound parameters
    // rather than interpolated literals.
    let photosExpr: SQL = sql`${vehicles.photos}`
    for (const url of urls) {
      photosExpr = sql`array_append(${photosExpr}, ${url})`
    }
    const [updated] = await this.db
      .update(vehicles)
      .set({ photos: photosExpr, updatedAt: sql`now()` })
      .where(
        and(
          eq(vehicles.id, id),
          sql`cardinality(${vehicles.photos}) + ${urls.length} <= ${maxPhotos}`,
        ),
      )
      .returning()

    if (updated) return { outcome: 'ok', vehicle: toVehicle(updated) }
    const existing = await this.findById(ctx, id)
    return existing ? { outcome: 'cap_exceeded' } : { outcome: 'not_found' }
  }

  async removePhotoByUrl(
    ctx: CallerContext,
    id: string,
    url: string,
  ): Promise<Vehicle | undefined> {
    requireStaffContext(ctx)
    // array_remove is atomic — no TOCTOU between read of photos and write.
    const [updated] = await this.db
      .update(vehicles)
      .set({
        photos: sql`array_remove(${vehicles.photos}, ${url})`,
        updatedAt: sql`now()`,
      })
      .where(and(eq(vehicles.id, id), sql`${url} = ANY(${vehicles.photos})`))
      .returning()
    return updated ? toVehicle(updated) : undefined
  }
}
