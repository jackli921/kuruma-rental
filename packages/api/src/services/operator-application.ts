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
