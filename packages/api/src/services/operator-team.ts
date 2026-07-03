import type { OperatorInviteData, OperatorMemberData } from '@kuruma/shared/types/operator-team'
import type { CallerContext } from '../auth/context'
import { ConflictError, NotFoundError, requireOperatorOwnerWrite } from '../auth/guards'
import type {
  OperatorMembershipRepository,
  ProviderInviteRepository,
  UserRepository,
} from '../repositories/types'
import type { OperatorMembership, ProviderInvite, User } from '../stores'
import { resolveTeamOperatorId } from '../tenancy'
import type { CreatedInvite, ProviderInviteService } from './provider-invite'

/**
 * #930: structured audit of an owner deactivating a staff member — the third
 * privilege-changing event behind the durable ledger (Rule of Three with
 * {@link ProviderInviteAuditEvent} / {@link OperatorProfileAuditEvent}). Records
 * who revoked whom, within which tenant. An injected sink (never hardcoded) keeps
 * the trail assertable in tests and swappable for the durable store at the root.
 */
export interface OperatorMemberDeactivatedAuditEvent {
  readonly type: 'OPERATOR_MEMBER_DEACTIVATED'
  readonly operatorId: string
  readonly actorUserId: string
  readonly targetUserId: string
}

// index.ts wires the shared durable sink.
export type RecordOperatorMemberDeactivatedAudit = (
  event: OperatorMemberDeactivatedAuditEvent,
) => void

/**
 * #904 + #1230 slice 6: operator self-service staff management, plus a
 * platform-admin picker surface. Every method derives the tenant through
 * {@link resolveTeamOperatorId}: an operator role is pinned to its own
 * `ctx.operatorId` (a foreign input is IGNORED — no cross-tenant), while a
 * PLATFORM_ADMIN supplies the target via `inputOperatorId` and a no-pick admin
 * is refused (422). Writes are owner-tier (`requireOperatorOwnerWrite`); reads
 * admit any operator member. The minted role is hard-coded OPERATOR_STAFF: an
 * owner can never escalate an invitee to OPERATOR_OWNER through this path.
 */
export class OperatorTeamService {
  constructor(
    private readonly invites: ProviderInviteRepository,
    private readonly memberships: OperatorMembershipRepository,
    private readonly users: UserRepository,
    private readonly inviteService: ProviderInviteService,
    private readonly recordAudit: RecordOperatorMemberDeactivatedAudit,
  ) {}

  async inviteStaff(
    ctx: CallerContext,
    input: { email: string },
    inputOperatorId?: string,
  ): Promise<CreatedInvite> {
    requireOperatorOwnerWrite(ctx)
    const operatorId = resolveTeamOperatorId(ctx, inputOperatorId)
    return this.inviteService.createInvite(
      { email: input.email, operatorId, role: 'OPERATOR_STAFF' },
      ctx.userId,
    )
  }

  async listInvites(ctx: CallerContext, inputOperatorId?: string): Promise<OperatorInviteData[]> {
    const operatorId = resolveTeamOperatorId(ctx, inputOperatorId)
    const rows = await this.invites.listByOperator(operatorId)
    return rows.map(toOperatorInviteData)
  }

  async listMembers(ctx: CallerContext, inputOperatorId?: string): Promise<OperatorMemberData[]> {
    const operatorId = resolveTeamOperatorId(ctx, inputOperatorId)
    const memberships = await this.memberships.findActiveByOperator(operatorId)
    // One batched read, not a per-member query — the team is small but an N+1
    // loop is still the wrong shape. `findActiveByOperator` already orders the rows.
    const usersById = new Map(
      (await this.users.findByIds(memberships.map((m) => m.userId))).map((u) => [u.id, u]),
    )
    return memberships.map((m) => toOperatorMemberData(m, usersById.get(m.userId)))
  }

  /**
   * #904 slice 2: the owner revokes a pending invite. Owner-only write; the
   * invite is resolved within the caller's own tenant, so a foreign-tenant or
   * unknown id reads as `undefined` from the scoped repo and surfaces as a 404 —
   * never a 403 that would confirm the invite exists elsewhere.
   */
  async revokeInvite(ctx: CallerContext, id: string, inputOperatorId?: string): Promise<void> {
    requireOperatorOwnerWrite(ctx)
    const operatorId = resolveTeamOperatorId(ctx, inputOperatorId)
    const revoked = await this.invites.revoke(id, operatorId)
    if (!revoked) throw new NotFoundError('invite not found')
  }

  /**
   * #904 slice 2: the owner deactivates a member. One scoped read of the active
   * roster resolves the target, the cross-tenant 404, AND the last-owner lockout
   * (a tenant must always keep one owner who can administer it). On success the two
   * writes run projection-FIRST: clearing `users.role`/`operatorId` before revoking
   * the ledger row makes every partial failure fail-safe — if the ledger write then
   * fails the member simply stays active (re-granted on their next provider login),
   * never silently re-granted via the stale renter-door projection (the JWT mints
   * role straight from that projection on non-provider intent). A real tx is
   * unnecessary: there is no unique-index race here (unlike the grant), and this
   * ordering removes the only dangerous half-state. The small-N owner-count
   * check-then-act race (two owners deactivated at once) is accepted for a tenant of
   * a handful of people. Clearing the live JWT is a separate concern — a deactivated
   * member keeps access until their token expires; see the #904 session-revocation
   * follow-up.
   */
  async deactivateMember(ctx: CallerContext, id: string, inputOperatorId?: string): Promise<void> {
    requireOperatorOwnerWrite(ctx)
    const operatorId = resolveTeamOperatorId(ctx, inputOperatorId)
    const members = await this.memberships.findActiveByOperator(operatorId)
    const target = members.find((m) => m.id === id)
    if (!target) throw new NotFoundError('member not found')
    if (
      target.role === 'OPERATOR_OWNER' &&
      members.filter((m) => m.role === 'OPERATOR_OWNER').length === 1
    ) {
      throw new ConflictError('cannot deactivate the last operator owner')
    }
    await this.users.clearOperatorAccess(target.userId)
    const deactivated = await this.memberships.deactivate(id, operatorId)
    // Audit only a real state change: a no-op deactivate (lost the small-N race)
    // returns undefined and must not record a revocation that didn't happen.
    if (deactivated) {
      this.recordAudit({
        type: 'OPERATOR_MEMBER_DEACTIVATED',
        operatorId,
        actorUserId: ctx.userId,
        targetUserId: target.userId,
      })
    }
  }
}

function toOperatorInviteData(invite: ProviderInvite): OperatorInviteData {
  return {
    id: invite.id,
    email: invite.email,
    role: invite.role,
    status: invite.status,
    expiresAt: invite.expiresAt.toISOString(),
    createdAt: invite.createdAt.toISOString(),
  }
}

function toOperatorMemberData(
  membership: OperatorMembership,
  user: User | undefined,
): OperatorMemberData {
  return {
    id: membership.id,
    userId: membership.userId,
    name: user?.name ?? null,
    email: user?.email ?? null,
    role: membership.role,
    status: membership.status,
    joinedAt: membership.createdAt.toISOString(),
  }
}
