import { operatorApplications } from '@kuruma/shared/db/schema'
import { and, asc, desc, eq, gt, lt, or } from 'drizzle-orm'
import type { OperatorApplication } from '../../stores'
import type { OperatorApplicationListFilters, OperatorApplicationRepository } from '../types'
import type { Db } from './shared'

type Row = typeof operatorApplications.$inferSelect
type CreateData = Parameters<OperatorApplicationRepository['create']>[0]

function toOperatorApplication(r: Row): OperatorApplication {
  return { ...r }
}

export class DrizzleOperatorApplicationRepository implements OperatorApplicationRepository {
  constructor(private readonly db: Db) {}

  async create(data: CreateData): Promise<OperatorApplication> {
    const [row] = await this.db.insert(operatorApplications).values(data).returning()
    if (!row) throw new Error('Failed to insert operator application')
    return toOperatorApplication(row)
  }

  async findById(id: string): Promise<OperatorApplication | undefined> {
    const [row] = await this.db.select().from(operatorApplications).where(eq(operatorApplications.id, id))
    return row ? toOperatorApplication(row) : undefined
  }

  async list(filters?: OperatorApplicationListFilters): Promise<OperatorApplication[]> {
    const conditions = []
    if (filters?.status) conditions.push(eq(operatorApplications.status, filters.status))
    // Keyset seek on the (createdAt DESC, id ASC) order: rows strictly "after" the
    // pivot are those with an older createdAt, or the same createdAt and a larger id.
    if (filters?.after) {
      const { createdAt, id } = filters.after
      conditions.push(
        or(
          lt(operatorApplications.createdAt, createdAt),
          and(eq(operatorApplications.createdAt, createdAt), gt(operatorApplications.id, id)),
        )!,
      )
    }
    let query = this.db
      .select()
      .from(operatorApplications)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(operatorApplications.createdAt), asc(operatorApplications.id))
      .$dynamic()
    if (filters?.limit !== undefined) query = query.limit(filters.limit)
    const rows = await query
    return rows.map(toOperatorApplication)
  }

  async markApprovedIfPending(id: string, operatorId: string, reviewedByUserId: string, reviewedAt: Date) {
    const [row] = await this.db
      .update(operatorApplications)
      .set({ status: 'APPROVED', operatorId, reviewedByUserId, reviewedAt, updatedAt: new Date() })
      .where(and(eq(operatorApplications.id, id), eq(operatorApplications.status, 'PENDING')))
      .returning()
    return row ? toOperatorApplication(row) : undefined
  }

  async markRejectedIfPending(id: string, reviewedByUserId: string, reviewedAt: Date, rejectionReason: string) {
    const [row] = await this.db
      .update(operatorApplications)
      .set({ status: 'REJECTED', reviewedByUserId, reviewedAt, rejectionReason, updatedAt: new Date() })
      .where(and(eq(operatorApplications.id, id), eq(operatorApplications.status, 'PENDING')))
      .returning()
    return row ? toOperatorApplication(row) : undefined
  }
}
