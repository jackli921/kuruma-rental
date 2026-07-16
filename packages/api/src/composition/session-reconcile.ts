import type { CurrentIdentityResolver } from '../middleware/auth'
import type { UserRepository } from '../repositories/types'

/**
 * DB-authoritative identity resolver for the GET /auth/session reconcile (§5.1,
 * sign-in-first onboarding). Reuses the users projection (`findByIds` selects
 * `operatorId`, drizzle/user.ts) — one indexed read — so a promoted RENTER->OWNER
 * token re-mints without re-login. Only non-operator tokens reach it (the handler
 * gates on `!isOperatorRole`), and operators are already covered by the #939
 * revoke check, so operators pay zero extra reads.
 *
 * Extracted from the composition root to keep index.ts under the file-size cap;
 * mirrors resolveEmailSender/resolveGeocoder wiring in composition/services.ts.
 */
export function buildReconcileIdentityResolver(
  userRepo: Pick<UserRepository, 'findByIds'>,
): CurrentIdentityResolver {
  return async (user) => {
    const projection = (await userRepo.findByIds([user.id]))[0]
    if (!projection) return undefined
    return projection.operatorId != null
      ? { role: projection.role, operatorId: projection.operatorId }
      : { role: projection.role }
  }
}
