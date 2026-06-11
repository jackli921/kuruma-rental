import { providerInvites } from '@kuruma/shared/db/schema'
import { eq } from 'drizzle-orm'
import type { ProviderInvite } from '../../stores'
import type { ProviderInviteRepository } from '../types'
import type { Db } from './shared'

type Row = typeof providerInvites.$inferSelect

function toProviderInvite(r: Row): ProviderInvite {
  return {
    id: r.id,
    email: r.email,
    operatorId: r.operatorId,
    role: r.role,
    tokenHash: r.tokenHash,
    status: r.status,
    expiresAt: r.expiresAt,
    invitedByUserId: r.invitedByUserId,
    acceptedByUserId: r.acceptedByUserId,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }
}

export class DrizzleProviderInviteRepository implements ProviderInviteRepository {
  constructor(private readonly db: Db) {}

  async create(data: Omit<ProviderInvite, 'id' | 'createdAt' | 'updatedAt'>): Promise<ProviderInvite> {
    const [inserted] = await this.db.insert(providerInvites).values(data).returning()
    if (!inserted) throw new Error('Failed to insert provider invite')
    return toProviderInvite(inserted)
  }

  // Single-row lookup by sha256(token) — the unique tokenHash index. The token
  // is never stored; only its hash, so a leaked DB never yields a usable token.
  async findByTokenHash(tokenHash: string): Promise<ProviderInvite | undefined> {
    const [row] = await this.db
      .select()
      .from(providerInvites)
      .where(eq(providerInvites.tokenHash, tokenHash))
    return row ? toProviderInvite(row) : undefined
  }
}
