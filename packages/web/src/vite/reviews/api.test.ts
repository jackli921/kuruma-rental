import { ParseError } from '@/lib/api-error'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  fetchAggregates,
  fetchOperatorReviews,
  operatorReviewsQueryOptions,
  reviewAggregatesQueryOptions,
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

describe('fetchAggregates (#1085 slice 5)', () => {
  it('bypasses the network for an empty id list and returns {}', async () => {
    const out = await fetchAggregates('operators', [])
    expect(out).toEqual({})
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sorts + dedupes ids in the URL so two callers share one cache request', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { aggregates: {} } }))
    await fetchAggregates('operators', ['b', 'a', 'a'])
    // Normalized to ['a','b'] — sort order is alphabetic, duplicates dropped
    // BEFORE the comma-join. encodeURIComponent leaves the comma as %2C.
    const [calledUrl] = fetchMock.mock.calls[0] ?? []
    expect(calledUrl).toBe('/api/reviews/aggregates/operators?ids=a%2Cb')
  })

  it('targets the right kind path segment for vehicles + classes', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { aggregates: {} } }))
    await fetchAggregates('vehicles', ['veh_1'])
    expect((fetchMock.mock.calls.at(-1) ?? [])[0]).toBe(
      '/api/reviews/aggregates/vehicles?ids=veh_1',
    )
    await fetchAggregates('classes', ['cls_1'])
    expect((fetchMock.mock.calls.at(-1) ?? [])[0]).toBe('/api/reviews/aggregates/classes?ids=cls_1')
  })

  it('unwraps the {aggregates} envelope and preserves the null branch verbatim', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        success: true,
        data: { aggregates: { op_1: { avg: 4.5, count: 2 }, op_unrated: null } },
      }),
    )
    const out = await fetchAggregates('operators', ['op_1', 'op_unrated'])
    expect(out).toEqual({
      op_1: { avg: 4.5, count: 2 },
      // null distinguishes "no reviews yet" from a rated-zero — the badge UI
      // forks on this exact value, so a regression to `{}` or {count:0} matters.
      op_unrated: null,
    })
  })
})

describe('fetchOperatorReviews', () => {
  it('parses the published-review list from the {data:{reviews}} envelope', async () => {
    const reviews = [
      {
        id: 'r1',
        overall: 5,
        subRatings: { cleanliness: 5 },
        comment: 'great',
        publishedAt: '2026-06-02T03:00:00.000Z',
      },
    ]
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { reviews } }))
    const result = await fetchOperatorReviews('op1')
    expect(result).toEqual(reviews)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/reviews/for/operators/op1')
  })

  it('throws ParseError when a field is dropped (seam parse)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { reviews: [{ id: 'r1' }] } }))
    await expect(fetchOperatorReviews('op1')).rejects.toThrow(ParseError)
  })
})

describe('operatorReviewsQueryOptions', () => {
  it('keys the cache with the operator id so a refactor cannot silently bust the entry', () => {
    const opts = operatorReviewsQueryOptions('op_abc')
    expect(opts.queryKey).toEqual(['reviews', 'list', 'operators', 'op_abc'])
  })
})

describe('reviewAggregatesQueryOptions (#1085 slice 5)', () => {
  it('keys the cache on the SORTED + DEDUPED id tuple so [a,b] and [b,a] share', () => {
    const a = reviewAggregatesQueryOptions('operators', ['b', 'a'])
    const b = reviewAggregatesQueryOptions('operators', ['a', 'b', 'a'])
    expect(a.queryKey).toEqual(b.queryKey)
    // Locks the actual shape so a refactor to a different prefix can't silently
    // bust every cached entry on deploy.
    expect(a.queryKey).toEqual(['reviews', 'aggregates', 'operators', ['a', 'b']])
  })

  it('disables the query when no ids are passed', () => {
    const opts = reviewAggregatesQueryOptions('classes', [])
    expect(opts.enabled).toBe(false)
  })

  it('enables the query once at least one id is present', () => {
    const opts = reviewAggregatesQueryOptions('vehicles', ['veh_1'])
    expect(opts.enabled).toBe(true)
  })
})
