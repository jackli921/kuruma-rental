import { vehicleClasses } from '@kuruma/shared/db/schema'
import { type SQL, and, asc, eq, ne, sql } from 'drizzle-orm'
import type { CallerContext } from '../../middleware/auth'
import type { VehicleClass } from '../../stores'
import { operatorReadScope } from '../../tenancy'
import type { VehicleClassFilters, VehicleClassRepository } from '../types'
import {
  type Db,
  type PhotoDecoder,
  type PhotoEncoder,
  identityPhotoDecoder,
  identityPhotoEncoder,
  toVehicleClass,
  vehicleClassColumns,
} from './shared'

export class DrizzleVehicleClassRepository implements VehicleClassRepository {
  constructor(
    private readonly db: Db,
    private readonly decodePhotos: PhotoDecoder = identityPhotoDecoder,
    // #879: wire URLs -> stored refs (r2:<key>) on write, symmetric with decode.
    private readonly encodePhotos: PhotoEncoder = identityPhotoEncoder,
  ) {}

  async findAll(ctx: CallerContext, filters?: VehicleClassFilters): Promise<VehicleClass[]> {
    const scope = operatorReadScope(ctx)
    const conditions: SQL[] = []
    if (scope.kind === 'operator') {
      conditions.push(eq(vehicleClasses.operatorId, scope.operatorId))
    } else if (scope.kind === 'none') {
      conditions.push(sql`false`)
    }
    if (filters?.operatorId) {
      conditions.push(eq(vehicleClasses.operatorId, filters.operatorId))
    }

    if (filters?.status) {
      conditions.push(eq(vehicleClasses.status, filters.status))
    } else if (!filters?.includeArchived) {
      conditions.push(ne(vehicleClasses.status, 'ARCHIVED'))
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined
    const rows = await this.db
      .select(vehicleClassColumns)
      .from(vehicleClasses)
      .where(where)
      .orderBy(asc(vehicleClasses.sortOrder))

    return rows.map((r) => toVehicleClass(r, this.decodePhotos))
  }

  async findById(ctx: CallerContext, id: string): Promise<VehicleClass | undefined> {
    const scope = operatorReadScope(ctx)
    if (scope.kind === 'none') return undefined
    const conditions: SQL[] = [eq(vehicleClasses.id, id)]
    if (scope.kind === 'operator') conditions.push(eq(vehicleClasses.operatorId, scope.operatorId))

    const [row] = await this.db.select(vehicleClassColumns).from(vehicleClasses).where(and(...conditions))

    return row ? toVehicleClass(row, this.decodePhotos) : undefined
  }

  async findBySlug(ctx: CallerContext, slug: string): Promise<VehicleClass | undefined> {
    const scope = operatorReadScope(ctx)
    if (scope.kind === 'none') return undefined
    const conditions: SQL[] = [eq(vehicleClasses.slug, slug)]
    if (scope.kind === 'operator') conditions.push(eq(vehicleClasses.operatorId, scope.operatorId))

    const [row] = await this.db.select(vehicleClassColumns).from(vehicleClasses).where(and(...conditions))

    return row ? toVehicleClass(row, this.decodePhotos) : undefined
  }

  async create(
    data: Omit<VehicleClass, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<VehicleClass> {
    const [inserted] = await this.db
      .insert(vehicleClasses)
      .values({
        operatorId: data.operatorId,
        name: data.name,
        slug: data.slug,
        description: data.description,
        // undefined => omit so the column DB default ([]) applies; defined =>
        // encode wire URLs to stored refs.
        photos: data.photos === undefined ? undefined : this.encodePhotos(data.photos),
        seats: data.seats,
        luggageCapacity: data.luggageCapacity,
        luggageSize: data.luggageSize,
        transmission: data.transmission,
        fuelType: data.fuelType,
        acrissCode: data.acrissCode,
        sortOrder: data.sortOrder,
        status: data.status,
      })
      .returning()

    if (!inserted) throw new Error('Failed to insert vehicle class')
    return toVehicleClass(inserted, this.decodePhotos)
  }

  async update(
    ctx: CallerContext,
    id: string,
    data: Partial<VehicleClass>,
  ): Promise<VehicleClass | undefined> {
    const scope = operatorReadScope(ctx)
    if (scope.kind === 'none') return undefined
    // operatorId is an immutable tenant anchor (#1279): strip it like id so an
    // update payload can never migrate the row to another operator.
    const { id: _id, operatorId: _operatorId, createdAt: _createdAt, ...fields } = data
    // #879: re-encode an edited photos array; absent key leaves it untouched.
    const set =
      fields.photos === undefined
        ? fields
        : { ...fields, photos: this.encodePhotos(fields.photos) }
    // #1288: scope the write by tenant so a caller reaching the repo without the
    // service's findById guard can't mutate another operator's row by id.
    const conditions = [eq(vehicleClasses.id, id)]
    if (scope.kind === 'operator') conditions.push(eq(vehicleClasses.operatorId, scope.operatorId))
    const [updated] = await this.db
      .update(vehicleClasses)
      .set({ ...set, updatedAt: sql`now()` })
      .where(and(...conditions))
      .returning()

    return updated ? toVehicleClass(updated, this.decodePhotos) : undefined
  }

  async archive(ctx: CallerContext, id: string): Promise<VehicleClass | undefined> {
    const scope = operatorReadScope(ctx)
    if (scope.kind === 'none') return undefined
    // #1288: tenant-scope the archive WHERE (see update()).
    const conditions = [eq(vehicleClasses.id, id)]
    if (scope.kind === 'operator') conditions.push(eq(vehicleClasses.operatorId, scope.operatorId))
    const [archived] = await this.db
      .update(vehicleClasses)
      .set({ status: 'ARCHIVED', updatedAt: sql`now()` })
      .where(and(...conditions))
      .returning()

    return archived ? toVehicleClass(archived, this.decodePhotos) : undefined
  }
}
