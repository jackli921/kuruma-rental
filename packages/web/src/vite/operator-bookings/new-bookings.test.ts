import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  fetchNewOrderBookings,
  newOrderBookingsQueryOptions,
  newOrderScanQueryKey,
} from './new-bookings'

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)
afterEach(() => fetchMock.mockReset())

describe('fetchNewOrderBookings — picked-operator narrowing (#1230 slice 5a)', () => {
  it('appends operatorId when a picker admin has picked an operator', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [] }))

    await fetchNewOrderBookings('op_a')

    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toContain('operatorId=op_a')
    expect(url).toContain('status=CONFIRMED')
  })

  it('omits operatorId when no operator is picked (session-scoped read)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [] }))

    await fetchNewOrderBookings(undefined)

    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).not.toContain('operatorId')
  })
})

describe('newOrderScanQueryKey — per-operator cache isolation', () => {
  it('keys distinct picked operators separately, and null for no pick', () => {
    expect(newOrderScanQueryKey('op_a')).toEqual(['operator-bookings', 'new-order-scan', 'op_a'])
    expect(newOrderScanQueryKey(undefined)).toEqual(['operator-bookings', 'new-order-scan', null])
  })

  it('threads the picked operator into the query options key', () => {
    expect(newOrderBookingsQueryOptions(true, 'op_a').queryKey).toEqual(
      newOrderScanQueryKey('op_a'),
    )
  })
})
