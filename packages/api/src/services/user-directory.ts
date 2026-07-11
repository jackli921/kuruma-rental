import type { CallerContext } from '../middleware/auth'
import { PRIVILEGED_ROLES, isOperatorRole } from '../middleware/auth'
import type { ThreadRepository, UserRepository } from '../repositories/types'

/** Public projection of a user surfaced by the directory: id + display name only.
 *  Email, language, and every other column stay server-side. */
export interface UserSummary {
  id: string
  name: string | null
}

/**
 * Resolves a batch of user ids to {id, name} pairs, scoped to who the caller is
 * allowed to see. The scoping is the whole point: without it the /users endpoint
 * is a name-harvest oracle — any authenticated renter could probe arbitrary
 * UUIDs and dump the user table. Hono-free so the policy is unit-testable.
 */
export class UserDirectoryService {
  constructor(
    private readonly userRepo: UserRepository,
    private readonly threadRepo: ThreadRepository,
  ) {}

  async resolveVisibleUsers(ctx: CallerContext, requestedIds: string[]): Promise<UserSummary[]> {
    const allowed = await this.allowedUserIds(ctx)
    const visibleIds =
      allowed === 'all' ? requestedIds : requestedIds.filter((id) => allowed.has(id))
    const users = await this.userRepo.findByIds(visibleIds)
    return users.map((u) => ({ id: u.id, name: u.name }))
  }

  /**
   * The set of user ids the caller may resolve. The privileged platform tier
   * (PLATFORM_ADMIN — PARTNER was dropped in #1168) resolves anyone; renters
   * resolve only users they share a thread with.
   */
  private async allowedUserIds(ctx: CallerContext): Promise<Set<string> | 'all'> {
    if (PRIVILEGED_ROLES.has(ctx.role)) return 'all'
    // #396: OPERATOR_* are self-only here. The thread lookup below uses a
    // synthetic RENTER context to resolve a caller's co-participants for renter
    // messaging. Operator messaging ships now (#1205), but operators read their
    // inbox by tenant scope (threads.operatorId), not by participation — so they
    // must never resolve another tenant's users via a shared thread. The directory
    // stays self-only and fail-closed for them by design.
    if (isOperatorRole(ctx.role)) return new Set<string>([ctx.userId])
    const threads = await this.threadRepo.findAll({ userId: ctx.userId, role: 'RENTER' })
    const allowed = new Set<string>([ctx.userId])
    for (const thread of threads) {
      for (const p of thread.participants) allowed.add(p.userId)
    }
    return allowed
  }
}
