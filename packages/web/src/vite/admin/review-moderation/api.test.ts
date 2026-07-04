import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchReportedReviews, hideReview } from './api'

const REPORTED_ENTRY = {
  review: {
    id: 'r1',
    subject: 'OPERATOR',
    authorRole: 'RENTER',
    overall: 1,
    comment: 'terrible and abusive',
    moderationStatus: 'VISIBLE',
    submittedAt: '2026-06-01T00:00:00.000Z',
  },
  reportCount: 2,
  reasons: ['abusive', 'spam'],
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('fetchReportedReviews', () => {
  afterEach(() => vi.restoreAllMocks())

  it('GETs the queue for the requested status with cookies, returning items + nextCursor', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        jsonResponse({ success: true, data: { reported: [REPORTED_ENTRY], nextCursor: null } }),
      )

    const result = await fetchReportedReviews({ status: 'VISIBLE' })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/admin/reviews/reported')
    expect(url).toContain('status=VISIBLE')
    // No cursor on the first page -> no cursor query params.
    expect(url).not.toContain('cursorTs')
    expect(init.credentials).toBe('include')
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({ reportCount: 2, reasons: ['abusive', 'spam'] })
    expect(result.items[0]?.review).toMatchObject({
      id: 'r1',
      overall: 1,
      moderationStatus: 'VISIBLE',
    })
    expect(result.nextCursor).toBeNull()
  })

  it('sends the keyset cursor as cursorTs + cursorId and surfaces the response nextCursor', async () => {
    const nextCursor = { lastReportedAt: '2026-06-02T00:00:00.000Z', reviewId: 'r9' }
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        jsonResponse({ success: true, data: { reported: [REPORTED_ENTRY], nextCursor } }),
      )

    const result = await fetchReportedReviews({
      status: 'HIDDEN',
      cursor: { lastReportedAt: '2026-06-05T00:00:00.000Z', reviewId: 'r1' },
    })

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('status=HIDDEN')
    expect(url).toContain('cursorTs=2026-06-05T00%3A00%3A00.000Z')
    expect(url).toContain('cursorId=r1')
    expect(result.nextCursor).toEqual(nextCursor)
  })
})

describe('hideReview', () => {
  afterEach(() => vi.restoreAllMocks())

  it('POSTs the hide endpoint with the CSRF token and cookies', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        jsonResponse({ success: true, data: { review: { id: 'r1', moderationStatus: 'HIDDEN' } } }),
      )

    await hideReview({ id: 'r1', csrfToken: 'csrf_1' })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/admin/reviews/r1/hide')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('include')
    expect((init.headers as Record<string, string>)['X-CSRF-Token']).toBe('csrf_1')
  })
})
