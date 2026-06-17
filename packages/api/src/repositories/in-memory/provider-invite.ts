import { PG_ERROR } from '../../pg-errors'
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

  async create(
    data: Omit<ProviderInvite, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ProviderInvite> {
    this.assertTokenHashFree(data.tokenHash)
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

  async markAccepted(id: string, acceptedByUserId: string): Promise<void> {
    const invite = this.store.get(id)
    if (!invite) return
    this.store.set(id, {
      ...invite,
      status: 'ACCEPTED',
      acceptedByUserId,
      updatedAt: new Date(),
    })
  }
}
