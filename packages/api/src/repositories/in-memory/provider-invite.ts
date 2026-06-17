import { PG_ERROR, PROVIDER_INVITE_PENDING_EMAIL_CONSTRAINT } from '../../pg-errors'
import type { ProviderInvite } from '../../stores'
import type { ProviderInviteRepository } from '../types'

export class InMemoryProviderInviteRepository implements ProviderInviteRepository {
  private readonly store: Map<string, ProviderInvite>

  constructor(store?: Map<string, ProviderInvite>) {
    this.store = store ?? new Map()
  }

  // Mirror provider_invites_tokenHash_unique: a sha256(token) collision raises
  // the same UNIQUE_VIOLATION real Postgres would; the service treats it as a
  // (vanishingly unlikely) regenerate-and-retry signal.
  private assertTokenHashFree(tokenHash: string): void {
    if ([...this.store.values()].some((i) => i.tokenHash === tokenHash)) {
      throw Object.assign(new Error('duplicate key value violates unique constraint'), {
        code: PG_ERROR.UNIQUE_VIOLATION,
      })
    }
  }

  // Mirror provider_invites_pending_email_unique (PARTIAL on status='PENDING'):
  // at most one live invite per (operatorId, email). REVOKED/ACCEPTED rows don't
  // occupy the slot, so a re-invite after revoke succeeds. Emails are stored
  // lowercased, but compare case-insensitively to be safe.
  private assertNoPendingDuplicate(operatorId: string, email: string): void {
    const target = email.toLowerCase()
    const clash = [...this.store.values()].some(
      (i) =>
        i.status === 'PENDING' && i.operatorId === operatorId && i.email.toLowerCase() === target,
    )
    if (clash) {
      throw Object.assign(new Error('duplicate key value violates unique constraint'), {
        code: PG_ERROR.UNIQUE_VIOLATION,
        constraint_name: PROVIDER_INVITE_PENDING_EMAIL_CONSTRAINT,
      })
    }
  }

  async create(
    data: Omit<ProviderInvite, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ProviderInvite> {
    this.assertTokenHashFree(data.tokenHash)
    if (data.status === 'PENDING') this.assertNoPendingDuplicate(data.operatorId, data.email)
    const now = new Date()
    const invite: ProviderInvite = {
      ...data,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    }
    this.store.set(invite.id, invite)
    return invite
  }

  async findByTokenHash(tokenHash: string): Promise<ProviderInvite | undefined> {
    return [...this.store.values()].find((i) => i.tokenHash === tokenHash)
  }

  // #904: the operator's PENDING invites for the self-service team page.
  // Ordered by (createdAt, id) — mirrors the drizzle ORDER BY so list output is
  // stable, not Map-insertion order.
  async listByOperator(operatorId: string): Promise<ProviderInvite[]> {
    return [...this.store.values()]
      .filter((i) => i.operatorId === operatorId && i.status === 'PENDING')
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
  }

  // #904 slice 2: owner revokes a pending invite. Scoped (operatorId, PENDING) so a
  // tenant can only revoke its own actionable invites; returns the updated row, or
  // undefined when nothing matched (mirrors the drizzle WHERE on id+operatorId+status).
  async revoke(id: string, operatorId: string): Promise<ProviderInvite | undefined> {
    const invite = this.store.get(id)
    if (!invite || invite.operatorId !== operatorId || invite.status !== 'PENDING') return undefined
    const revoked: ProviderInvite = { ...invite, status: 'REVOKED', updatedAt: new Date() }
    this.store.set(id, revoked)
    return revoked
  }

  // #904 slice 2: PENDING-only guard. A revoke that lands first leaves the invite
  // REVOKED; a racing accept then finds no PENDING row and is a no-op, so it can
  // never flip REVOKED -> ACCEPTED (mirrors the drizzle WHERE status='PENDING').
  async markAccepted(id: string, acceptedByUserId: string): Promise<void> {
    const invite = this.store.get(id)
    if (!invite || invite.status !== 'PENDING') return
    this.store.set(id, {
      ...invite,
      status: 'ACCEPTED',
      acceptedByUserId,
      updatedAt: new Date(),
    })
  }
}
