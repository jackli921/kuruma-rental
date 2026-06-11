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
}
