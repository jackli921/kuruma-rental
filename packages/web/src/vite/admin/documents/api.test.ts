import { ParseError } from '@/lib/api-error'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ADMIN_DOCUMENTS_QUERY_KEY,
  type AdminDocumentDto,
  documentFileUrl,
  fetchPendingDocuments,
  pendingDocumentsQueryOptions,
  verifyDocument,
} from './api'

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

afterEach(() => fetchMock.mockReset())

const pendingDoc: AdminDocumentDto = {
  id: 'doc_1',
  renterId: 'renter_1',
  type: 'IDP',
  status: 'PENDING',
  expiryDate: null,
  verifiedAt: null,
  rejectionReason: null,
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
}

describe('documentFileUrl', () => {
  it('builds the /api-based file URL with the id percent-encoded', () => {
    expect(documentFileUrl('a/b 1')).toBe('/api/documents/a%2Fb%201/file')
  })
})

describe('pendingDocumentsQueryOptions', () => {
  it('exposes the stable admin-documents/pending key for cache invalidation', () => {
    expect(ADMIN_DOCUMENTS_QUERY_KEY).toEqual(['admin-documents', 'pending'])
    expect(pendingDocumentsQueryOptions().queryKey).toEqual(['admin-documents', 'pending'])
  })
})

describe('fetchPendingDocuments', () => {
  it('GETs /api/documents with credentials and unwraps the validated queue', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ success: true, data: { documents: [pendingDoc], total: 1 } }),
    )

    const result = await fetchPendingDocuments()

    expect(fetchMock).toHaveBeenCalledWith('/api/documents', { credentials: 'include' })
    expect(result).toEqual([pendingDoc])
  })

  it('rejects with a ParseError when a row carries an out-of-domain status', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        success: true,
        data: { documents: [{ ...pendingDoc, status: 'WAT' }], total: 1 },
      }),
    )
    await expect(fetchPendingDocuments()).rejects.toBeInstanceOf(ParseError)
  })
})

describe('verifyDocument', () => {
  it('POSTs an APPROVE verdict with the CSRF header and no csrfToken in the body', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        success: true,
        data: { document: { ...pendingDoc, status: 'APPROVED', expiryDate: '2030-01-31' } },
      }),
    )

    await verifyDocument({
      id: 'doc_1',
      status: 'APPROVED',
      expiryDate: '2030-01-31',
      csrfToken: 'csrf-1',
    })

    const [url, opts] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/documents/doc_1/verify')
    expect(opts.method).toBe('POST')
    expect(opts.credentials).toBe('include')
    expect(opts.headers).toMatchObject({
      'Content-Type': 'application/json',
      'X-CSRF-Token': 'csrf-1',
    })
    expect(JSON.parse(opts.body)).toEqual({ status: 'APPROVED', expiryDate: '2030-01-31' })
  })

  it('POSTs a REJECT verdict with the rejection reason and no expiry', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        success: true,
        data: { document: { ...pendingDoc, status: 'REJECTED', rejectionReason: 'blurry scan' } },
      }),
    )

    await verifyDocument({
      id: 'doc_1',
      status: 'REJECTED',
      rejectionReason: 'blurry scan',
      csrfToken: 'csrf-1',
    })

    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({
      status: 'REJECTED',
      rejectionReason: 'blurry scan',
    })
  })

  it('refuses to APPROVE without an expiry date — never hits the network', async () => {
    await expect(
      verifyDocument({ id: 'doc_1', status: 'APPROVED', csrfToken: 'csrf-1' }),
    ).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
