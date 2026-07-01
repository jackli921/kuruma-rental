import type { CoordinateSource } from '@kuruma/shared/db/schema'
import { locations } from '@kuruma/shared/db/schema'
import { type SQL, and, asc, eq, ne, sql } from 'drizzle-orm'
import type { CallerContext } from '../../middleware/auth'
import type { Location } from '../../stores'
import { operatorReadScope } from '../../tenancy'
import type { LocationFilters, LocationRepository } from '../types'
import { type Db, locationColumns, toLocation } from './shared'

export class DrizzleLocationRepository implements LocationRepository {
  constructor(private readonly db: Db) {}

  async findAll(ctx: CallerContext, filters?: LocationFilters): Promise<Location[]> {
    const scope = operatorReadScope(ctx)
    if (scope.kind === 'none') return []

    const conditions: SQL[] = []
    // Operator scope is absolute (cannot be widened by a stray filter); the
    // explicit filters.operatorId only narrows a bypass-role ('all') read.
    if (scope.kind === 'operator') {
      conditions.push(eq(locations.operatorId, scope.operatorId))
    } else if (filters?.operatorId) {
      conditions.push(eq(locations.operatorId, filters.operatorId))
    }

    if (filters?.status) {
      conditions.push(eq(locations.status, filters.status))
    } else if (!filters?.includeArchived) {
      conditions.push(ne(locations.status, 'ARCHIVED'))
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined
    const rows = await this.db
      .select(locationColumns)
      .from(locations)
      .where(where)
      .orderBy(asc(locations.name))

    return rows.map(toLocation)
  }

  async findById(ctx: CallerContext, id: string): Promise<Location | undefined> {
    const scope = operatorReadScope(ctx)
    if (scope.kind === 'none') return undefined
    const conditions: SQL[] = [eq(locations.id, id)]
    if (scope.kind === 'operator') conditions.push(eq(locations.operatorId, scope.operatorId))

    const [row] = await this.db.select(locationColumns).from(locations).where(and(...conditions))
    return row ? toLocation(row) : undefined
  }

  // Powers the service's friendly-409 pre-check, so it must agree with the
  // partial unique index (#410): only a live (non-archived) location counts as
  // a name clash — an archived one has freed its name.
  async findByOperatorAndName(operatorId: string, name: string): Promise<Location | undefined> {
    const [row] = await this.db
      .select(locationColumns)
      .from(locations)
      .where(
        and(
          eq(locations.operatorId, operatorId),
          eq(locations.name, name),
          ne(locations.status, 'ARCHIVED'),
        ),
      )
    return row ? toLocation(row) : undefined
  }

  async create(
    data: Omit<
      Location,
      | 'id'
      | 'createdAt'
      | 'updatedAt'
      | 'latitude'
      | 'longitude'
      | 'coordinateSource'
      | 'regionId'
    > & {
      latitude?: number | null
      longitude?: number | null
      coordinateSource?: CoordinateSource | null
      regionId?: string | null
    },
  ): Promise<Location> {
    const [inserted] = await this.db
      .insert(locations)
      .values({
        operatorId: data.operatorId,
        name: data.name,
        address: data.address,
        latitude: data.latitude ?? null,
        longitude: data.longitude ?? null,
        coordinateSource: data.coordinateSource ?? null,
        operatingHours: data.operatingHours,
        timezone: data.timezone,
        defaultTurnaroundMinutes: data.defaultTurnaroundMinutes,
        regionId: data.regionId ?? null,
        status: data.status,
      })
      .returning()

    if (!inserted) throw new Error('Failed to insert location')
    return toLocation(inserted)
  }

  async update(
    ctx: CallerContext,
    id: string,
    data: Partial<Location>,
  ): Promise<Location | undefined> {
    const scope = operatorReadScope(ctx)
    if (scope.kind === 'none') return undefined
    // operatorId is an immutable tenant anchor (#1279): strip it like id so an
    // update payload can never migrate the row to another operator.
    const { id: _id, operatorId: _operatorId, createdAt: _createdAt, ...fields } = data
    // #1288: scope the write by tenant so a caller reaching the repo without the
    // service's findById guard can't mutate another operator's row by id.
    const conditions = [eq(locations.id, id)]
    if (scope.kind === 'operator') conditions.push(eq(locations.operatorId, scope.operatorId))
    const [updated] = await this.db
      .update(locations)
      .set({ ...fields, updatedAt: sql`now()` })
      .where(and(...conditions))
      .returning()

    return updated ? toLocation(updated) : undefined
  }

  async archive(ctx: CallerContext, id: string): Promise<Location | undefined> {
    const scope = operatorReadScope(ctx)
    if (scope.kind === 'none') return undefined
    // #1288: tenant-scope the archive WHERE (see update()).
    const conditions = [eq(locations.id, id)]
    if (scope.kind === 'operator') conditions.push(eq(locations.operatorId, scope.operatorId))
    const [archived] = await this.db
      .update(locations)
      .set({ status: 'ARCHIVED', updatedAt: sql`now()` })
      .where(and(...conditions))
      .returning()

    return archived ? toLocation(archived) : undefined
  }
}
