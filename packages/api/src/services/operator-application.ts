import type { OperatorApplicationInput } from '@kuruma/shared/validators/operator-application'
import { ConflictError, NotFoundError } from '../auth/guards'
import {
  OPERATOR_APPLICATION_EMAIL_CONSTRAINT,
  OPERATORS_SLUG_CONSTRAINT,
  PG_ERROR,
  PROVIDER_INVITE_PENDING_EMAIL_CONSTRAINT,
  pgConstraintName,
  pgErrorCode,
} from '../pg-errors'
import type {
  OperatorApplicationListParams,
  OperatorApplicationRepository,
  OperatorApprovalRepos,
  RunOperatorApproval,
} from '../repositories/types'
import type { OperatorApplication } from '../stores'
import { type MintedInvite, mintInvite } from './invite-mint'
import type { ProviderInviteAuditEvent } from './provider-invite'
import { buildProviderInviteRecord } from './provider-invite-record'
import { resolveUniqueSlug, slugify } from './slug'

// A concurrent slug race (two similarly-named businesses approved at once) is
// transparently retried once: the retry re-reads existsBySlug — now seeing the
// committed operator — and resolves a fresh suffix. Two attempts is plenty; a
// third collision is vanishingly unlikely and surfaces as a retryable 409.
const SLUG_ATTEMPTS = 2

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

export interface OperatorApplicationServiceConfig {
  /** Public web origin; the minted OWNER invite link is `${webBaseUrl}/provider/invite/<token>`. */
  readonly webBaseUrl: string
}

// The honeypot/consent fields are validated + stripped at the route boundary; the
// service persists only the domain fields (contactEmail already lowercased by zod).
type SubmitInput = Omit<OperatorApplicationInput, 'honeypot' | 'consent'>

// Collected inside the approval tx, emitted only after commit (fire-and-forget).
interface ApprovalOutcome {
  readonly operatorId: string
  readonly operatorSlug: string
  readonly events: readonly OperatorApplicationAuditEvent[]
}

/** C1 cross-aggregate guard: the operator_applications unique-email index can't see
 *  an existing membership or a live invite for this email under another operator.
 *  Runs inside the tx against the tx-bound repos. */
async function assertEmailUnclaimed(repos: OperatorApprovalRepos, email: string): Promise<void> {
  const existingUser = await repos.users.findByEmail(email)
  if (existingUser && (await repos.memberships.findActiveByUserId(existingUser.id))) {
    throw new ConflictError('this email already has an operator')
  }
  if (await repos.invites.findPendingByEmail(email)) {
    throw new ConflictError('this email is already invited to an operator')
  }
}

export class OperatorApplicationService {
  constructor(
    private readonly repo: OperatorApplicationRepository,
    private readonly recordAudit: RecordOperatorApplicationAudit,
    private readonly runApproval: RunOperatorApproval,
    private readonly config: OperatorApplicationServiceConfig,
  ) {}

  async list(params: OperatorApplicationListParams): Promise<OperatorApplication[]> {
    return this.repo.list(params)
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
    if (!application) throw new NotFoundError('no application with that id')
    if (application.status !== 'PENDING') {
      throw new ConflictError('application already reviewed')
    }
    const minted = mintInvite({ webBaseUrl: this.config.webBaseUrl })
    const outcome = await this.provisionApproval(id, application, minted, reviewerUserId)
    for (const e of outcome.events) this.recordAudit(e)
    return {
      operatorId: outcome.operatorId,
      operatorSlug: outcome.operatorSlug,
      inviteUrl: minted.inviteUrl,
      expiresAt: minted.expiresAt,
    }
  }

  /** Run the approval tx, retrying once on a concurrent slug race. Maps in-tx
   *  unique violations to accurate 409s — critically, a slug race is NOT reported
   *  as "already reviewed" (#1371b); the markApprovedIfPending fence and the C1
   *  guards throw ConflictError directly (not a 23505) and propagate unchanged. */
  private async provisionApproval(
    id: string,
    application: OperatorApplication,
    minted: MintedInvite,
    reviewerUserId: string,
  ): Promise<ApprovalOutcome> {
    for (let attempt = 1; attempt <= SLUG_ATTEMPTS; attempt++) {
      try {
        return await this.runApproval((repos) =>
          this.provision(repos, id, application, minted, reviewerUserId),
        )
      } catch (err) {
        if (pgErrorCode(err) !== PG_ERROR.UNIQUE_VIOLATION) throw err
        const constraint = pgConstraintName(err)
        if (constraint === OPERATORS_SLUG_CONSTRAINT) {
          if (attempt < SLUG_ATTEMPTS) continue
          throw new ConflictError('could not allocate a unique operator slug, please retry')
        }
        if (constraint === PROVIDER_INVITE_PENDING_EMAIL_CONSTRAINT) {
          throw new ConflictError('this email is already invited to an operator')
        }
        throw err
      }
    }
    // Unreachable: the loop returns or throws on every path.
    throw new ConflictError('could not provision operator, please retry')
  }

  private async provision(
    repos: OperatorApprovalRepos,
    id: string,
    application: OperatorApplication,
    minted: MintedInvite,
    reviewerUserId: string,
  ): Promise<ApprovalOutcome> {
    await assertEmailUnclaimed(repos, application.contactEmail)
    const slug = await resolveUniqueSlug(slugify(application.businessName), (s) =>
      repos.operators.existsBySlug(s),
    )
    const operator = await repos.operators.create({
      name: application.businessName,
      slug,
      preAuthHandoffUrl: null,
    })
    const invite = buildProviderInviteRecord(minted, {
      email: application.contactEmail,
      operatorId: operator.id,
      role: 'OPERATOR_OWNER',
      invitedByUserId: reviewerUserId,
    })
    await repos.invites.create(invite.row)
    // Atomic claim+link + race fence: undefined => another approval won; the throw
    // rolls back the operator + invite created above (no orphan).
    const claimed = await repos.applications.markApprovedIfPending(
      id,
      operator.id,
      reviewerUserId,
      new Date(),
    )
    if (!claimed) throw new ConflictError('application already reviewed')
    return {
      operatorId: operator.id,
      operatorSlug: slug,
      events: [
        invite.event,
        {
          type: 'OPERATOR_APPLICATION_APPROVED',
          actorUserId: reviewerUserId,
          operatorId: operator.id,
          applicationId: id,
        },
      ],
    }
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
