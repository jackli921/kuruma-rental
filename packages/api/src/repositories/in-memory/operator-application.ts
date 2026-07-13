import type { OperatorApplicationStatus } from '@kuruma/shared/enums'
import { OPERATOR_APPLICATION_EMAIL_CONSTRAINT, PG_ERROR } from '../../pg-errors'
import type { OperatorApplication } from '../../stores'
import type { OperatorApplicationListParams, OperatorApplicationRepository } from '../types'

const LIVE = new Set<OperatorApplicationStatus>(['PENDING', 'APPROVED'])
type CreateData = Parameters<OperatorApplicationRepository['create']>[0]

export class InMemoryOperatorApplicationRepository implements OperatorApplicationRepository {
  private readonly store: Map<string, OperatorApplication>
  constructor(store?: Map<string, OperatorApplication>) {
    this.store = store ?? new Map()
  }

  private assertNoLiveDuplicate(email: string): void {
    const target = email.toLowerCase()
    const clash = [...this.store.values()].some(
      (a) => LIVE.has(a.status) && a.contactEmail.toLowerCase() === target,
    )
    if (clash) {
      throw Object.assign(new Error('duplicate key value violates unique constraint'), {
        code: PG_ERROR.UNIQUE_VIOLATION,
        constraint_name: OPERATOR_APPLICATION_EMAIL_CONSTRAINT,
      })
    }
  }

  async create(data: CreateData): Promise<OperatorApplication> {
    this.assertNoLiveDuplicate(data.contactEmail)
    const now = new Date()
    const app: OperatorApplication = {
      ...data,
      id: crypto.randomUUID(),
      status: 'PENDING',
      applicantUserId: data.applicantUserId ?? null,
      operatorId: null,
      reviewedByUserId: null,
      reviewedAt: null,
      reviewerNotes: null,
      rejectionReason: null,
      createdAt: now,
      updatedAt: now,
    }
    this.store.set(app.id, app)
    return app
  }

  async findById(id: string): Promise<OperatorApplication | undefined> {
    return this.store.get(id)
  }

  async list({
    status,
    limit,
    offset,
  }: OperatorApplicationListParams): Promise<OperatorApplication[]> {
    return [...this.store.values()]
      .filter((a) => !status || a.status === status)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || a.id.localeCompare(b.id))
      .slice(offset, offset + limit)
  }

  async markApprovedIfPending(
    id: string,
    operatorId: string,
    reviewedByUserId: string,
    reviewedAt: Date,
  ): Promise<OperatorApplication | undefined> {
    const a = this.store.get(id)
    if (!a || a.status !== 'PENDING') return undefined
    const next: OperatorApplication = {
      ...a,
      status: 'APPROVED',
      operatorId,
      reviewedByUserId,
      reviewedAt,
      updatedAt: new Date(),
    }
    this.store.set(id, next)
    return next
  }

  async markRejectedIfPending(
    id: string,
    reviewedByUserId: string,
    reviewedAt: Date,
    rejectionReason: string,
  ): Promise<OperatorApplication | undefined> {
    const a = this.store.get(id)
    if (!a || a.status !== 'PENDING') return undefined
    const next: OperatorApplication = {
      ...a,
      status: 'REJECTED',
      reviewedByUserId,
      reviewedAt,
      rejectionReason,
      updatedAt: new Date(),
    }
    this.store.set(id, next)
    return next
  }

  async findByApplicantUserId(userId: string): Promise<OperatorApplication | undefined> {
    return [...this.store.values()]
      .filter((a) => a.applicantUserId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .at(0)
  }
}
