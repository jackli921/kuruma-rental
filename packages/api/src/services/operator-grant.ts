import type { OperatorRole } from '@kuruma/shared/validators/provider-invite'
import { sha256Hex } from '../auth/token-hash'
import { PG_ERROR, pgErrorCode } from '../pg-errors'
import type {
  OperatorMembershipRepository,
  ProviderInviteRepository,
  RunOperatorGrant,
} from '../repositories/types'

/**
 * Operator-access authorization (#521 §6). Identity is already resolved (Google
 * account -> a users row, default RENTER). This service decides whether that user
 * may enter the operator portal: an existing membership or a redeemable, email-
 * matched invite grants access; UI intent alone never does. On grant it runs the
 * three writes (membership ledger row, users projection, invite consumption) in
 * ONE transaction, membership-INSERT-first so the partial-unique-active index
 * aborts the whole tx on a concurrent double-accept.
 */
export type OperatorGrantResult =
  | { type: 'granted'; operatorId: string; role: OperatorRole }
  // No membership and no usable invite (uninvited, or email absent/unverified). The
  // provider door alone never grants — the UI maps this to "access not found".
  | { type: 'access_not_found' }
  // A token was presented with a verified email, but the invite is expired/used/
  // unknown or addressed to a different email. The UI maps this to "invite invalid".
  | { type: 'invite_invalid' }

export interface OperatorGrantInput {
  userId: string
  /** The Google profile email, if present. Compared case-insensitively to the invite. */
  email?: string
  /** Google's `email_verified`. An invite is only honoured for a verified email. */
  emailVerified?: boolean
  /** Present when the user arrived via a /provider/invite/:token link. */
  inviteToken?: string
}

export interface OperatorGrantService {
  resolve(input: OperatorGrantInput): Promise<OperatorGrantResult>
}

export interface OperatorGrantDeps {
  memberships: Pick<OperatorMembershipRepository, 'findActiveByUserId'>
  invites: Pick<ProviderInviteRepository, 'findByTokenHash'>
  /** Runs the three grant writes in one transaction (membership-first). The user
   *  projection + invite consumption live inside the tx — see RunOperatorGrant. */
  runGrant: RunOperatorGrant
}

export function createOperatorGrantService(deps: OperatorGrantDeps): OperatorGrantService {
  return {
    async resolve(input: OperatorGrantInput): Promise<OperatorGrantResult> {
      // 1) An existing active membership is the authoritative grant — short-circuit
      //    before touching invites, so a member who opens a different operator's
      //    invite link still lands on their own operator (single-membership MVP).
      const existing = await deps.memberships.findActiveByUserId(input.userId)
      if (existing) {
        return { type: 'granted', operatorId: existing.operatorId, role: existing.role }
      }

      // 2) Provider intent alone never grants: with no token there is nothing to
      //    redeem, so an uninvited account is simply "access not found".
      if (!input.inviteToken) return { type: 'access_not_found' }

      // 3) A token can only be honoured against a present, Google-verified email —
      //    an invite is pre-approval for a specific address, not for any bearer.
      const email = input.email?.toLowerCase()
      if (!email || input.emailVerified !== true) return { type: 'access_not_found' }

      // 4) The invite must exist, still be PENDING + unexpired (expiry is computed
      //    from expiresAt, not a stored state), and be addressed to this exact
      //    verified email. Anything else is an invalid invite, kept distinct from
      //    "no invite at all" for clearer UX.
      const invite = await deps.invites.findByTokenHash(sha256Hex(input.inviteToken))
      if (
        !invite ||
        invite.status !== 'PENDING' ||
        invite.expiresAt.getTime() <= Date.now() ||
        invite.email.toLowerCase() !== email
      ) {
        return { type: 'invite_invalid' }
      }

      // 5) Redeem atomically: the membership ledger row, the denormalised users
      //    projection, and the invite consumption run in ONE tx, membership-INSERT-
      //    first so the partial-unique-active index aborts the WHOLE tx (no partial
      //    grant) on a concurrent double-accept.
      try {
        await deps.runGrant(async (repos) => {
          await repos.memberships.create({
            userId: input.userId,
            operatorId: invite.operatorId,
            role: invite.role,
            status: 'ACTIVE',
          })
          await repos.users.setOperatorAccess(input.userId, {
            role: invite.role,
            operatorId: invite.operatorId,
          })
          await repos.invites.markAccepted(invite.id, input.userId)
        })
        return { type: 'granted', operatorId: invite.operatorId, role: invite.role }
      } catch (err) {
        // Concurrent double-accept: our tx aborted on the unique-active index. The
        // winner's membership is already committed — grant from THAT, never from our
        // rolled-back snapshot (which would mint a stale RENTER). Mirrors the
        // resolveUser race fix (#497). Any other error — or a 23505 with no winner —
        // is a genuine failure, so re-throw.
        if (pgErrorCode(err) === PG_ERROR.UNIQUE_VIOLATION) {
          const winner = await deps.memberships.findActiveByUserId(input.userId)
          if (winner) {
            return { type: 'granted', operatorId: winner.operatorId, role: winner.role }
          }
        }
        throw err
      }
    },
  }
}
