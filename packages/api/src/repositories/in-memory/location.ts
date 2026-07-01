import type { CoordinateSource } from '@kuruma/shared/db/schema'
import type { CallerContext } from '../../middleware/auth'
import { PG_ERROR } from '../../pg-errors'
import type { Location } from '../../stores'
import { operatorReadScope } from '../../tenancy'
import type { LocationFilters, LocationRepository } from '../types'

export class InMemoryLocationRepository implements LocationRepository {
  private readonly store: Map<string, Location>

  constructor(store?: Map<string, Location>) {
    this.store = store ?? new Map()
  }

  // Mirror the DB's partial unique index seal (#410) so this in-memory double
  // surfaces the same UNIQUE_VIOLATION the real Postgres would on a lost
  // create/rename race — the service maps it to a friendly 409. Only live
  // (non-archived) rows clash: an archived location has freed its name.
  private assertNameFree(operatorId: string, name: string, exceptId?: string): void {
    const clash = [...this.store.values()].some(
      (l) =>
        l.operatorId === operatorId &&
        l.name === name &&
        l.status !== 'ARCHIVED' &&
        l.id !== exceptId,
    )
    if (clash) {
      throw Object.assign(new Error('duplicate key value violates unique constraint'), {
        code: PG_ERROR.UNIQUE_VIOLATION,
      })
    }
  }

  async findAll(ctx: CallerContext, filters?: LocationFilters): Promise<Location[]> {
    const scope = operatorReadScope(ctx)
    if (scope.kind === 'none') return []

    const all = [...this.store.values()].filter((l) => {
      // Operator scope is absolute: an operator only ever sees its own tenant,
      // and a stray filters.operatorId can never widen that. The explicit
      // filter only narrows bypass-role ('all') reads to a single operator.
      if (scope.kind === 'operator') return l.operatorId === scope.operatorId
      if (filters?.operatorId) return l.operatorId === filters.operatorId
      return true
    })

    if (filters?.status) return all.filter((l) => l.status === filters.status)
    if (filters?.includeArchived) return all
    return all.filter((l) => l.status !== 'ARCHIVED')
  }

  async findById(ctx: CallerContext, id: string): Promise<Location | undefined> {
    const scope = operatorReadScope(ctx)
    if (scope.kind === 'none') return undefined
    const location = this.store.get(id)
    if (!location) return undefined
    if (scope.kind === 'operator' && location.operatorId !== scope.operatorId) return undefined
    return location
  }

  // Active-only to agree with the partial unique index (#410): the service's
  // friendly-409 pre-check must not treat an archived name as taken.
  async findByOperatorAndName(operatorId: string, name: string): Promise<Location | undefined> {
    return [...this.store.values()].find(
      (l) => l.operatorId === operatorId && l.name === name && l.status !== 'ARCHIVED',
    )
  }

  async create(
    data: Omit<
      Location,
      'id' | 'createdAt' | 'updatedAt' | 'latitude' | 'longitude' | 'coordinateSource' | 'regionId'
    > & {
      latitude?: number | null
      longitude?: number | null
      coordinateSource?: CoordinateSource | null
      regionId?: string | null
    },
  ): Promise<Location> {
    this.assertNameFree(data.operatorId, data.name)
    const now = new Date()
    const location: Location = {
      ...data,
      latitude: data.latitude ?? null,
      longitude: data.longitude ?? null,
      coordinateSource: data.coordinateSource ?? null,
      regionId: data.regionId ?? null,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    }
    this.store.set(location.id, location)
    return location
  }

  async update(
    ctx: CallerContext,
    id: string,
    data: Partial<Location>,
  ): Promise<Location | undefined> {
    const scope = operatorReadScope(ctx)
    if (scope.kind === 'none') return undefined
    const existing = this.store.get(id)
    if (!existing) return undefined
    // #1288: tenant-scope the write so a caller reaching the repo without the
    // service's findById guard can't mutate another operator's row by id.
    if (scope.kind === 'operator' && existing.operatorId !== scope.operatorId) return undefined

    if (data.name !== undefined && data.name !== existing.name) {
      this.assertNameFree(existing.operatorId, data.name, id)
    }

    const updated: Location = {
      ...existing,
      ...data,
      id: existing.id,
      // operatorId is an immutable tenant anchor (#1279): pin it like id so an
      // update payload can never migrate the row to another operator.
      operatorId: existing.operatorId,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
    }
    this.store.set(updated.id, updated)
    return updated
  }

  async archive(ctx: CallerContext, id: string): Promise<Location | undefined> {
    const scope = operatorReadScope(ctx)
    if (scope.kind === 'none') return undefined
    const existing = this.store.get(id)
    if (!existing) return undefined
    // #1288: tenant-scope the archive (see update()).
    if (scope.kind === 'operator' && existing.operatorId !== scope.operatorId) return undefined

    const archived: Location = { ...existing, status: 'ARCHIVED', updatedAt: new Date() }
    this.store.set(archived.id, archived)
    return archived
  }
}
