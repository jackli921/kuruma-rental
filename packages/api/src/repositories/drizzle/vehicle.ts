import { vehicles } from '@kuruma/shared/db/schema'
import { type SQL, and, count, eq, inArray, ne, sql } from 'drizzle-orm'
import { type CallerContext, requireFleetWriteScope } from '../../middleware/auth'
import type { Vehicle } from '../../stores'
import { operatorReadScope } from '../../tenancy'
import type {
  PaginatedResult,
  VehicleFilters,
  VehicleRepository,
  VehicleUpdateOptions,
} from '../types'
import { type Db, toVehicle, vehicleColumns } from './shared'

export class DrizzleVehicleRepository implements VehicleRepository {
  constructor(private readonly db: Db) {}

  async findAll(ctx: CallerContext, filters?: VehicleFilters): Promise<PaginatedResult<Vehicle>> {
    const conditions: SQL[] = []

    // Tenant scope: operators see only their vehicles; bypass roles see all;
    // a scoped caller with no tenant sees nothing (#386).
    const scope = operatorReadScope(ctx)
    if (scope.kind === 'operator') {
      conditions.push(eq(vehicles.operatorId, scope.operatorId))
    } else if (scope.kind === 'none') {
      conditions.push(sql`false`)
    }

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

  async findById(ctx: CallerContext, id: string): Promise<Vehicle | undefined> {
    const scope = operatorReadScope(ctx)
    if (scope.kind === 'none') return undefined
    const conditions: SQL[] = [eq(vehicles.id, id)]
    if (scope.kind === 'operator') conditions.push(eq(vehicles.operatorId, scope.operatorId))

    const [row] = await this.db
      .select(vehicleColumns)
      .from(vehicles)
      .where(and(...conditions))

    return row ? toVehicle(row) : undefined
  }

  async findByIds(ctx: CallerContext, ids: string[]): Promise<Vehicle[]> {
    if (ids.length === 0) return []
    const scope = operatorReadScope(ctx)
    if (scope.kind === 'none') return []
    const conditions: SQL[] = [inArray(vehicles.id, ids)]
    if (scope.kind === 'operator') conditions.push(eq(vehicles.operatorId, scope.operatorId))
    const rows = await this.db
      .select(vehicleColumns)
      .from(vehicles)
      .where(and(...conditions))
    return rows.map(toVehicle)
  }

  async create(
    ctx: CallerContext,
    data: Omit<Vehicle, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<Vehicle> {
    requireFleetWriteScope(ctx)
    const [inserted] = await this.db
      .insert(vehicles)
      .values({
        // operatorId arrives already resolved by the route's write-operator
        // resolver (#401); the repo trusts it. requireFleetWriteScope above is
        // the repo-layer authz seal, and the composite FK seals cross-tenant
        // classId at the DB (#395).
        operatorId: data.operatorId,
        classId: data.classId,
        // Storefront placement (#435). Composite FK (operatorId, pickupLocationId)
        // -> locations seals it to the vehicle's own tenant at the DB (#387).
        pickupLocationId: data.pickupLocationId,
        name: data.name,
        description: data.description,
        photos: data.photos,
        seats: data.seats,
        luggageCapacity: data.luggageCapacity,
        luggageSize: data.luggageSize,
        transmission: data.transmission,
        fuelType: data.fuelType,
        licensePlate: data.licensePlate,
        status: data.status,
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
    requireFleetWriteScope(ctx)
    // operatorId is the tenant anchor — never reassignable via an update, or a
    // caller could move a vehicle to another tenant (#386 F2). Strip it here.
    const { id: _id, createdAt: _createdAt, operatorId: _operatorId, ...fields } = data
    const scope = operatorReadScope(ctx)
    const conditions = [eq(vehicles.id, id)]
    if (scope.kind === 'operator') conditions.push(eq(vehicles.operatorId, scope.operatorId))
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
    requireFleetWriteScope(ctx)
    const scope = operatorReadScope(ctx)
    const conditions = [eq(vehicles.id, id)]
    if (scope.kind === 'operator') conditions.push(eq(vehicles.operatorId, scope.operatorId))
    const [retired] = await this.db
      .update(vehicles)
      .set({ status: 'RETIRED', updatedAt: sql`now()` })
      .where(and(...conditions))
      .returning()

    return retired ? toVehicle(retired) : undefined
  }

  async bulkUpdateStatus(
    ctx: CallerContext,
    ids: string[],
    status: 'AVAILABLE' | 'MAINTENANCE',
  ): Promise<Vehicle[]> {
    requireFleetWriteScope(ctx)
    if (ids.length === 0) return []
    const scope = operatorReadScope(ctx)
    const conditions: SQL[] = [inArray(vehicles.id, ids)]
    if (scope.kind === 'operator') conditions.push(eq(vehicles.operatorId, scope.operatorId))
    const rows = await this.db
      .update(vehicles)
      .set({ status, updatedAt: sql`now()` })
      .where(and(...conditions))
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
    requireFleetWriteScope(ctx)
    const scope = operatorReadScope(ctx)
    // Single-statement conditional append: only succeed if the resulting
    // cardinality stays within the cap. Concurrent callers serialize at
    // the row level, so two racing uploads cannot both pass the guard.
    // URLs are chained via array_append to keep them as bound parameters
    // rather than interpolated literals.
    let photosExpr: SQL = sql`${vehicles.photos}`
    for (const url of urls) {
      photosExpr = sql`array_append(${photosExpr}, ${url})`
    }
    const conditions: SQL[] = [
      eq(vehicles.id, id),
      sql`cardinality(${vehicles.photos}) + ${urls.length} <= ${maxPhotos}`,
    ]
    if (scope.kind === 'operator') conditions.push(eq(vehicles.operatorId, scope.operatorId))
    const [updated] = await this.db
      .update(vehicles)
      .set({ photos: photosExpr, updatedAt: sql`now()` })
      .where(and(...conditions))
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
    requireFleetWriteScope(ctx)
    const scope = operatorReadScope(ctx)
    // array_remove is atomic — no TOCTOU between read of photos and write.
    const conditions: SQL[] = [eq(vehicles.id, id), sql`${url} = ANY(${vehicles.photos})`]
    if (scope.kind === 'operator') conditions.push(eq(vehicles.operatorId, scope.operatorId))
    const [updated] = await this.db
      .update(vehicles)
      .set({
        photos: sql`array_remove(${vehicles.photos}, ${url})`,
        updatedAt: sql`now()`,
      })
      .where(and(...conditions))
      .returning()
    return updated ? toVehicle(updated) : undefined
  }
}
