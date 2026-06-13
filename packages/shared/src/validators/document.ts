import { z } from 'zod'
import { DOCUMENT_STATUSES, DOCUMENT_TYPES, type DocumentStatus, type DocumentType } from '../enums'

/**
 * Renter identity documents (#459). Metadata only — the image bytes live in R2,
 * never in Postgres. `IDP` (International Driving Permit) is the booking-gating
 * document; `PASSPORT` is optional/supporting in MVP. Values sourced from the
 * enum SSoT (#688) so the `document_type`/`document_status` pgEnums and these
 * constants can never drift; re-exported for the existing import sites/tests.
 */
export { DOCUMENT_STATUSES, DOCUMENT_TYPES, type DocumentStatus, type DocumentType }

/**
 * Allowed image formats for an uploaded scan. The declared MIME is NOT trusted —
 * the service re-checks the magic bytes (lib/image-signature) before storage to
 * block content-type spoofing, mirroring the vehicle-photo path.
 */
export const DOCUMENT_ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024

/** Multipart upload metadata. The `file` part is validated imperatively in the service. */
export const uploadDocumentSchema = z.object({
  type: z.enum(DOCUMENT_TYPES),
})

// A verification verdict is terminal: only APPROVED or REJECTED, never back to PENDING.
const verifyVerdictSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED']),
  expiryDate: z.string().date('Expiry date must be a YYYY-MM-DD date').optional(),
  rejectionReason: z.string().trim().min(1).optional(),
})

export const verifyDocumentSchema = verifyVerdictSchema.superRefine((data, ctx) => {
  if (data.status === 'APPROVED' && data.expiryDate === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['expiryDate'],
      message: 'Expiry date is required to approve a document',
    })
  }
  if (
    data.status === 'REJECTED' &&
    (data.rejectionReason === undefined || data.rejectionReason === '')
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['rejectionReason'],
      message: 'A rejection reason is required to reject a document',
    })
  }
})

export type UploadDocumentInput = z.infer<typeof uploadDocumentSchema>
export type VerifyDocumentInput = z.infer<typeof verifyDocumentSchema>
