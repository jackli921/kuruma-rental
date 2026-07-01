import type { RunTx } from '@kuruma/shared/db'
import type { RunOperatorApproval } from '../types'
import { DrizzleOperatorRepository } from './operator'
import { DrizzleOperatorApplicationRepository } from './operator-application'
import { DrizzleOperatorMembershipRepository } from './operator-membership'
import { DrizzleProviderInviteRepository } from './provider-invite'
import { asTxDb } from './shared'
import { DrizzleUserRepository } from './user'

// #1277 atomic operator approval: C1 guard reads + operator INSERT + OWNER invite
// INSERT + application claim+link in ONE interactive tx. If the claim finds the row
// already reviewed, the throw rolls back the operator + invite (no orphan). Mirrors
// createDrizzleOperatorGrant but scoped to the approval's tables. Per-call
// neon-serverless interactive tx (#493) — the runner is injected.
export function createDrizzleOperatorApproval(runInteractiveTx: RunTx): RunOperatorApproval {
  return async (fn) =>
    runInteractiveTx(async (tx) => {
      const txDb = asTxDb(tx)
      return fn({
        users: new DrizzleUserRepository(txDb),
        memberships: new DrizzleOperatorMembershipRepository(txDb),
        invites: new DrizzleProviderInviteRepository(txDb),
        operators: new DrizzleOperatorRepository(txDb),
        applications: new DrizzleOperatorApplicationRepository(txDb),
      })
    })
}
