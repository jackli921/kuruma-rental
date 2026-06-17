import type { OperatorInviteData, OperatorMemberData } from '@kuruma/shared/types/operator-team'
import type { CallerContext } from '../auth/context'
import { ForbiddenError, requireOperatorOwnerWrite, requireOperatorScope } from '../auth/guards'
import type {
  OperatorMembershipRepository,
  ProviderInviteRepository,
  UserRepository,
} from '../repositories/types'
import type { OperatorMembership, ProviderInvite, User } from '../stores'
import type { CreatedInvite, ProviderInviteService } from './provider-invite'

/**
 * #904: operator self-service staff management. Every method derives the tenant
 * from the caller's session (`ctx.operatorId`) — there is no foreign-id surface,
 * so a tenant can only ever see or mutate its own team. Writes are owner-only;
 * reads admit any operator member. The minted role is hard-coded OPERATOR_STAFF:
 * an owner can never escalate an invitee to OPERATOR_OWNER through this path.
 */
export class OperatorTeamService {
  constructor(
    private readonly invites: ProviderInviteRepository,
    private readonly memberships: OperatorMembershipRepository,
    private readonly users: UserRepository,
    private readonly inviteService: ProviderInviteService,
  ) {}

  async inviteStaff(ctx: CallerContext, input: { email: string }): Promise<CreatedInvite> {
    requireOperatorOwnerWrite(ctx)
    const operatorId = this.requireOwnOperator(ctx)
    return this.inviteService.createInvite(
      { email: input.email, operatorId, role: 'OPERATOR_STAFF' },
      ctx.userId,
    )
  }

  async listInvites(ctx: CallerContext): Promise<OperatorInviteData[]> {
    requireOperatorScope(ctx)
    const operatorId = this.requireOwnOperator(ctx)
    const rows = await this.invites.listByOperator(operatorId)
    return rows.map(toOperatorInviteData)
  }

  async listMembers(ctx: CallerContext): Promise<OperatorMemberData[]> {
    requireOperatorScope(ctx)
    const operatorId = this.requireOwnOperator(ctx)
    const memberships = await this.memberships.findActiveByOperator(operatorId)
    // One batched read, not a per-member query — the team is small but an N+1
    // loop is still the wrong shape. `findActiveByOperator` already orders the rows.
    const usersById = new Map(
      (await this.users.findByIds(memberships.map((m) => m.userId))).map((u) => [u.id, u]),
    )
    return memberships.map((m) => toOperatorMemberData(m, usersById.get(m.userId)))
  }

  /**
   * `requireOperatorScope` only fails OPERATOR_* roles missing an operatorId; a
   * PLATFORM_ADMIN (not an OPERATOR_* role) slips through with no tenant. The
   * `/me` surface is operator-only, so seal the absent tenant here rather than
   * letting it reach the repo as `listByOperator(undefined)`.
   */
  private requireOwnOperator(ctx: CallerContext): string {
    if (!ctx.operatorId) throw new ForbiddenError('operator scope required')
    return ctx.operatorId
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
