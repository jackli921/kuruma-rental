import { ParseError } from '@/lib/api-error'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ADMIN_OPERATOR_APPLICATIONS_QUERY_KEY,
  type OperatorApplicationDto,
  approveApplication,
  fetchPendingOperatorApplications,
  pendingOperatorApplicationsQueryOptions,
  rejectOperatorApplication,
  remintInvite,
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

const pendingApp: OperatorApplicationDto = {
  id: 'app_1',
  businessName: 'Osaka Cars',
  contactName: 'Taro Yamada',
  contactEmail: 'taro@example.com',
  contactPhone: '+81-6-1234-5678',
  serviceArea: 'Osaka',
  estimatedFleetSize: '6-20',
  website: null,
  businessLicenseNumber: null,
  businessType: null,
  message: null,
  submittedLocale: 'en',
  status: 'PENDING',
  rejectionReason: null,
  reviewedAt: null,
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
}

describe('pendingOperatorApplicationsQueryOptions', () => {
  it('exposes the stable admin-operator-applications/pending key for cache invalidation', () => {
    expect(ADMIN_OPERATOR_APPLICATIONS_QUERY_KEY).toEqual([
      'admin-operator-applications',
      'pending',
    ])
    expect(pendingOperatorApplicationsQueryOptions().queryKey).toEqual([
      'admin-operator-applications',
      'pending',
    ])
  })
})

describe('fetchPendingOperatorApplications', () => {
  it('GETs the correct URL with credentials and returns the unwrapped array', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [pendingApp] }))

    const result = await fetchPendingOperatorApplications()

    expect(fetchMock).toHaveBeenCalledWith('/api/admin/operator-applications?status=PENDING', {
      credentials: 'include',
    })
    expect(result).toEqual([pendingApp])
  })

  it('rejects with a ParseError when a row carries an out-of-domain status', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ success: true, data: [{ ...pendingApp, status: 'WAT' }] }),
    )
    await expect(fetchPendingOperatorApplications()).rejects.toBeInstanceOf(ParseError)
  })
})

describe('rejectOperatorApplication', () => {
  it('POSTs to the id-encoded URL with X-CSRF-Token header and rejectionReason body only', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        success: true,
        data: { ...pendingApp, status: 'REJECTED', rejectionReason: 'incomplete info' },
      }),
    )

    await rejectOperatorApplication({
      id: 'app_1',
      rejectionReason: 'incomplete info',
      csrfToken: 'csrf-1',
    })

    const [url, opts] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/admin/operator-applications/app_1/reject')
    expect(opts.method).toBe('POST')
    expect(opts.credentials).toBe('include')
    expect(opts.headers).toMatchObject({
      'Content-Type': 'application/json',
      'X-CSRF-Token': 'csrf-1',
    })
    const body = JSON.parse(opts.body) as Record<string, unknown>
    expect(body).toEqual({ rejectionReason: 'incomplete info' })
    expect(body).not.toHaveProperty('csrfToken')
  })
})

describe('approveApplication', () => {
  it('POSTs to the id-encoded URL with X-CSRF-Token header and no body, returns unwrapped DTO', async () => {
    const approveResult = {
      operatorId: 'op_abc',
      inviteUrl: '/provider/invite/tok_xyz',
      expiresAt: '2026-08-01T00:00:00.000Z',
    }
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: approveResult }))

    const result = await approveApplication({ id: 'app_1', csrfToken: 'csrf-1' })

    const [url, opts] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/admin/operator-applications/app_1/approve')
    expect(opts.method).toBe('POST')
    expect(opts.credentials).toBe('include')
    expect(opts.headers).toMatchObject({
      'Content-Type': 'application/json',
      'X-CSRF-Token': 'csrf-1',
    })
    // No request body: approval takes no reviewer input
    expect(opts.body).toBeUndefined()
    expect(result).toEqual(approveResult)
  })
})

describe('remintInvite', () => {
  it('POSTs to the id-encoded remint-invite URL with X-CSRF-Token and no body, returns the fresh link', async () => {
    const remintResult = {
      inviteUrl: '/provider/invite/tok_fresh',
      expiresAt: '2026-09-01T00:00:00.000Z',
    }
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: remintResult }))

    const result = await remintInvite({ id: 'app 1', csrfToken: 'csrf-1' })

    const [url, opts] = fetchMock.mock.calls[0]!
    // The id is URL-encoded so a value with a space can't split the path.
    expect(url).toBe('/api/admin/operator-applications/app%201/remint-invite')
    expect(opts.method).toBe('POST')
    expect(opts.credentials).toBe('include')
    expect(opts.headers).toMatchObject({
      'Content-Type': 'application/json',
      'X-CSRF-Token': 'csrf-1',
    })
    // No request body: the applicant/operator are immutable.
    expect(opts.body).toBeUndefined()
    expect(result).toEqual(remintResult)
  })

  it('rejects with a ParseError when the response omits inviteUrl', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ success: true, data: { expiresAt: '2026-09-01T00:00:00.000Z' } }),
    )
    await expect(remintInvite({ id: 'app_1', csrfToken: 'csrf-1' })).rejects.toBeInstanceOf(
      ParseError,
    )
  })
})
