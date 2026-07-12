import type { OperatorApplicationInput } from '@kuruma/shared/validators/operator-application'
import { ConflictError, NotFoundError } from '../auth/guards'
import {
  OPERATORS_SLUG_CONSTRAINT,
  OPERATOR_APPLICATION_EMAIL_CONSTRAINT,
  PG_ERROR,
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

// Sign-in-first (§6.2): approval promotes the applicant account directly and emits
// no invite event, so the union carries only this service's two review events.
export type OperatorApplicationAuditEvent =
  | OperatorApplicationApprovedAuditEvent
  | OperatorApplicationRejectedAuditEvent

// Narrow per-service audit port (mirrors RecordOperatorProfileAudit in operator.ts):
// the injected sink accepts only THIS service's events, so the compiler rejects an
// accidental emit of a foreign kind. The composition root's wider RecordAuditEvent
// sink stays assignable to it (parameter contravariance).
export type RecordOperatorApplicationAudit = (event: OperatorApplicationAuditEvent) => void

export interface OperatorApplicationServiceConfig {
  /** Public web origin; used to build the applicant-facing welcome/status URL in the
   *  approved/rejected emails (Task 12). Kept even while momentarily unreferenced. */
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
  ): Promise<{ operatorId: string; operatorSlug: string }> {
    // Idempotency-first: a re-approve of a non-PENDING row must read as "already
    // reviewed", not trip the C1 guard on the operator the first approval created.
    // The atomic markApprovedIfPending below is still the race fence for concurrent
    // approvals that both pass this read. Email/name are immutable once PENDING, so
    // reading here (outside the tx) is safe.
    const application = await this.repo.findById(id)
    if (!application) throw new NotFoundError('no application with that id')
    if (application.status !== 'PENDING') {
      throw new ConflictError('application already reviewed')
    }
    if (!application.applicantUserId) {
      // Sign-in-first invariant (§8): a PENDING row always carries its applicant.
      // A legacy anonymous row is handled via the admin escape hatch, not this path.
      throw new ConflictError('application is not linked to an account; use the manual invite')
    }
    const outcome = await this.provisionApproval(id, application, reviewerUserId)
    for (const e of outcome.events) this.recordAudit(e)
    return { operatorId: outcome.operatorId, operatorSlug: outcome.operatorSlug }
  }

  /** Run the approval tx, retrying once on a concurrent slug race. Maps in-tx
   *  unique violations to accurate 409s — critically, a slug race is NOT reported
   *  as "already reviewed" (#1371b); the markApprovedIfPending fence and the C1
   *  guards throw ConflictError directly (not a 23505) and propagate unchanged. */
  private async provisionApproval(
    id: string,
    application: OperatorApplication,
    reviewerUserId: string,
  ): Promise<ApprovalOutcome> {
    for (let attempt = 1; attempt <= SLUG_ATTEMPTS; attempt++) {
      try {
        return await this.runApproval((repos) =>
          this.provision(repos, id, application, reviewerUserId),
        )
      } catch (err) {
        if (pgErrorCode(err) !== PG_ERROR.UNIQUE_VIOLATION) throw err
        const constraint = pgConstraintName(err)
        if (constraint === OPERATORS_SLUG_CONSTRAINT) {
          if (attempt < SLUG_ATTEMPTS) continue
          throw new ConflictError('could not allocate a unique operator slug, please retry')
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
    // Direct promotion (§6.2): the same membership-ledger + users-projection writes
    // operator-grant.resolve() does, minus the invite token lookup + email match.
    // applicantUserId is non-null (guarded in approve()).
    const applicantUserId = application.applicantUserId as string
    await repos.memberships.create({
      userId: applicantUserId,
      operatorId: operator.id,
      role: 'OPERATOR_OWNER',
      status: 'ACTIVE',
    })
    await repos.users.setOperatorAccess(applicantUserId, {
      role: 'OPERATOR_OWNER',
      operatorId: operator.id,
    })
    // Atomic claim+link + race fence: undefined => another approval won; the throw
    // rolls back the operator + membership + projection created above (no orphan).
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
