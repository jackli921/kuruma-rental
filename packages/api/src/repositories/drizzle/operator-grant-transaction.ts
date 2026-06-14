import type { RunTx } from '@kuruma/shared/db'
import type { RunOperatorGrant } from '../types'
import { DrizzleOperatorMembershipRepository } from './operator-membership'
import { DrizzleProviderInviteRepository } from './provider-invite'
import { asTxDb } from './shared'
import { DrizzleUserRepository } from './user'

/**
 * Atomic operator-grant transaction (#521 §6). Runs the three grant writes —
 * membership ledger row, denormalised `users` projection, invite consumption —
 * in ONE interactive tx, with the membership INSERT first so the partial-unique-
 * active index aborts the WHOLE tx on a concurrent double-accept. The service then
 * catches that abort and re-reads the winner's membership (never minting from its
 * rolled-back snapshot). Mirrors `createDrizzleTransaction` (the booking bundle)
 * but scoped to the grant's three tables.
 *
 * Per-call neon-serverless interactive tx (#493): the neon-http driver `getDb()`
 * uses can't run interactive transactions on CF Workers, so the runner is injected.
 */
export function createDrizzleOperatorGrant(runInteractiveTx: RunTx): RunOperatorGrant {
  // Tx-bound repos via the single asTxDb cast seam (#733).
  return async (fn) =>
    runInteractiveTx(async (tx) => {
      const txDb = asTxDb(tx)
      return fn({
        memberships: new DrizzleOperatorMembershipRepository(txDb),
        users: new DrizzleUserRepository(txDb),
        invites: new DrizzleProviderInviteRepository(txDb),
      })
    })
}
