import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchReportedReviews, hideReview } from './api'

const REPORTED_BODY = {
  success: true,
  data: {
    reported: [
      {
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
      },
    ],
  },
}

describe('fetchReportedReviews', () => {
  afterEach(() => vi.restoreAllMocks())

  it('GETs the admin reported-reviews endpoint with cookies and returns the queue', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(REPORTED_BODY), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const result = await fetchReportedReviews()

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/admin/reviews/reported')
    expect(init.credentials).toBe('include')
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ reportCount: 2, reasons: ['abusive', 'spam'] })
    expect(result[0]?.review).toMatchObject({ id: 'r1', overall: 1, moderationStatus: 'VISIBLE' })
  })
})

describe('hideReview', () => {
  afterEach(() => vi.restoreAllMocks())

  it('POSTs the hide endpoint with the CSRF token and cookies', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: { review: { id: 'r1', moderationStatus: 'HIDDEN' } },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    await hideReview({ id: 'r1', csrfToken: 'csrf_1' })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/admin/reviews/r1/hide')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('include')
    expect((init.headers as Record<string, string>)['X-CSRF-Token']).toBe('csrf_1')
  })
})
