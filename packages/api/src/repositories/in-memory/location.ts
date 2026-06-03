import type { CallerContext } from '../../middleware/auth'
import type { Location } from '../../stores'
import { operatorReadScope } from '../../tenancy'
import type { LocationFilters, LocationRepository } from '../types'

export class InMemoryLocationRepository implements LocationRepository {
  private readonly store: Map<string, Location>

  constructor(store?: Map<string, Location>) {
    this.store = store ?? new Map()
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

  async findByOperatorAndName(operatorId: string, name: string): Promise<Location | undefined> {
    return [...this.store.values()].find((l) => l.operatorId === operatorId && l.name === name)
  }

  async create(data: Omit<Location, 'id' | 'createdAt' | 'updatedAt'>): Promise<Location> {
    const now = new Date()
    const location: Location = { ...data, id: crypto.randomUUID(), createdAt: now, updatedAt: now }
    this.store.set(location.id, location)
    return location
  }

  async update(id: string, data: Partial<Location>): Promise<Location | undefined> {
    const existing = this.store.get(id)
    if (!existing) return undefined

    const updated: Location = {
      ...existing,
      ...data,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
    }
    this.store.set(updated.id, updated)
    return updated
  }

  async archive(id: string): Promise<Location | undefined> {
    const existing = this.store.get(id)
    if (!existing) return undefined

    const archived: Location = { ...existing, status: 'ARCHIVED', updatedAt: new Date() }
    this.store.set(archived.id, archived)
    return archived
  }
}
