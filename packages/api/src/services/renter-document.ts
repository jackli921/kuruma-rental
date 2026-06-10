import {
  DOCUMENT_ALLOWED_MIME_TYPES,
  type DocumentType,
  MAX_DOCUMENT_BYTES,
} from '@kuruma/shared/validators/document'
import { detectImageType } from '../lib/image-signature'
import type { CallerContext } from '../middleware/auth'
import type {
  DocumentStorage,
  DocumentVerifyInput,
  PaginatedResult,
  RenterDocumentFilters,
  RenterDocumentRepository,
} from '../repositories/types'
import type { RenterDocument } from '../stores'

const ALLOWED_MIME = new Set<string>(DOCUMENT_ALLOWED_MIME_TYPES)

export type UploadResult =
  | { ok: true; document: RenterDocument }
  | { ok: false; status: number; error: string }

export type VerifyResult =
  | { ok: true; document: RenterDocument }
  | { ok: false; status: number; error: string }

export type EligibilityVerdict =
  | { ok: true }
  | { ok: false; reason: 'NO_APPROVED_IDP' | 'IDP_EXPIRES_BEFORE_RETURN' }

export interface UploadDocumentParams {
  renterId: string
  type: DocumentType
}

export class RenterDocumentService {
  constructor(
    private readonly repo: RenterDocumentRepository,
    private readonly storage: DocumentStorage,
  ) {}

  async upload(
    ctx: CallerContext,
    params: UploadDocumentParams,
    file: File,
  ): Promise<UploadResult> {
    const validation = await validateDocumentFile(file)
    if (!validation.ok) return validation

    // Store first; only persist metadata once the bytes are safely in R2.
    const { key } = await this.storage.put(params.renterId, file)
    try {
      const document = await this.repo.create(ctx, {
        renterId: params.renterId,
        type: params.type,
        storageKey: key,
      })
      return { ok: true, document }
    } catch (err) {
      // Metadata write failed — don't leave an orphaned object behind.
      await this.storage.delete(key).catch(() => {})
      throw err
    }
  }

  async listMine(ctx: CallerContext, renterId: string): Promise<RenterDocument[]> {
    return this.repo.findByRenter(ctx, renterId)
  }

  async listPending(
    ctx: CallerContext,
    filters?: RenterDocumentFilters,
  ): Promise<PaginatedResult<RenterDocument>> {
    return this.repo.listPending(ctx, filters)
  }

  async verify(
    ctx: CallerContext,
    id: string,
    verdict: DocumentVerifyInput,
  ): Promise<VerifyResult> {
    const document = await this.repo.verify(ctx, id, verdict)
    if (!document) return { ok: false, status: 404, error: 'Document not found' }
    return { ok: true, document }
  }

  /**
   * Verification policy (#459). A renter is eligible to book iff they have an
   * APPROVED IDP whose expiry covers the rental return date. Type + date aware:
   * an approved PASSPORT does NOT satisfy the IDP requirement, and an IDP that
   * lapses before the rental ends does not count. PASSPORT is supporting only.
   */
  async isRenterEligible(renterId: string, rentalEndAt: Date): Promise<EligibilityVerdict> {
    const approvedIdps = await this.repo.findApprovedByType(renterId, 'IDP')
    if (approvedIdps.length === 0) return { ok: false, reason: 'NO_APPROVED_IDP' }

    // Intentionally the UTC calendar day (mirrors lib/expiry.ts). IDP expiry is a
    // coarse date, so a ≤1-day skew at the JST boundary is acceptable here.
    const returnDay = rentalEndAt.toISOString().slice(0, 10)
    // YYYY-MM-DD strings sort lexicographically as dates. Fail CLOSED on a null
    // expiry: the validator requires one to APPROVE so it shouldn't occur, but a
    // gate must never grant eligibility from an unexpected null.
    const valid = approvedIdps.some((d) => d.expiryDate !== null && d.expiryDate >= returnDay)
    return valid ? { ok: true } : { ok: false, reason: 'IDP_EXPIRES_BEFORE_RETURN' }
  }
}

async function validateDocumentFile(
  file: File,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (!ALLOWED_MIME.has(file.type)) {
    return { ok: false, status: 400, error: 'Only JPEG, PNG or WebP images are allowed' }
  }
  if (file.size > MAX_DOCUMENT_BYTES) {
    return { ok: false, status: 400, error: 'File must be under 10MB' }
  }
  const bytes = new Uint8Array(await file.arrayBuffer())
  const detected = detectImageType(bytes)
  if (detected === null || !ALLOWED_MIME.has(detected)) {
    return { ok: false, status: 415, error: 'File content does not match an allowed image format' }
  }
  if (detected !== file.type) {
    return { ok: false, status: 415, error: 'File content does not match declared Content-Type' }
  }
  return { ok: true }
}
