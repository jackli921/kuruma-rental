import type { RunTx } from '@kuruma/shared/db'
import type { RunOperatorGrant } from '../types'
import { DrizzleOperatorMembershipRepository } from './operator-membership'
import { DrizzleProviderInviteRepository } from './provider-invite'
import type { Db } from './shared'
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
  // Drizzle's tx exposes the same query-builder API as db; the cast is safe because
  // the repos only use select/insert/update (see createDrizzleTransaction's note).
  return async (fn) =>
    runInteractiveTx(async (tx) => {
      const txDb = tx as unknown as Db
      return fn({
        memberships: new DrizzleOperatorMembershipRepository(txDb),
        users: new DrizzleUserRepository(txDb),
        invites: new DrizzleProviderInviteRepository(txDb),
      })
    })
}
