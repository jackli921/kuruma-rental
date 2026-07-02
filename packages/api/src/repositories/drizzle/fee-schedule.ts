import { feeSchedules } from '@kuruma/shared/db/schema'
import { type SQL, and, asc, eq, isNull, ne, sql } from 'drizzle-orm'
import { type CallerContext, requireManagementRead } from '../../middleware/auth'
import type { FeeSchedule } from '../../stores'
import { operatorReadScope } from '../../tenancy'
import type { FeeScheduleFilters, FeeScheduleRepository } from '../types'
import { type Db, feeScheduleColumns, toFeeSchedule } from './shared'

export class DrizzleFeeScheduleRepository implements FeeScheduleRepository {
  constructor(private readonly db: Db) {}

  async findAll(ctx: CallerContext, filters?: FeeScheduleFilters): Promise<FeeSchedule[]> {
    // [P0] private config: reject RENTER/PARTNER BEFORE operatorReadScope, which
    // maps RENTER -> {kind:'all'} (catalog is public; fees are not).
    requireManagementRead(ctx)
    const scope = operatorReadScope(ctx)
    if (scope.kind === 'none') return []

    const conditions: SQL[] = []
    if (scope.kind === 'operator') {
      conditions.push(eq(feeSchedules.operatorId, scope.operatorId))
    } else if (filters?.operatorId) {
      conditions.push(eq(feeSchedules.operatorId, filters.operatorId))
    }

    if (filters?.status) {
      conditions.push(eq(feeSchedules.status, filters.status))
    } else if (!filters?.includeArchived) {
      conditions.push(ne(feeSchedules.status, 'ARCHIVED'))
    }

    if (filters?.feeType) conditions.push(eq(feeSchedules.feeType, filters.feeType))
    if (filters?.vehicleClassId)
      conditions.push(eq(feeSchedules.vehicleClassId, filters.vehicleClassId))

    const where = conditions.length > 0 ? and(...conditions) : undefined
    const rows = await this.db
      .select(feeScheduleColumns)
      .from(feeSchedules)
      .where(where)
      .orderBy(asc(feeSchedules.feeType))

    return rows.map(toFeeSchedule)
  }

  async findById(ctx: CallerContext, id: string): Promise<FeeSchedule | undefined> {
    requireManagementRead(ctx)
    const scope = operatorReadScope(ctx)
    if (scope.kind === 'none') return undefined
    const conditions: SQL[] = [eq(feeSchedules.id, id)]
    if (scope.kind === 'operator')
      conditions.push(eq(feeSchedules.operatorId, scope.operatorId))

    const [row] = await this.db
      .select(feeScheduleColumns)
      .from(feeSchedules)
      .where(and(...conditions))
    return row ? toFeeSchedule(row) : undefined
  }

  async findActiveByScope(
    operatorId: string,
    feeType: FeeSchedule['feeType'],
    vehicleClassId: string | null,
  ): Promise<FeeSchedule | undefined> {
    // NULL != NULL in SQL equality, so operator-wide scope must use IS NULL.
    const scopeCondition =
      vehicleClassId === null
        ? isNull(feeSchedules.vehicleClassId)
        : eq(feeSchedules.vehicleClassId, vehicleClassId)
    const [row] = await this.db
      .select(feeScheduleColumns)
      .from(feeSchedules)
      .where(
        and(
          eq(feeSchedules.operatorId, operatorId),
          eq(feeSchedules.feeType, feeType),
          eq(feeSchedules.status, 'ACTIVE'),
          scopeCondition,
        ),
      )
    return row ? toFeeSchedule(row) : undefined
  }

  async create(data: Omit<FeeSchedule, 'id' | 'createdAt' | 'updatedAt'>): Promise<FeeSchedule> {
    const [inserted] = await this.db
      .insert(feeSchedules)
      .values({
        operatorId: data.operatorId,
        vehicleClassId: data.vehicleClassId,
        feeType: data.feeType,
        unit: data.unit,
        amountJpy: data.amountJpy,
        status: data.status,
      })
      .returning()

    if (!inserted) throw new Error('Failed to insert fee schedule')
    return toFeeSchedule(inserted)
  }

  async update(
    ctx: CallerContext,
    id: string,
    data: Partial<FeeSchedule>,
  ): Promise<FeeSchedule | undefined> {
    // Fees are private config: reject RENTER/PARTNER at the repo, mirroring the
    // read path — else operatorReadScope maps them to {kind:'all'} (unscoped).
    requireManagementRead(ctx)
    const scope = operatorReadScope(ctx)
    if (scope.kind === 'none') return undefined
    // operatorId is an immutable tenant anchor (#1271): strip it like id so an
    // update payload can never migrate the row to another operator (which the
    // composite FK to vehicleClasses also depends on).
    const { id: _id, createdAt: _createdAt, operatorId: _operatorId, ...fields } = data
    // #1288: scope the write by tenant so a caller reaching the repo without the
    // service's findById guard can't mutate another operator's row by id.
    const conditions = [eq(feeSchedules.id, id)]
    if (scope.kind === 'operator') conditions.push(eq(feeSchedules.operatorId, scope.operatorId))
    const [updated] = await this.db
      .update(feeSchedules)
      .set({ ...fields, updatedAt: sql`now()` })
      .where(and(...conditions))
      .returning()

    return updated ? toFeeSchedule(updated) : undefined
  }

  async archive(ctx: CallerContext, id: string): Promise<FeeSchedule | undefined> {
    requireManagementRead(ctx)
    const scope = operatorReadScope(ctx)
    if (scope.kind === 'none') return undefined
    // #1288: tenant-scope the archive WHERE (see update()).
    const conditions = [eq(feeSchedules.id, id)]
    if (scope.kind === 'operator') conditions.push(eq(feeSchedules.operatorId, scope.operatorId))
    const [archived] = await this.db
      .update(feeSchedules)
      .set({ status: 'ARCHIVED', updatedAt: sql`now()` })
      .where(and(...conditions))
      .returning()

    return archived ? toFeeSchedule(archived) : undefined
  }
}
