import { type CallerContext, requireManagementRead } from '../../middleware/auth'
import { PG_ERROR } from '../../pg-errors'
import type { AddOn } from '../../stores'
import { operatorReadScope } from '../../tenancy'
import type { AddOnFilters, AddOnRepository } from '../types'

export class InMemoryAddOnRepository implements AddOnRepository {
  private readonly store: Map<string, AddOn>

  constructor(store?: Map<string, AddOn>) {
    this.store = store ?? new Map()
  }

  // Mirror the DB's add_on_options_active_name_unique PARTIAL index: the name
  // is reserved only among ACTIVE rows, so archiving an add-on frees its name.
  // Surfaces the same UNIQUE_VIOLATION real Postgres would on a lost
  // create/rename race — the service maps it to a friendly 409.
  private assertActiveNameFree(operatorId: string, name: string, exceptId?: string): void {
    const clash = [...this.store.values()].some(
      (o) =>
        o.operatorId === operatorId &&
        o.name === name &&
        o.status === 'ACTIVE' &&
        o.id !== exceptId,
    )
    if (clash) {
      throw Object.assign(new Error('duplicate key value violates unique constraint'), {
        code: PG_ERROR.UNIQUE_VIOLATION,
      })
    }
  }

  async findAll(ctx: CallerContext, filters?: AddOnFilters): Promise<AddOn[]> {
    // [P0] reject RENTER/PARTNER BEFORE operatorReadScope (which maps them to
    // {kind:'all'}) — add-ons are operator-private, not a public catalog.
    requireManagementRead(ctx)
    const scope = operatorReadScope(ctx)
    if (scope.kind === 'none') return []

    const all = [...this.store.values()].filter((o) => {
      // Operator scope is absolute: a stray filters.operatorId can never widen
      // it. The explicit filter only narrows a bypass-role ('all') read.
      if (scope.kind === 'operator') return o.operatorId === scope.operatorId
      if (filters?.operatorId) return o.operatorId === filters.operatorId
      return true
    })

    if (filters?.status) return all.filter((o) => o.status === filters.status)
    if (filters?.includeArchived) return all
    return all.filter((o) => o.status !== 'ARCHIVED')
  }

  async findById(ctx: CallerContext, id: string): Promise<AddOn | undefined> {
    requireManagementRead(ctx)
    const scope = operatorReadScope(ctx)
    if (scope.kind === 'none') return undefined
    const option = this.store.get(id)
    if (!option) return undefined
    if (scope.kind === 'operator' && option.operatorId !== scope.operatorId) return undefined
    return option
  }

  async findActiveByOperatorAndName(operatorId: string, name: string): Promise<AddOn | undefined> {
    return [...this.store.values()].find(
      (o) => o.operatorId === operatorId && o.name === name && o.status === 'ACTIVE',
    )
  }

  async findActiveByOperator(operatorId: string): Promise<AddOn[]> {
    return [...this.store.values()]
      .filter((o) => o.operatorId === operatorId && o.status === 'ACTIVE')
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  async create(data: Omit<AddOn, 'id' | 'createdAt' | 'updatedAt'>): Promise<AddOn> {
    if (data.status === 'ACTIVE') this.assertActiveNameFree(data.operatorId, data.name)
    const now = new Date()
    const option: AddOn = {
      ...data,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    }
    this.store.set(option.id, option)
    return option
  }

  async update(id: string, data: Partial<AddOn>): Promise<AddOn | undefined> {
    const existing = this.store.get(id)
    if (!existing) return undefined

    if (data.name !== undefined && data.name !== existing.name) {
      this.assertActiveNameFree(existing.operatorId, data.name, id)
    }

    const updated: AddOn = {
      ...existing,
      ...data,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
    }
    this.store.set(updated.id, updated)
    return updated
  }

  async archive(id: string): Promise<AddOn | undefined> {
    const existing = this.store.get(id)
    if (!existing) return undefined

    const archived: AddOn = { ...existing, status: 'ARCHIVED', updatedAt: new Date() }
    this.store.set(archived.id, archived)
    return archived
  }
}
