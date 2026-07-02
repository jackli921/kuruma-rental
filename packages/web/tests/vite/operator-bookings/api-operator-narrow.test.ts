import {
  fetchCalendarBlocks,
  fetchCalendarBookings,
  fetchCalendarVehicles,
  fetchNeedsAssignment,
  needsAssignmentQueryOptions,
  operatorCalendarBlocksQueryOptions,
  operatorCalendarQueryOptions,
  operatorCalendarVehiclesQueryOptions,
} from '@/vite/operator-bookings/api'
import { afterEach, describe, expect, it, vi } from 'vitest'

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)
afterEach(() => fetchMock.mockReset())

const FROM = '2026-08-01T00:00:00.000Z'
const TO = '2026-08-07T00:00:00.000Z'

describe('operator bookings reads — picked-operator narrowing (#1230 slice 5a)', () => {
  it('fetchCalendarBookings appends operatorId when an operator is picked', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [], nextCursor: null }))

    await fetchCalendarBookings(FROM, TO, 'op_a')

    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toContain('operatorId=op_a')
  })

  it('fetchCalendarBookings omits operatorId when no operator is picked', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [], nextCursor: null }))

    await fetchCalendarBookings(FROM, TO)

    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).not.toContain('operatorId')
  })

  it('fetchNeedsAssignment appends operatorId when an operator is picked', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [] }))

    await fetchNeedsAssignment('op_a')

    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toContain('operatorId=op_a')
    expect(url).toContain('needsAssignment=true')
  })

  it('keys the calendar + needs-assignment caches by the picked operator', () => {
    expect(operatorCalendarQueryOptions(FROM, TO, 'op_a').queryKey).toEqual([
      'operator-bookings',
      'calendar',
      FROM,
      TO,
      'op_a',
    ])
    expect(needsAssignmentQueryOptions('op_a').queryKey).toEqual([
      'operator-bookings',
      'needs-assignment',
      'op_a',
    ])
  })
})

describe('operator calendar vehicles + blocks — picked-operator narrowing (#1230 slice 5b)', () => {
  it('fetchCalendarVehicles appends operatorId when an operator is picked', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [] }))
    await fetchCalendarVehicles('op_a')
    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toContain('operatorId=op_a')
  })

  it('fetchCalendarVehicles omits operatorId when no operator is picked', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [] }))
    await fetchCalendarVehicles()
    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).not.toContain('operatorId')
  })

  it('keys the vehicles cache by the picked operator', () => {
    expect(operatorCalendarVehiclesQueryOptions('op_a').queryKey).toEqual([
      'operator-bookings',
      'calendar',
      'vehicles',
      'op_a',
    ])
  })

  it('fetchCalendarBlocks appends operatorId when an operator is picked', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [] }))
    await fetchCalendarBlocks(FROM, TO, 'op_a')
    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toContain('operatorId=op_a')
  })

  it('keys the blocks cache by the picked operator', () => {
    expect(operatorCalendarBlocksQueryOptions(FROM, TO, 'op_a').queryKey).toEqual([
      'operator-bookings',
      'blocks',
      FROM,
      TO,
      'op_a',
    ])
  })
})
