import { classRatePlans } from '@kuruma/shared/db/schema'
import { and, eq } from 'drizzle-orm'
import type { ClassRatePlan } from '../../stores'
import type { ClassRatePlanRepository } from '../types'
import { type Db, classRatePlanColumns, toClassRatePlan } from './shared'

export class DrizzleClassRatePlanRepository implements ClassRatePlanRepository {
  constructor(private readonly db: Db) {}

  async findActiveByClassAndLocation(
    operatorId: string,
    classId: string,
    pickupLocationId: string,
  ): Promise<ClassRatePlan | undefined> {
    // The single active deal rate for the triple. NOT ctx-scoped — the caller
    // passes the booking's already-resolved operatorId; the DB UNIQUE on
    // (operatorId, classId, pickupLocationId) guarantees at most one row.
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
