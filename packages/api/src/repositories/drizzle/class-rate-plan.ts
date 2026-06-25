import { classRatePlans } from '@kuruma/shared/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import type { ClassRatePlan } from '../../stores'
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
}
