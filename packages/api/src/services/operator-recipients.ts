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

/**
 * Batch shape of the resolver for the compliance digest (#1010). Resolves the
 * recipient set for MANY operators in a CONSTANT number of queries — one
 * `findActiveByOperators` over all ids, then one `findByIds` over the union of
 * member ids — instead of the per-operator N+1 the cron used to fan out. Per
 * operator the order + null-mask are identical to the single resolver. Every
 * requested operator is a key in the returned map (no members → []), so the
 * caller indexes it without a fallback and can never silently skip an operator.
 */
export type ResolveOperatorRecipientsBatch = (
  operatorIds: string[],
) => Promise<Map<string, string[]>>

export function makeResolveOperatorRecipientsBatch(deps: {
  membershipRepo: Pick<OperatorMembershipRepository, 'findActiveByOperators'>
  userRepo: Pick<UserRepository, 'findByIds'>
}): ResolveOperatorRecipientsBatch {
  const { membershipRepo, userRepo } = deps
  return async (operatorIds) => {
    const membersByOperator = await membershipRepo.findActiveByOperators(operatorIds)
    const userIds = [
      ...new Set([...membersByOperator.values()].flatMap((ms) => ms.map((m) => m.userId))),
    ]
    const users = userIds.length > 0 ? await userRepo.findByIds(userIds) : []
    const emailByUserId = new Map(users.map((u) => [u.id, u.email]))
    return new Map(
      operatorIds.map((operatorId) => {
        const members = membersByOperator.get(operatorId) ?? []
        const emails = members.flatMap((m) => {
          const email = emailByUserId.get(m.userId)
          return email ? [email] : []
        })
        return [operatorId, emails]
      }),
    )
  }
}
