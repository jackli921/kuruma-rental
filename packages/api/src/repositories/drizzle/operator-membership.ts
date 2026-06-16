import { operatorMemberships } from '@kuruma/shared/db/schema'
import { and, eq } from 'drizzle-orm'
import type { OperatorMembership } from '../../stores'
import type { OperatorMembershipRepository } from '../types'
import type { Db } from './shared'

type Row = typeof operatorMemberships.$inferSelect

function toOperatorMembership(r: Row): OperatorMembership {
  return {
    id: r.id,
    userId: r.userId,
    operatorId: r.operatorId,
    role: r.role,
    status: r.status,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }
}

export class DrizzleOperatorMembershipRepository implements OperatorMembershipRepository {
  constructor(private readonly db: Db) {}

  // Served by the partial-unique-active index (filters status='ACTIVE'). MVP is
  // one active membership per user, so at most one row matches.
  async findActiveByUserId(userId: string): Promise<OperatorMembership | undefined> {
    const [row] = await this.db
      .select()
      .from(operatorMemberships)
      .where(and(eq(operatorMemberships.userId, userId), eq(operatorMemberships.status, 'ACTIVE')))
    return row ? toOperatorMembership(row) : undefined
  }

  // #878: the operator's ACTIVE members (owner + staff), for the booking alert
  // fan-out. Scoped read over (operatorId, status='ACTIVE') — ledger-sourced so a
  // revoked member drops out immediately, unlike the users.role projection.
  async findActiveByOperator(operatorId: string): Promise<OperatorMembership[]> {
    const rows = await this.db
      .select()
      .from(operatorMemberships)
      .where(
        and(
          eq(operatorMemberships.operatorId, operatorId),
          eq(operatorMemberships.status, 'ACTIVE'),
        ),
      )
    return rows.map(toOperatorMembership)
  }

  // A concurrent double-accept that inserts a second ACTIVE row for one user
  // hits operator_memberships_active_user_unique (23505) — the race fence. The
  // caller (OperatorGrantService, Slice B) re-reads the winner on conflict.
  async create(
    data: Omit<OperatorMembership, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<OperatorMembership> {
    const [inserted] = await this.db.insert(operatorMemberships).values(data).returning()
    if (!inserted) throw new Error('Failed to insert operator membership')
    return toOperatorMembership(inserted)
  }
}
