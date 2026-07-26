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
 * Composition-root wiring inputs for the onboarding service (#877). Distinct from
 * the service's own `OperatorApplicationServiceDeps` (which carries a resolved
 * `config`): this shape takes a flat `webBaseUrl`, and the builder folds in the
 * shared email envelope (from/reply-to) to produce the service `config`.
 */
export interface OperatorApplicationServiceWiring {
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
  wiring: OperatorApplicationServiceWiring,
): OperatorApplicationService {
  const emailConfig = resolveEmailConfig()
  return new OperatorApplicationService({
    repo: wiring.repo,
    recordAudit: wiring.recordAudit,
    runApproval: wiring.runApproval,
    config: {
      webBaseUrl: wiring.webBaseUrl,
      fromAddress: emailConfig.emailFrom,
      ...(emailConfig.emailReplyTo ? { replyTo: emailConfig.emailReplyTo } : {}),
    },
    members: wiring.members,
    users: wiring.users,
    emailSender: wiring.emailSender,
  })
}
