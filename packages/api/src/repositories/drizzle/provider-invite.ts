import { providerInvites } from '@kuruma/shared/db/schema'
import { and, eq } from 'drizzle-orm'
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

  // #904: the operator's PENDING invites for the self-service team page. Scoped
  // (operatorId, status='PENDING'); ordered (createdAt, id) for a stable list.
  async listByOperator(operatorId: string): Promise<ProviderInvite[]> {
    const rows = await this.db
      .select()
      .from(providerInvites)
      .where(and(eq(providerInvites.operatorId, operatorId), eq(providerInvites.status, 'PENDING')))
      .orderBy(providerInvites.createdAt, providerInvites.id)
    return rows.map(toProviderInvite)
  }

  // #904 slice 2: owner revokes a pending invite. The WHERE pins all three of
  // id + operatorId + status='PENDING' so a tenant can only revoke its own
  // actionable invites; a cross-tenant id or an already-consumed invite matches
  // zero rows and returns undefined (the route maps that to 404).
  async revoke(id: string, operatorId: string): Promise<ProviderInvite | undefined> {
    const [row] = await this.db
      .update(providerInvites)
      .set({ status: 'REVOKED', updatedAt: new Date() })
      .where(
        and(
          eq(providerInvites.id, id),
          eq(providerInvites.operatorId, operatorId),
          eq(providerInvites.status, 'PENDING'),
        ),
      )
      .returning()
    return row ? toProviderInvite(row) : undefined
  }

  // Consume the invite at acceptance (#521 §6). Runs tx-bound inside the grant
  // transaction; the membership INSERT (first in that tx) is the primary race
  // fence. The WHERE status='PENDING' is the second fence (#904 slice 2): a
  // self-service revoke (PENDING -> REVOKED) that commits first makes this match
  // zero rows, so a racing accept can never resurrect a revoked invite.
  async markAccepted(id: string, acceptedByUserId: string): Promise<void> {
    await this.db
      .update(providerInvites)
      .set({ status: 'ACCEPTED', acceptedByUserId, updatedAt: new Date() })
      .where(and(eq(providerInvites.id, id), eq(providerInvites.status, 'PENDING')))
  }
}
