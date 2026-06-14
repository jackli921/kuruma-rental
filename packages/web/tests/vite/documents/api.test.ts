import { ParseError } from '@/lib/api-error'
import { fetchMyDocuments, uploadDocument } from '@/vite/documents/api'
import { afterEach, describe, expect, it, vi } from 'vitest'

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

const documentData = {
  id: 'd1',
  renterId: 'r1',
  type: 'IDP' as const,
  status: 'PENDING' as const,
  expiryDate: null,
  verifiedAt: null,
  rejectionReason: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

describe('fetchMyDocuments', () => {
  it('GETs /api/documents/me with credentials and returns the unwrapped documents array', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ success: true, data: { documents: [documentData] } }),
    )
    const result = await fetchMyDocuments()
    expect(fetchMock).toHaveBeenCalledWith('/api/documents/me', { credentials: 'include' })
    expect(result).toEqual([documentData])
  })

  it('throws an ApiError carrying the status when the envelope is unsuccessful', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: false, error: 'boom' }, 500))
    await expect(fetchMyDocuments()).rejects.toThrow('boom')
  })

  it('strips server-only fields (storageKey, verifierId) the DTO omits (#711)', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        success: true,
        data: { documents: [{ ...documentData, storageKey: 'r2/key', verifierId: null }] },
      }),
    )
    // Non-strict schema: only the renter-facing subset comes back, server keys gone.
    expect(await fetchMyDocuments()).toEqual([documentData])
  })

  it('rejects with a ParseError when a document has an unknown status (drift #711)', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        success: true,
        data: { documents: [{ ...documentData, status: 'EXPIRED' }] },
      }),
    )
    await expect(fetchMyDocuments()).rejects.toBeInstanceOf(ParseError)
  })
})

describe('uploadDocument', () => {
  it('POSTs multipart to /api/documents with the CSRF header and the type+file parts', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ success: true, data: { document: documentData } }, 201),
    )
    const file = new File(['idp-bytes'], 'idp.png', { type: 'image/png' })

    const result = await uploadDocument({ type: 'IDP', file, csrfToken: 'csrf-9' })

    expect(result).toEqual(documentData)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/documents')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('include')
    expect(init.headers).toEqual({ 'X-CSRF-Token': 'csrf-9' })

    const body = init.body as FormData
    expect(body).toBeInstanceOf(FormData)
    expect(body.get('type')).toBe('IDP')
    expect(body.get('file')).toBe(file)
  })

  it('throws on a {success:false} envelope', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: false, error: 'too large' }, 413))
    const file = new File(['x'], 'x.png', { type: 'image/png' })
    await expect(uploadDocument({ type: 'PASSPORT', file, csrfToken: 't' })).rejects.toThrow(
      'too large',
    )
  })

  it('rejects with a ParseError when the uploaded document is malformed (drift #711)', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ success: true, data: { document: { id: 'd1' } } }, 201),
    )
    const file = new File(['x'], 'x.png', { type: 'image/png' })
    await expect(uploadDocument({ type: 'IDP', file, csrfToken: 't' })).rejects.toBeInstanceOf(
      ParseError,
    )
  })
})
