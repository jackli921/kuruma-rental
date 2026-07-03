import { operatorApplications } from '@kuruma/shared/db/schema'
import { and, desc, eq } from 'drizzle-orm'
import type { OperatorApplication } from '../../stores'
import type { OperatorApplicationListParams, OperatorApplicationRepository } from '../types'
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

  async list({ status, limit, offset }: OperatorApplicationListParams): Promise<OperatorApplication[]> {
    const rows = await this.db
      .select()
      .from(operatorApplications)
      .where(status ? eq(operatorApplications.status, status) : undefined)
      .orderBy(desc(operatorApplications.createdAt), operatorApplications.id)
      .limit(limit)
      .offset(offset)
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
