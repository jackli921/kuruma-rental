import { unwrap } from '@/lib/api-error'
import { getApiBaseUrl } from '@/vite/api-base'
import { queryOptions } from '@tanstack/react-query'

export type DocumentType = 'IDP' | 'PASSPORT'
export type DocumentStatus = 'PENDING' | 'APPROVED' | 'REJECTED'

// JSON-serialized RenterDocument (#459) — dates arrive as ISO strings. The Vite
// shell owns this DTO rather than importing the api module's copy so it stays
// self-contained (the `lint:modules` boundary forbids reaching into modules).
export interface RenterDocumentDto {
  id: string
  renterId: string
  type: DocumentType
  status: DocumentStatus
  expiryDate: string | null
  verifiedAt: string | null
  rejectionReason: string | null
  createdAt: string
  updatedAt: string
}

// The calling renter's own documents. Cookie-authenticated (the `_renter` guard
// has already established a session), so `credentials: 'include'` carries it.
export async function fetchMyDocuments(): Promise<RenterDocumentDto[]> {
  const res = await fetch(`${getApiBaseUrl()}/documents/me`, {
    credentials: 'include',
  })
  const data = await unwrap<{ documents: RenterDocumentDto[] }>(res)
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
  const data = await unwrap<{ document: RenterDocumentDto }>(res)
  return data.document
}
