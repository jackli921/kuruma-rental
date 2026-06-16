import { PG_ERROR } from '../../pg-errors'
import type { OperatorMembership } from '../../stores'
import type { OperatorMembershipRepository } from '../types'

export class InMemoryOperatorMembershipRepository implements OperatorMembershipRepository {
  private readonly store: Map<string, OperatorMembership>

  constructor(store?: Map<string, OperatorMembership>) {
    this.store = store ?? new Map()
  }

  // Mirror operator_memberships_active_user_unique (PARTIAL on status='ACTIVE'):
  // a second ACTIVE row for one user is the race fence for concurrent invite
  // acceptance. REVOKED rows don't occupy the slot.
  private assertNoActiveMembership(userId: string): void {
    if ([...this.store.values()].some((m) => m.userId === userId && m.status === 'ACTIVE')) {
      throw Object.assign(new Error('duplicate key value violates unique constraint'), {
        code: PG_ERROR.UNIQUE_VIOLATION,
      })
    }
  }

  async findActiveByUserId(userId: string): Promise<OperatorMembership | undefined> {
    return [...this.store.values()].find((m) => m.userId === userId && m.status === 'ACTIVE')
  }

  // #878: the operator's ACTIVE members (owner + staff) — the booking-alert
  // recipient set, sourced from the grant ledger (REVOKED rows excluded).
  async findActiveByOperator(operatorId: string): Promise<OperatorMembership[]> {
    return [...this.store.values()].filter(
      (m) => m.operatorId === operatorId && m.status === 'ACTIVE',
    )
  }

  async create(
    data: Omit<OperatorMembership, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<OperatorMembership> {
    if (data.status === 'ACTIVE') this.assertNoActiveMembership(data.userId)
    const now = new Date()
    const membership: OperatorMembership = {
      ...data,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    }
    this.store.set(membership.id, membership)
    return membership
  }
}
