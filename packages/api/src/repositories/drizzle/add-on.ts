import { addOnOptions } from '@kuruma/shared/db/schema'
import { type SQL, and, asc, eq, ne, sql } from 'drizzle-orm'
import { type CallerContext, requireManagementRead } from '../../middleware/auth'
import type { AddOn } from '../../stores'
import { operatorReadScope } from '../../tenancy'
import type { AddOnFilters, AddOnRepository } from '../types'
import { type Db, addOnOptionColumns, toAddOn } from './shared'

export class DrizzleAddOnRepository implements AddOnRepository {
  constructor(private readonly db: Db) {}

  async findAll(ctx: CallerContext, filters?: AddOnFilters): Promise<AddOn[]> {
    // [P0] reject RENTER/PARTNER BEFORE operatorReadScope (which maps them to
    // {kind:'all'}) — add-ons are operator-private, not a public catalog.
    requireManagementRead(ctx)
    const scope = operatorReadScope(ctx)
    if (scope.kind === 'none') return []

    const conditions: SQL[] = []
    // Operator scope is absolute (cannot be widened by a stray filter); the
    // explicit filters.operatorId only narrows a bypass-role ('all') read.
    if (scope.kind === 'operator') {
      conditions.push(eq(addOnOptions.operatorId, scope.operatorId))
    } else if (filters?.operatorId) {
      conditions.push(eq(addOnOptions.operatorId, filters.operatorId))
    }

    if (filters?.status) {
      conditions.push(eq(addOnOptions.status, filters.status))
    } else if (!filters?.includeArchived) {
      conditions.push(ne(addOnOptions.status, 'ARCHIVED'))
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined
    const rows = await this.db
      .select(addOnOptionColumns)
      .from(addOnOptions)
      .where(where)
      .orderBy(asc(addOnOptions.name))

    return rows.map(toAddOn)
  }

  async findById(ctx: CallerContext, id: string): Promise<AddOn | undefined> {
    requireManagementRead(ctx)
    const scope = operatorReadScope(ctx)
    if (scope.kind === 'none') return undefined
    const conditions: SQL[] = [eq(addOnOptions.id, id)]
    if (scope.kind === 'operator') {
      conditions.push(eq(addOnOptions.operatorId, scope.operatorId))
    }

    const [row] = await this.db.select(addOnOptionColumns).from(addOnOptions).where(and(...conditions))
    return row ? toAddOn(row) : undefined
  }

  async findActiveByOperatorAndName(operatorId: string, name: string): Promise<AddOn | undefined> {
    const [row] = await this.db
      .select(addOnOptionColumns)
      .from(addOnOptions)
      .where(
        and(
          eq(addOnOptions.operatorId, operatorId),
          eq(addOnOptions.name, name),
          eq(addOnOptions.status, 'ACTIVE'),
        ),
      )
    return row ? toAddOn(row) : undefined
  }

  async findActiveByOperator(operatorId: string): Promise<AddOn[]> {
    const rows = await this.db
      .select(addOnOptionColumns)
      .from(addOnOptions)
      .where(and(eq(addOnOptions.operatorId, operatorId), eq(addOnOptions.status, 'ACTIVE')))
      .orderBy(asc(addOnOptions.name))
    return rows.map(toAddOn)
  }

  async create(data: Omit<AddOn, 'id' | 'createdAt' | 'updatedAt'>): Promise<AddOn> {
    const [inserted] = await this.db
      .insert(addOnOptions)
      .values({
        operatorId: data.operatorId,
        name: data.name,
        description: data.description,
        priceJpy: data.priceJpy,
        status: data.status,
      })
      .returning()

    if (!inserted) throw new Error('Failed to insert add-on')
    return toAddOn(inserted)
  }

  async update(ctx: CallerContext, id: string, data: Partial<AddOn>): Promise<AddOn | undefined> {
    // Add-ons are private config: reject RENTER/PARTNER at the repo, mirroring the
    // read path — else operatorReadScope maps them to {kind:'all'} (unscoped).
    requireManagementRead(ctx)
    const scope = operatorReadScope(ctx)
    if (scope.kind === 'none') return undefined
    // operatorId is an immutable tenant anchor (#1271): strip it like id so an
    // update payload can never migrate the row to another operator.
    const { id: _id, createdAt: _createdAt, operatorId: _operatorId, ...fields } = data
    // #1288: scope the write by tenant so a caller reaching the repo without the
    // service's findById guard can't mutate another operator's row by id.
    const conditions = [eq(addOnOptions.id, id)]
    if (scope.kind === 'operator') conditions.push(eq(addOnOptions.operatorId, scope.operatorId))
    const [updated] = await this.db
      .update(addOnOptions)
      .set({ ...fields, updatedAt: sql`now()` })
      .where(and(...conditions))
      .returning()

    return updated ? toAddOn(updated) : undefined
  }

  async archive(ctx: CallerContext, id: string): Promise<AddOn | undefined> {
    requireManagementRead(ctx)
    const scope = operatorReadScope(ctx)
    if (scope.kind === 'none') return undefined
    // #1288: tenant-scope the archive WHERE (see update()).
    const conditions = [eq(addOnOptions.id, id)]
    if (scope.kind === 'operator') conditions.push(eq(addOnOptions.operatorId, scope.operatorId))
    const [archived] = await this.db
      .update(addOnOptions)
      .set({ status: 'ARCHIVED', updatedAt: sql`now()` })
      .where(and(...conditions))
      .returning()

    return archived ? toAddOn(archived) : undefined
  }
}
