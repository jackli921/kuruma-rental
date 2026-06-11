import { ApiError } from '@/lib/api-error'
import { fetchOperatorBookings, operatorBookingsQueryOptions } from '@/vite/operator-bookings/api'
import { afterEach, describe, expect, it, vi } from 'vitest'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const rawBooking = (over: Record<string, unknown> = {}) => ({
  id: 'bk-1',
  operatorId: 'op-1',
  renterId: 'r-1',
  assignedVehicleId: 'veh-1',
  bookingCode: 'ABCD2345',
  status: 'CONFIRMED',
  startAt: '2026-07-01T01:00:00.000Z',
  endAt: '2026-07-03T01:00:00.000Z',
  totalPrice: 24000,
  vehicle: { name: 'Toyota Aqua', photos: ['a.jpg'] },
  renter: { id: 'r-1', name: 'Jane', email: 'jane@example.com', language: 'en' },
  ...over,
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('fetchOperatorBookings', () => {
  it('requests the operator-scoped list expanding vehicle and renter, with credentials', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: [], nextCursor: null }))
    vi.stubGlobal('fetch', fetchMock)

    await fetchOperatorBookings()

    const [url, init] = fetchMock.mock.calls[0]!
    const parsed = new URL(url as string, 'http://x')
    expect(parsed.pathname).toBe('/api/bookings')
    expect(parsed.searchParams.get('expand')).toBe('vehicle,renter')
    expect((init as RequestInit).credentials).toBe('include')
  })

  it('maps the envelope to rows (code, status, range, total, vehicle name, renter)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ success: true, data: [rawBooking()], nextCursor: null })),
    )

    const rows = await fetchOperatorBookings()

    expect(rows).toEqual([
      {
        id: 'bk-1',
        bookingCode: 'ABCD2345',
        status: 'CONFIRMED',
        startAt: '2026-07-01T01:00:00.000Z',
        endAt: '2026-07-03T01:00:00.000Z',
        totalPrice: 24000,
        vehicleName: 'Toyota Aqua',
        renter: { id: 'r-1', name: 'Jane', email: 'jane@example.com' },
      },
    ])
  })

  it('passes through an optional status filter', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: [], nextCursor: null }))
    vi.stubGlobal('fetch', fetchMock)

    await fetchOperatorBookings({ status: 'ACTIVE' })

    const parsed = new URL(fetchMock.mock.calls[0]![0] as string, 'http://x')
    expect(parsed.searchParams.get('status')).toBe('ACTIVE')
  })

  it('normalizes a missing vehicle expansion to null', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          success: true,
          data: [rawBooking({ vehicle: undefined })],
          nextCursor: null,
        }),
      ),
    )

    const [row] = await fetchOperatorBookings()
    expect(row!.vehicleName).toBeNull()
  })

  it('normalizes a missing renter expansion to null', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          success: true,
          data: [rawBooking({ renter: undefined })],
          nextCursor: null,
        }),
      ),
    )

    const [row] = await fetchOperatorBookings()
    expect(row!.renter).toBeNull()
  })

  it('throws ApiError on a failure envelope', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ success: false, error: 'Unauthorized' }, 401)),
    )

    await expect(fetchOperatorBookings()).rejects.toBeInstanceOf(ApiError)
  })
})

describe('operatorBookingsQueryOptions', () => {
  it('keys by the operator-bookings list and the status + limit filters', () => {
    expect(operatorBookingsQueryOptions().queryKey).toEqual([
      'operator-bookings',
      undefined,
      undefined,
    ])
    expect(operatorBookingsQueryOptions({ status: 'ACTIVE', limit: 50 }).queryKey).toEqual([
      'operator-bookings',
      'ACTIVE',
      50,
    ])
  })
})
