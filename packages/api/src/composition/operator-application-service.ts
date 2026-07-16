import type {
  OperatorApplicationRepository,
  OperatorMembershipRepository,
  RunOperatorApproval,
  UserRepository,
} from '../repositories/types'
import type { EmailSender } from '../services/email/email-sender'
import {
  OperatorApplicationService,
  type RecordOperatorApplicationAudit,
} from '../services/operator-application'
import { resolveEmailConfig } from './services'

/**
 * Collaborators for the sign-in-first onboarding service (#877). A deps object
 * rather than positional args — the constructor takes seven collaborators and a
 * positional call at the composition root is easy to mis-order.
 */
export interface OperatorApplicationServiceDeps {
  repo: OperatorApplicationRepository
  recordAudit: RecordOperatorApplicationAudit
  runApproval: RunOperatorApproval
  webBaseUrl: string
  members: Pick<OperatorMembershipRepository, 'findActiveByUserId'>
  users: Pick<UserRepository, 'findById'>
  emailSender: EmailSender
}

/**
 * Build the OperatorApplicationService, resolving the shared email envelope
 * (from/reply-to) internally so the composition root stays under the file-size
 * cap. Mirrors buildReconcileIdentityResolver (composition/session-reconcile.ts).
 */
export function buildOperatorApplicationService(
  deps: OperatorApplicationServiceDeps,
): OperatorApplicationService {
  const emailConfig = resolveEmailConfig()
  return new OperatorApplicationService(
    deps.repo,
    deps.recordAudit,
    deps.runApproval,
    {
      webBaseUrl: deps.webBaseUrl,
      fromAddress: emailConfig.emailFrom,
      ...(emailConfig.emailReplyTo ? { replyTo: emailConfig.emailReplyTo } : {}),
    },
    deps.members,
    deps.users,
    deps.emailSender,
  )
}
