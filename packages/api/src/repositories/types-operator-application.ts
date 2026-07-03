import type { OperatorApplicationStatus } from '@kuruma/shared/enums'
import type { OperatorApplication } from '../stores'

// #1277: self-serve operator registration data access. Split into its own
// module to keep the repositories/types barrel under the file-size cap;
// re-exported there so callers' imports don't change.

/**
 * Admin-queue read filters (#1371). Keyset pagination: `after` is a structured
 * pivot `(createdAt, id)` — the service owns the opaque cursor string and
 * decodes it here, so neither repo impl parses cursor text. `limit` bounds the
 * scan; the service overfetches by one to detect a next page.
 */
export interface OperatorApplicationListFilters {
  status?: OperatorApplicationStatus
  limit?: number
  after?: { createdAt: Date; id: string }
}

export interface OperatorApplicationRepository {
  /** Insert a PENDING application. Throws UNIQUE_VIOLATION on the live-email
   *  partial index (named OPERATOR_APPLICATION_EMAIL_CONSTRAINT) -> service 409. */
  create(
    data: Omit<
      OperatorApplication,
      | 'id'
      | 'status'
      | 'operatorId'
      | 'reviewedByUserId'
      | 'reviewedAt'
      | 'reviewerNotes'
      | 'rejectionReason'
      | 'createdAt'
      | 'updatedAt'
    >,
  ): Promise<OperatorApplication>
  findById(id: string): Promise<OperatorApplication | undefined>
  /** Admin queue, newest-first (createdAt DESC, id ASC). Optional status filter;
   *  keyset-paginated via `limit` + `after` (the service encodes/decodes the cursor). */
  list(filters?: OperatorApplicationListFilters): Promise<OperatorApplication[]>
  /** Idempotency + claim+link (approval tx step): UPDATE ... SET status='APPROVED',
   *  operatorId, reviewedByUserId, reviewedAt WHERE id=? AND status='PENDING'
   *  RETURNING row. Returns undefined when 0 rows matched (already reviewed). */
  markApprovedIfPending(
    id: string,
    operatorId: string,
    reviewedByUserId: string,
    reviewedAt: Date,
  ): Promise<OperatorApplication | undefined>
  /** REJECTED terminal write. WHERE id=? AND status='PENDING'. */
  markRejectedIfPending(
    id: string,
    reviewedByUserId: string,
    reviewedAt: Date,
    rejectionReason: string,
  ): Promise<OperatorApplication | undefined>
}
