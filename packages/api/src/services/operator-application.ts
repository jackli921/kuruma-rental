import type { OperatorApplicationStatus } from '@kuruma/shared/enums'
import type { OperatorApplicationInput } from '@kuruma/shared/validators/operator-application'
import { ConflictError, NotFoundError } from '../auth/guards'
import {
  OPERATOR_APPLICATION_EMAIL_CONSTRAINT,
  PG_ERROR,
  pgConstraintName,
  pgErrorCode,
} from '../pg-errors'
import type { OperatorApplicationRepository, RunOperatorApproval } from '../repositories/types'
import type { OperatorApplication } from '../stores'
import { mintInvite } from './invite-mint'
import type { ProviderInviteAuditEvent } from './provider-invite'
import { resolveUniqueSlug, slugify } from './slug'

// #1277: audit events raised when a platform admin reviews a pending application.
// Mirrors OperatorProfileAuditEvent in operator.ts: defined at the service that
// raises them so the audit sink (audit.ts) imports from the source of truth.
export interface OperatorApplicationApprovedAuditEvent {
  readonly type: 'OPERATOR_APPLICATION_APPROVED'
  readonly actorUserId: string
  readonly operatorId: string
  readonly applicationId: string
}

export interface OperatorApplicationRejectedAuditEvent {
  readonly type: 'OPERATOR_APPLICATION_REJECTED'
  readonly actorUserId: string
  readonly applicationId: string
}

// Widened to include ProviderInviteAuditEvent because approve() also mints the
// OPERATOR_OWNER invite and emits PROVIDER_INVITE_CREATED through the same sink.
export type OperatorApplicationAuditEvent =
  | OperatorApplicationApprovedAuditEvent
  | OperatorApplicationRejectedAuditEvent
  | ProviderInviteAuditEvent

// Narrow per-service audit port (mirrors RecordOperatorProfileAudit in operator.ts):
// the injected sink accepts only THIS service's events, so the compiler rejects an
// accidental emit of a foreign kind. The composition root's wider RecordAuditEvent
// sink stays assignable to it (parameter contravariance). Also accepts
// PROVIDER_INVITE_CREATED because approve() emits it when minting the OWNER invite.
export type RecordOperatorApplicationAudit = (event: OperatorApplicationAuditEvent) => void

// The honeypot/consent fields are validated + stripped at the route boundary; the
// service persists only the domain fields (contactEmail already lowercased by zod).
type SubmitInput = Omit<OperatorApplicationInput, 'honeypot' | 'consent'>

export class OperatorApplicationService {
  constructor(
    private readonly repo: OperatorApplicationRepository,
    private readonly recordAudit: RecordOperatorApplicationAudit,
    private readonly runApproval: RunOperatorApproval,
    private readonly webBaseUrl: string,
  ) {}

  async list(status?: OperatorApplicationStatus): Promise<OperatorApplication[]> {
    return this.repo.list(status)
  }

  async reject(
    id: string,
    reviewerUserId: string,
    rejectionReason: string,
  ): Promise<OperatorApplication> {
    const row = await this.repo.markRejectedIfPending(
      id,
      reviewerUserId,
      new Date(),
      rejectionReason,
    )
    if (!row) throw new NotFoundError('no pending application with that id')
    this.recordAudit({
      type: 'OPERATOR_APPLICATION_REJECTED',
      actorUserId: reviewerUserId,
      applicationId: id,
    })
    return row
  }

  async approve(
    id: string,
    reviewerUserId: string,
  ): Promise<{ operatorId: string; operatorSlug: string; inviteUrl: string; expiresAt: Date }> {
    // Idempotency-first: a re-approve of a non-PENDING row must read as "already
    // reviewed", not trip the C1 guard on the OWNER invite the first approval minted.
    // The atomic markApprovedIfPending below is still the race fence for concurrent
    // approvals that both pass this read. Email/name are immutable once PENDING, so
    // reading here (outside the tx) is safe.
    const application = await this.repo.findById(id)
    if (!application || application.status !== 'PENDING') {
      throw new ConflictError('application already reviewed')
    }
    const email = application.contactEmail
    const minted = mintInvite({ webBaseUrl: this.webBaseUrl })
    // Collected inside the tx, emitted only after commit (fire-and-forget convention).
    const events: OperatorApplicationAuditEvent[] = []
    const result = await this.runApproval(async (repos) => {
      // C1 cross-aggregate guard — the applications' unique-email index cannot see
      // an existing membership or a live invite for this email elsewhere.
      const existingUser = await repos.users.findByEmail(email)
      if (existingUser && (await repos.memberships.findActiveByUserId(existingUser.id))) {
        throw new ConflictError('this email already has an operator')
      }
      if (await repos.invites.findPendingByEmail(email)) {
        throw new ConflictError('this email is already invited to an operator')
      }
      const slug = await resolveUniqueSlug(slugify(application.businessName), (s) =>
        repos.operators.existsBySlug(s),
      )
      const operator = await repos.operators.create({
        name: application.businessName,
        slug,
        preAuthHandoffUrl: null,
      })
      await repos.invites.create({
        email,
        operatorId: operator.id,
        role: 'OPERATOR_OWNER',
        tokenHash: minted.tokenHash,
        status: 'PENDING',
        expiresAt: minted.expiresAt,
        invitedByUserId: reviewerUserId,
        acceptedByUserId: null,
      })
      // Atomic claim+link + race fence: undefined => another approval won; the throw
      // rolls back the operator + invite created above (no orphan).
      const claimed = await repos.applications.markApprovedIfPending(
        id,
        operator.id,
        reviewerUserId,
        new Date(),
      )
      if (!claimed) throw new ConflictError('application already reviewed')
      events.push(
        {
          type: 'PROVIDER_INVITE_CREATED',
          invitedByUserId: reviewerUserId,
          operatorId: operator.id,
          email,
        },
        {
          type: 'OPERATOR_APPLICATION_APPROVED',
          actorUserId: reviewerUserId,
          operatorId: operator.id,
          applicationId: id,
        },
      )
      return { operatorId: operator.id, operatorSlug: slug }
    })
    for (const e of events) this.recordAudit(e)
    return { ...result, inviteUrl: minted.inviteUrl, expiresAt: minted.expiresAt }
  }

  async submit(input: SubmitInput): Promise<Pick<OperatorApplication, 'id' | 'status'>> {
    try {
      const app = await this.repo.create({
        businessName: input.businessName,
        contactName: input.contactName,
        contactEmail: input.contactEmail,
        contactPhone: input.contactPhone,
        serviceArea: input.serviceArea,
        estimatedFleetSize: input.estimatedFleetSize,
        website: input.website ?? null,
        businessLicenseNumber: input.businessLicenseNumber ?? null,
        businessType: input.businessType ?? null,
        message: input.message ?? null,
        submittedLocale: input.submittedLocale,
      })
      return { id: app.id, status: app.status }
    } catch (err) {
      if (
        pgErrorCode(err) === PG_ERROR.UNIQUE_VIOLATION &&
        pgConstraintName(err) === OPERATOR_APPLICATION_EMAIL_CONSTRAINT
      ) {
        throw new ConflictError('an application or account already exists for this email')
      }
      throw err
    }
  }
}
