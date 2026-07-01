import { type CallerContext, requireManagementRead } from '../../middleware/auth'
import { PG_ERROR } from '../../pg-errors'
import type { InsuranceOption } from '../../stores'
import { operatorReadScope } from '../../tenancy'
import type { InsuranceOptionFilters, InsuranceOptionRepository } from '../types'

export class InMemoryInsuranceOptionRepository implements InsuranceOptionRepository {
  private readonly store: Map<string, InsuranceOption>

  constructor(store?: Map<string, InsuranceOption>) {
    this.store = store ?? new Map()
  }

  // Mirror the DB's insurance_options_active_name_unique PARTIAL index: the
  // name is reserved only among ACTIVE rows, so archiving an option frees its
  // name. Surfaces the same UNIQUE_VIOLATION real Postgres would on a lost
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

  async findAll(ctx: CallerContext, filters?: InsuranceOptionFilters): Promise<InsuranceOption[]> {
    // [P0] reject RENTER/PARTNER BEFORE operatorReadScope (which maps them to
    // {kind:'all'}) — insurance is operator-private, not a public catalog.
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

  async findById(ctx: CallerContext, id: string): Promise<InsuranceOption | undefined> {
    requireManagementRead(ctx)
    const scope = operatorReadScope(ctx)
    if (scope.kind === 'none') return undefined
    const option = this.store.get(id)
    if (!option) return undefined
    if (scope.kind === 'operator' && option.operatorId !== scope.operatorId) return undefined
    return option
  }

  async findActiveByOperatorAndName(
    operatorId: string,
    name: string,
  ): Promise<InsuranceOption | undefined> {
    return [...this.store.values()].find(
      (o) => o.operatorId === operatorId && o.name === name && o.status === 'ACTIVE',
    )
  }

  async findActiveByOperator(operatorId: string): Promise<InsuranceOption[]> {
    return [...this.store.values()]
      .filter((o) => o.operatorId === operatorId && o.status === 'ACTIVE')
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  async create(
    data: Omit<InsuranceOption, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<InsuranceOption> {
    if (data.status === 'ACTIVE') this.assertActiveNameFree(data.operatorId, data.name)
    const now = new Date()
    const option: InsuranceOption = {
      ...data,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    }
    this.store.set(option.id, option)
    return option
  }

  async update(id: string, data: Partial<InsuranceOption>): Promise<InsuranceOption | undefined> {
    const existing = this.store.get(id)
    if (!existing) return undefined

    if (data.name !== undefined && data.name !== existing.name) {
      this.assertActiveNameFree(existing.operatorId, data.name, id)
    }

    const updated: InsuranceOption = {
      ...existing,
      ...data,
      id: existing.id,
      // operatorId is an immutable tenant anchor (#1271): pin it like id so an
      // update payload can never migrate the row to another operator.
      operatorId: existing.operatorId,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
    }
    this.store.set(updated.id, updated)
    return updated
  }

  async archive(id: string): Promise<InsuranceOption | undefined> {
    const existing = this.store.get(id)
    if (!existing) return undefined

    const archived: InsuranceOption = { ...existing, status: 'ARCHIVED', updatedAt: new Date() }
    this.store.set(archived.id, archived)
    return archived
  }
}
