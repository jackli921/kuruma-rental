import { unwrap } from '@/lib/api-error'
import { getApiBaseUrl } from '@/vite/api-base'
import { DOCUMENT_STATUSES, DOCUMENT_TYPES } from '@kuruma/shared/enums'
import { verifyDocumentSchema } from '@kuruma/shared/validators/document'
import { queryOptions } from '@tanstack/react-query'
import { z } from 'zod'

// Platform-admin renter-document review (#932). The Vite shell owns this DTO — it
// does NOT import the api package's RenterDocument interface (the api↔web boundary
// forbids reaching into the api package). Enum domains anchor to the
// @kuruma/shared/enums SSoT so the parse can't drift from the DB pgEnums. The
// schema is non-strict: the wire also carries server-only storageKey/verifierId,
// which it validates away so they never reach the client.
const adminDocumentSchema = z.object({
  id: z.string(),
  renterId: z.string(),
  type: z.enum(DOCUMENT_TYPES),
  status: z.enum(DOCUMENT_STATUSES),
  expiryDate: z.string().nullable(),
  verifiedAt: z.string().nullable(),
  rejectionReason: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type AdminDocumentDto = z.infer<typeof adminDocumentSchema>

// GET /documents wraps the queue one level inside `data` as { documents, total };
// POST /documents/:id/verify wraps the row as { document }.
const pendingDocumentsResponseSchema = z.object({
  documents: z.array(adminDocumentSchema),
  total: z.number(),
})
const verifyResponseSchema = z.object({ document: adminDocumentSchema })

export const ADMIN_DOCUMENTS_QUERY_KEY = ['admin-documents', 'pending'] as const

// The platform-staff pending-review queue (oldest first). Cookie-authenticated;
// the server gates on the session role (STAFF_ROLES = PLATFORM_ADMIN).
export async function fetchPendingDocuments(): Promise<AdminDocumentDto[]> {
  const res = await fetch(`${getApiBaseUrl()}/documents`, { credentials: 'include' })
  const data = await unwrap(res, pendingDocumentsResponseSchema)
  return data.documents
}

export function pendingDocumentsQueryOptions() {
  return queryOptions({
    queryKey: ADMIN_DOCUMENTS_QUERY_KEY,
    queryFn: fetchPendingDocuments,
  })
}

// Same-origin, cookie-authed scan stream (#932). Must carry the /api base so the
// <img> hits the Hono API rather than the SPA origin; the id is percent-encoded.
export function documentFileUrl(id: string): string {
  return `${getApiBaseUrl()}/documents/${encodeURIComponent(id)}/file`
}

// Record a verdict (#932). Cookie-authed + CSRF-gated, so the caller echoes the
// session CSRF token in the header — NEVER the body. The verdict is validated
// against the shared cross-field rule (APPROVED⇒expiryDate, REJECTED⇒reason)
// before the network call, so an invalid form fails fast and offline.
export async function verifyDocument(params: {
  id: string
  status: 'APPROVED' | 'REJECTED'
  expiryDate?: string
  rejectionReason?: string
  csrfToken: string
}): Promise<AdminDocumentDto> {
  const { id, csrfToken, ...verdict } = params
  const body = verifyDocumentSchema.parse(verdict)
  const res = await fetch(`${getApiBaseUrl()}/documents/${encodeURIComponent(id)}/verify`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
    body: JSON.stringify(body),
  })
  const data = await unwrap(res, verifyResponseSchema)
  return data.document
}
