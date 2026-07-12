import { classRatePlans } from '@kuruma/shared/db/schema'
import { type SQL, and, eq, inArray } from 'drizzle-orm'
import { type CallerContext, requireManagementRead } from '../../middleware/auth'
import type { ClassRatePlan } from '../../stores'
import { operatorReadScope } from '../../tenancy'
import type { ClassRatePlanFilters, ClassRatePlanRepository } from '../types'
import { type Db, classRatePlanColumns, toClassRatePlan } from './shared'

export class DrizzleClassRatePlanRepository implements ClassRatePlanRepository {
  constructor(private readonly db: Db) {}

  async findActiveRate(
    operatorId: string,
    classId: string,
    pickupLocationId: string,
  ): Promise<ClassRatePlan | undefined> {
    const [row] = await this.db
      .select(classRatePlanColumns)
      .from(classRatePlans)
      .where(
        and(
          eq(classRatePlans.operatorId, operatorId),
          eq(classRatePlans.classId, classId),
          eq(classRatePlans.pickupLocationId, pickupLocationId),
          eq(classRatePlans.isActive, true),
        ),
      )
    return row ? toClassRatePlan(row) : undefined
  }

  async findActiveRatePlans(filters?: ClassRatePlanFilters): Promise<ClassRatePlan[]> {
    // An empty location set means the region resolved to no storefronts — no
    // combos to surface. Short-circuit so we don't emit an `IN ()` SQL error.
    if (filters?.locationIds && filters.locationIds.length === 0) return []

    const conditions = [eq(classRatePlans.isActive, true)]
    if (filters?.operatorId) conditions.push(eq(classRatePlans.operatorId, filters.operatorId))
    if (filters?.locationIds)
      conditions.push(inArray(classRatePlans.pickupLocationId, filters.locationIds))

    const rows = await this.db
      .select(classRatePlanColumns)
      .from(classRatePlans)
      .where(and(...conditions))
    return rows.map(toClassRatePlan)
  }

  async create(data: Omit<ClassRatePlan, 'id' | 'createdAt' | 'updatedAt'>): Promise<ClassRatePlan> {
    const [inserted] = await this.db
      .insert(classRatePlans)
      .values({
        operatorId: data.operatorId,
        classId: data.classId,
        pickupLocationId: data.pickupLocationId,
        dayRateJpy: data.dayRateJpy,
        isActive: data.isActive,
        label: data.label,
      })
      .returning()

    if (!inserted) throw new Error('Failed to insert class rate plan')
    return toClassRatePlan(inserted)
  }

  async findAll(ctx: CallerContext, filters: ClassRatePlanFilters): Promise<ClassRatePlan[]> {
    requireManagementRead(ctx)
    const scope = operatorReadScope(ctx)
    if (scope.kind === 'none') return []
    const conditions: SQL[] = []
    if (scope.kind === 'operator') conditions.push(eq(classRatePlans.operatorId, scope.operatorId))
    if (filters.operatorId) conditions.push(eq(classRatePlans.operatorId, filters.operatorId))
    if (filters.classId) conditions.push(eq(classRatePlans.classId, filters.classId))
    if (filters.pickupLocationId)
      conditions.push(eq(classRatePlans.pickupLocationId, filters.pickupLocationId))
    if (filters.isActive !== undefined) conditions.push(eq(classRatePlans.isActive, filters.isActive))
    const rows = await this.db
      .select(classRatePlanColumns)
      .from(classRatePlans)
      .where(conditions.length ? and(...conditions) : undefined)
    return rows.map(toClassRatePlan)
  }

  async findById(ctx: CallerContext, id: string): Promise<ClassRatePlan | undefined> {
    requireManagementRead(ctx)
    const scope = operatorReadScope(ctx)
    if (scope.kind === 'none') return undefined
    const conditions: SQL[] = [eq(classRatePlans.id, id)]
    if (scope.kind === 'operator') conditions.push(eq(classRatePlans.operatorId, scope.operatorId))
    const [row] = await this.db
      .select(classRatePlanColumns)
      .from(classRatePlans)
      .where(and(...conditions))
    return row ? toClassRatePlan(row) : undefined
  }

  // NOT ctx-scoped: service passes an already-resolved operatorId; DB UNIQUE is the seal.
  // Never wire to a route directly.
  async findByScope(
    operatorId: string,
    classId: string,
    pickupLocationId: string,
  ): Promise<ClassRatePlan | undefined> {
    const [row] = await this.db
      .select(classRatePlanColumns)
      .from(classRatePlans)
      .where(
        and(
          eq(classRatePlans.operatorId, operatorId),
          eq(classRatePlans.classId, classId),
          eq(classRatePlans.pickupLocationId, pickupLocationId),
        ),
      )
    return row ? toClassRatePlan(row) : undefined
  }

  async update(
    ctx: CallerContext,
    id: string,
    patch: Partial<
      Pick<ClassRatePlan, 'classId' | 'pickupLocationId' | 'dayRateJpy' | 'isActive' | 'label'>
    >,
  ): Promise<ClassRatePlan | undefined> {
    requireManagementRead(ctx)
    const scope = operatorReadScope(ctx)
    if (scope.kind === 'none') return undefined
    const conditions: SQL[] = [eq(classRatePlans.id, id)]
    if (scope.kind === 'operator') conditions.push(eq(classRatePlans.operatorId, scope.operatorId))
    const [row] = await this.db
      .update(classRatePlans)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(...conditions))
      .returning()
    return row ? toClassRatePlan(row) : undefined
  }

  async remove(ctx: CallerContext, id: string): Promise<ClassRatePlan | undefined> {
    requireManagementRead(ctx)
    const scope = operatorReadScope(ctx)
    if (scope.kind === 'none') return undefined
    const conditions: SQL[] = [eq(classRatePlans.id, id)]
    if (scope.kind === 'operator') conditions.push(eq(classRatePlans.operatorId, scope.operatorId))
    const [row] = await this.db
      .delete(classRatePlans)
      .where(and(...conditions))
      .returning()
    return row ? toClassRatePlan(row) : undefined
  }
}
