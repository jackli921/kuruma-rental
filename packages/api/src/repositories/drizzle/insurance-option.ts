import { insuranceOptions } from '@kuruma/shared/db/schema'
import { type SQL, and, asc, eq, ne, sql } from 'drizzle-orm'
import { type CallerContext, requireManagementRead } from '../../middleware/auth'
import type { InsuranceOption } from '../../stores'
import { operatorReadScope } from '../../tenancy'
import type { InsuranceOptionFilters, InsuranceOptionRepository } from '../types'
import { type Db, insuranceOptionColumns, toInsuranceOption } from './shared'

export class DrizzleInsuranceOptionRepository implements InsuranceOptionRepository {
  constructor(private readonly db: Db) {}

  async findAll(
    ctx: CallerContext,
    filters?: InsuranceOptionFilters,
  ): Promise<InsuranceOption[]> {
    // [P0] reject RENTER/PARTNER BEFORE operatorReadScope (which maps them to
    // {kind:'all'}) — insurance is operator-private, not a public catalog.
    requireManagementRead(ctx)
    const scope = operatorReadScope(ctx)
    if (scope.kind === 'none') return []

    const conditions: SQL[] = []
    // Operator scope is absolute (cannot be widened by a stray filter); the
    // explicit filters.operatorId only narrows a bypass-role ('all') read.
    if (scope.kind === 'operator') {
      conditions.push(eq(insuranceOptions.operatorId, scope.operatorId))
    } else if (filters?.operatorId) {
      conditions.push(eq(insuranceOptions.operatorId, filters.operatorId))
    }

    if (filters?.status) {
      conditions.push(eq(insuranceOptions.status, filters.status))
    } else if (!filters?.includeArchived) {
      conditions.push(ne(insuranceOptions.status, 'ARCHIVED'))
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined
    const rows = await this.db
      .select(insuranceOptionColumns)
      .from(insuranceOptions)
      .where(where)
      .orderBy(asc(insuranceOptions.name))

    return rows.map(toInsuranceOption)
  }

  async findById(ctx: CallerContext, id: string): Promise<InsuranceOption | undefined> {
    requireManagementRead(ctx)
    const scope = operatorReadScope(ctx)
    if (scope.kind === 'none') return undefined
    const conditions: SQL[] = [eq(insuranceOptions.id, id)]
    if (scope.kind === 'operator') {
      conditions.push(eq(insuranceOptions.operatorId, scope.operatorId))
    }

    const [row] = await this.db
      .select(insuranceOptionColumns)
      .from(insuranceOptions)
      .where(and(...conditions))
    return row ? toInsuranceOption(row) : undefined
  }

  async findActiveByOperatorAndName(
    operatorId: string,
    name: string,
  ): Promise<InsuranceOption | undefined> {
    const [row] = await this.db
      .select(insuranceOptionColumns)
      .from(insuranceOptions)
      .where(
        and(
          eq(insuranceOptions.operatorId, operatorId),
          eq(insuranceOptions.name, name),
          eq(insuranceOptions.status, 'ACTIVE'),
        ),
      )
    return row ? toInsuranceOption(row) : undefined
  }

  async findActiveByOperator(operatorId: string): Promise<InsuranceOption[]> {
    const rows = await this.db
      .select(insuranceOptionColumns)
      .from(insuranceOptions)
      .where(
        and(eq(insuranceOptions.operatorId, operatorId), eq(insuranceOptions.status, 'ACTIVE')),
      )
      .orderBy(asc(insuranceOptions.name))
    return rows.map(toInsuranceOption)
  }

  async create(
    data: Omit<InsuranceOption, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<InsuranceOption> {
    const [inserted] = await this.db
      .insert(insuranceOptions)
      .values({
        operatorId: data.operatorId,
        name: data.name,
        // #1437 slice 3: MUST be enumerated — `.values()` silently drops a
        // nullable column left out here (tsc treats it as optional), so an
        // omission would persist nameI18n=null in Postgres while the in-memory
        // repo (which spreads ...data) keeps it, hiding the bug from unit tests.
        nameI18n: data.nameI18n,
        description: data.description,
        dailyPriceJpy: data.dailyPriceJpy,
        deductibleJpy: data.deductibleJpy,
        status: data.status,
      })
      .returning()

    if (!inserted) throw new Error('Failed to insert insurance option')
    return toInsuranceOption(inserted)
  }

  async update(
    ctx: CallerContext,
    id: string,
    data: Partial<InsuranceOption>,
  ): Promise<InsuranceOption | undefined> {
    // Insurance is private config: reject RENTER/PARTNER at the repo, mirroring
    // the read path — else operatorReadScope maps them to {kind:'all'} (unscoped).
    requireManagementRead(ctx)
    const scope = operatorReadScope(ctx)
    if (scope.kind === 'none') return undefined
    // operatorId is an immutable tenant anchor (#1271): strip it like id so an
    // update payload can never migrate the row to another operator.
    const { id: _id, createdAt: _createdAt, operatorId: _operatorId, ...fields } = data
    // #1288: scope the write by tenant so a caller reaching the repo without the
    // service's findById guard can't mutate another operator's row by id.
    const conditions = [eq(insuranceOptions.id, id)]
    if (scope.kind === 'operator') conditions.push(eq(insuranceOptions.operatorId, scope.operatorId))
    const [updated] = await this.db
      .update(insuranceOptions)
      .set({ ...fields, updatedAt: sql`now()` })
      .where(and(...conditions))
      .returning()

    return updated ? toInsuranceOption(updated) : undefined
  }

  async archive(ctx: CallerContext, id: string): Promise<InsuranceOption | undefined> {
    requireManagementRead(ctx)
    const scope = operatorReadScope(ctx)
    if (scope.kind === 'none') return undefined
    // #1288: tenant-scope the archive WHERE (see update()).
    const conditions = [eq(insuranceOptions.id, id)]
    if (scope.kind === 'operator') conditions.push(eq(insuranceOptions.operatorId, scope.operatorId))
    const [archived] = await this.db
      .update(insuranceOptions)
      .set({ status: 'ARCHIVED', updatedAt: sql`now()` })
      .where(and(...conditions))
      .returning()

    return archived ? toInsuranceOption(archived) : undefined
  }
}
