import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchPublishedOperatorTerms } from './publishedApi'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('fetchPublishedOperatorTerms — #877 renter published-terms read', () => {
  const fetchMock = vi.fn()
  beforeEach(() => vi.stubGlobal('fetch', fetchMock))
  afterEach(() => fetchMock.mockReset())

  const doc = {
    version: 'v3',
    locale: 'ja',
    title: 'Rental Terms',
    body: 'Body text',
    acceptanceLabel: 'I agree',
    contentHash: 'abc123',
  }

  it('fetches and parses the published doc for an operator + locale', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: doc }))

    const result = await fetchPublishedOperatorTerms('op1', 'ja')

    expect(result).toEqual(doc)
    expect(fetchMock.mock.calls[0]?.[0]).toContain(
      '/operator-terms/published?operatorId=op1&locale=ja',
    )
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).credentials).toBe('include')
  })

  it('returns null when the operator has no published terms (404)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: false }, 404))

    expect(await fetchPublishedOperatorTerms('op1', 'ja')).toBeNull()
  })

  it('url-encodes the operator id', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: doc }))

    await fetchPublishedOperatorTerms('op/A&b', 'en')

    expect(fetchMock.mock.calls[0]?.[0]).toContain('operatorId=op%2FA%26b')
  })
})
