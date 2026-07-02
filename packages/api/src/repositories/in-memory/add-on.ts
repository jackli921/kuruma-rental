import { type CallerContext, requireManagementRead } from '../../middleware/auth'
import { PG_ERROR } from '../../pg-errors'
import type { AddOn, AddOnTemplate, AddOnWithTemplate } from '../../stores'
import { operatorReadScope } from '../../tenancy'
import type { AddOnFilters, AddOnRepository } from '../types'
import { seedDemoAddOnTemplates } from './add-on-template-seed'

export class InMemoryAddOnRepository implements AddOnRepository {
  private readonly store: Map<string, AddOn>
  // Mirrors the Drizzle LEFT JOIN add_on_templates (M4): the curated catalog the
  // reads enrich rows against. Optional + curated default so every existing
  // no-arg constructor call keeps compiling; composition passes the same
  // store the template repo uses so the list and the picker agree.
  private readonly templateStore: Map<string, AddOnTemplate>

  constructor(store?: Map<string, AddOn>, templateStore?: Map<string, AddOnTemplate>) {
    this.store = store ?? new Map()
    this.templateStore = templateStore ?? seedDemoAddOnTemplates()
  }

  // Join one row to its template bundles (null for a legacy null-templateId row,
  // or a templateId with no matching template — resolution falls back to the
  // `name`/`description` columns then).
  private enrich(o: AddOn): AddOnWithTemplate {
    const template = o.templateId ? this.templateStore.get(o.templateId) : undefined
    return {
      ...o,
      templateName: template?.name ?? null,
      templateDescription: template?.description ?? null,
    }
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

  async findAll(ctx: CallerContext, filters?: AddOnFilters): Promise<AddOnWithTemplate[]> {
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

    const visible = filters?.status
      ? all.filter((o) => o.status === filters.status)
      : filters?.includeArchived
        ? all
        : all.filter((o) => o.status !== 'ARCHIVED')
    return visible.map((o) => this.enrich(o))
  }

  async findById(ctx: CallerContext, id: string): Promise<AddOnWithTemplate | undefined> {
    requireManagementRead(ctx)
    const scope = operatorReadScope(ctx)
    if (scope.kind === 'none') return undefined
    const option = this.store.get(id)
    if (!option) return undefined
    if (scope.kind === 'operator' && option.operatorId !== scope.operatorId) return undefined
    return this.enrich(option)
  }

  // Catalog i18n (slice 2): the service dup-check keys on templateId, not name —
  // the picker excludes already-offered templates, so this 409 is a race backstop.
  async findActiveByOperatorAndTemplate(
    operatorId: string,
    templateId: string,
  ): Promise<AddOn | undefined> {
    return [...this.store.values()].find(
      (o) => o.operatorId === operatorId && o.templateId === templateId && o.status === 'ACTIVE',
    )
  }

  async findActiveByOperatorAndName(operatorId: string, name: string): Promise<AddOn | undefined> {
    return [...this.store.values()].find(
      (o) => o.operatorId === operatorId && o.name === name && o.status === 'ACTIVE',
    )
  }

  async findActiveByOperator(operatorId: string): Promise<AddOnWithTemplate[]> {
    return [...this.store.values()]
      .filter((o) => o.operatorId === operatorId && o.status === 'ACTIVE')
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((o) => this.enrich(o))
  }

  async create(data: Omit<AddOn, 'id' | 'createdAt' | 'updatedAt'>): Promise<AddOnWithTemplate> {
    if (data.status === 'ACTIVE') this.assertActiveNameFree(data.operatorId, data.name)
    const now = new Date()
    const option: AddOn = {
      ...data,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    }
    this.store.set(option.id, option)
    return this.enrich(option)
  }

  async update(
    ctx: CallerContext,
    id: string,
    data: Partial<AddOn>,
  ): Promise<AddOnWithTemplate | undefined> {
    // Add-ons are private config: reject RENTER/PARTNER at the repo, mirroring the
    // read path — else operatorReadScope maps them to {kind:'all'} (unscoped).
    requireManagementRead(ctx)
    const scope = operatorReadScope(ctx)
    if (scope.kind === 'none') return undefined
    const existing = this.store.get(id)
    if (!existing) return undefined
    // #1288: tenant-scope the write so a caller reaching the repo without the
    // service's findById guard can't mutate another operator's row by id.
    if (scope.kind === 'operator' && existing.operatorId !== scope.operatorId) return undefined

    if (data.name !== undefined && data.name !== existing.name) {
      this.assertActiveNameFree(existing.operatorId, data.name, id)
    }

    const updated: AddOn = {
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
    return this.enrich(updated)
  }

  async archive(ctx: CallerContext, id: string): Promise<AddOnWithTemplate | undefined> {
    requireManagementRead(ctx)
    const scope = operatorReadScope(ctx)
    if (scope.kind === 'none') return undefined
    const existing = this.store.get(id)
    if (!existing) return undefined
    // #1288: tenant-scope the archive (see update()).
    if (scope.kind === 'operator' && existing.operatorId !== scope.operatorId) return undefined

    const archived: AddOn = { ...existing, status: 'ARCHIVED', updatedAt: new Date() }
    this.store.set(archived.id, archived)
    return this.enrich(archived)
  }
}
