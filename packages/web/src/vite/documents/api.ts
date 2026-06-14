import { unwrap } from '@/lib/api-error'
import { getApiBaseUrl } from '@/vite/api-base'
import { DOCUMENT_STATUSES, DOCUMENT_TYPES } from '@kuruma/shared/enums'
import { queryOptions } from '@tanstack/react-query'
import { z } from 'zod'

// Enum domains anchor to the shared @kuruma/shared/enums SSoT (#688) so the web
// validation can't drift from the DB pgEnums.
const documentTypeSchema = z.enum(DOCUMENT_TYPES)
const documentStatusSchema = z.enum(DOCUMENT_STATUSES)

export type DocumentType = z.infer<typeof documentTypeSchema>
export type DocumentStatus = z.infer<typeof documentStatusSchema>

// JSON-serialized RenterDocument (#459) — dates arrive as ISO strings. The Vite
// shell owns this DTO rather than importing the api module's copy so it stays
// self-contained (the `lint:modules` boundary forbids reaching into modules).
// Inferred from the schema (#711) so the compile-time type and the runtime parse
// at the seam share one source. The wire also carries server-only `storageKey`
// and `verifierId`; this non-strict schema validates the renter-facing subset and
// strips them. expiryDate/verifiedAt/rejectionReason stay null until approval.
const renterDocumentSchema = z.object({
  id: z.string(),
  renterId: z.string(),
  type: documentTypeSchema,
  status: documentStatusSchema,
  expiryDate: z.string().nullable(),
  verifiedAt: z.string().nullable(),
  rejectionReason: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type RenterDocumentDto = z.infer<typeof renterDocumentSchema>

// Both endpoints wrap the row(s) one level inside `data`; unwrap() peels
// {success,data}, these peel the inner {documents} / {document} envelope.
const myDocumentsResponseSchema = z.object({ documents: z.array(renterDocumentSchema) })
const uploadDocumentResponseSchema = z.object({ document: renterDocumentSchema })

// The calling renter's own documents. Cookie-authenticated (the `_renter` guard
// has already established a session), so `credentials: 'include'` carries it.
export async function fetchMyDocuments(): Promise<RenterDocumentDto[]> {
  const res = await fetch(`${getApiBaseUrl()}/documents/me`, {
    credentials: 'include',
  })
  const data = await unwrap(res, myDocumentsResponseSchema)
  return data.documents
}

export function myDocumentsQueryOptions() {
  return queryOptions({
    queryKey: ['documents', 'me'],
    queryFn: fetchMyDocuments,
  })
}

// Multipart upload (#459). Cookie-authenticated + CSRF-gated, so the caller must
// echo the session's CSRF token. Content-Type is left unset on purpose: the
// browser adds `multipart/form-data; boundary=...` from the FormData itself.
export async function uploadDocument(params: {
  type: DocumentType
  file: File
  csrfToken: string
}): Promise<RenterDocumentDto> {
  const form = new FormData()
  form.append('file', params.file)
  form.append('type', params.type)

  const res = await fetch(`${getApiBaseUrl()}/documents`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'X-CSRF-Token': params.csrfToken },
    body: form,
  })
  const data = await unwrap(res, uploadDocumentResponseSchema)
  return data.document
}
