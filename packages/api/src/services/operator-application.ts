import type { OperatorApplicationInput } from '@kuruma/shared/validators/operator-application'
import { ConflictError } from '../auth/guards'
import {
  OPERATOR_APPLICATION_EMAIL_CONSTRAINT,
  PG_ERROR,
  pgConstraintName,
  pgErrorCode,
} from '../pg-errors'
import type { OperatorApplicationRepository } from '../repositories/types'
import type { OperatorApplication } from '../stores'

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

// The honeypot/consent fields are validated + stripped at the route boundary; the
// service persists only the domain fields (contactEmail already lowercased by zod).
type SubmitInput = Omit<OperatorApplicationInput, 'honeypot' | 'consent'>

export class OperatorApplicationService {
  constructor(private readonly repo: OperatorApplicationRepository) {}

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
