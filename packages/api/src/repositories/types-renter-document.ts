/**
 * Renter-document (KYC) data-access interfaces (#459). Extracted from the
 * `types.ts` barrel to keep it under the file-size cap (mirrors the
 * consent/payment/review/admin-booking split); re-exported from there.
 */
import type { CallerContext } from '../middleware/auth'
import type { RenterDocument } from '../stores'
import type { PaginatedResult } from './types'

export interface RenterDocumentFilters {
  limit?: number
  offset?: number
}

/**
 * The verdict a verifier records (#459). `verifierId` is the reviewing staff
 * user; the repo stamps `verifiedAt` itself. APPROVED carries `expiryDate`,
 * REJECTED carries `rejectionReason` — coherence is enforced upstream by
 * `verifyDocumentSchema` + the service.
 */
export interface DocumentVerifyInput {
  status: 'APPROVED' | 'REJECTED'
  verifierId: string
  expiryDate?: string | null
  rejectionReason?: string | null
}

export interface RenterDocumentRepository {
  /** Renter uploads their own document. Non-staff callers may only create for themselves. */
  create(ctx: CallerContext, data: CreateRenterDocumentData): Promise<RenterDocument>
  /** A renter's own documents (gate + list-mine). Staff may read any renter's. */
  findByRenter(ctx: CallerContext, renterId: string): Promise<RenterDocument[]>
  findById(ctx: CallerContext, id: string): Promise<RenterDocument | undefined>
  /** Platform-staff pending-review queue, oldest first, paginated. */
  listPending(
    ctx: CallerContext,
    filters?: RenterDocumentFilters,
  ): Promise<PaginatedResult<RenterDocument>>
  /** #1087 platform overview: `COUNT(renter_documents WHERE status = 'PENDING')`
   *  for the verification-queue-depth KPI. Unscoped (no ctx) by design — a
   *  platform-wide count whose authz lives in AdminOverviewService — and a pure
   *  COUNT so the overview never materializes the queue just to size it. */
  countPending(): Promise<number>
  /** Platform-staff records a terminal verdict. */
  verify(
    ctx: CallerContext,
    id: string,
    verdict: DocumentVerifyInput,
  ): Promise<RenterDocument | undefined>
  /**
   * Gate lookup for the verification policy — NOT ctx-scoped (internal). Returns
   * the renter's APPROVED documents of a given type; the service decides
   * eligibility against the rental window (expiry).
   */
  findApprovedByType(renterId: string, type: RenterDocument['type']): Promise<RenterDocument[]>
}

export type CreateRenterDocumentData = Pick<RenterDocument, 'renterId' | 'type' | 'storageKey'>
