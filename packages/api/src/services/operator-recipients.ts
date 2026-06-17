import type { OperatorMembershipRepository, UserRepository } from '../repositories/types'

/**
 * Resolves the email recipient set for an operator alert (#878): every ACTIVE
 * member of the operator. Injected into the NotificationDispatcher as a single
 * function so the send pipeline never depends on the membership ledger directly
 * (ISP — the dispatcher used the whole membership repo for one query). The
 * concrete wiring lives in the composition root; this seam is testable alone.
 */
export type ResolveOperatorRecipients = (operatorId: string) => Promise<string[]>

/**
 * Builds the recipient resolver from its two data sources. Memberships are the
 * source of truth; users.findByIds resolves the addresses and masks a synthetic
 * placeholder email to null (a seeded placeholder owner is dropped, not emailed).
 * findActiveByOperator returns a deterministic (createdAt, id) order, preserved
 * through the flatMap so the joined audit string is stable across resends.
 *
 * Deps are narrowed with `Pick` to exactly the queries used — neither full repo
 * is pulled in, which is the point of extracting the seam.
 */
export function makeResolveOperatorRecipients(deps: {
  membershipRepo: Pick<OperatorMembershipRepository, 'findActiveByOperator'>
  userRepo: Pick<UserRepository, 'findByIds'>
}): ResolveOperatorRecipients {
  const { membershipRepo, userRepo } = deps
  return async (operatorId) => {
    const members = await membershipRepo.findActiveByOperator(operatorId)
    if (members.length === 0) return []
    const users = await userRepo.findByIds(members.map((m) => m.userId))
    const emailByUserId = new Map(users.map((u) => [u.id, u.email]))
    return members.flatMap((m) => {
      const email = emailByUserId.get(m.userId)
      return email ? [email] : []
    })
  }
}
