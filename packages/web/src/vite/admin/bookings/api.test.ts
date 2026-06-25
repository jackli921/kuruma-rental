import { ParseError } from '@/lib/api-error'
import type { AdminBookingDto } from '@kuruma/shared/types/admin-booking'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ADMIN_BOOKINGS_QUERY_KEY, adminBookingsQueryOptions, fetchAdminBookings } from './api'

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

const row: AdminBookingDto = {
  id: 'bk_1',
  bookingCode: 'ALPHA001',
  status: 'CONFIRMED',
  operatorId: 'op_a',
  operatorName: 'Best Car Rental',
  renterId: 'r_1',
  renterName: 'Alice Tan',
  renterEmail: 'alice@example.com',
  pickupLocationId: 'loc_1',
  dropoffLocationId: 'loc_1',
  startAt: '2026-05-10T01:00:00.000Z',
  endAt: '2026-05-11T01:00:00.000Z',
  effectiveEndAt: '2026-05-11T01:00:00.000Z',
  totalPrice: 12000,
  createdAt: '2026-05-01T00:00:00.000Z',
}

describe('fetchAdminBookings', () => {
  it('GETs /admin/bookings with credentials and unwraps the validated body', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ success: true, data: { bookings: [row], nextCursor: null } }),
    )

    const result = await fetchAdminBookings({})

    expect(fetchMock).toHaveBeenCalledWith('/api/admin/bookings', { credentials: 'include' })
    expect(result).toEqual({ bookings: [row], nextCursor: null })
  })

  it('encodes the active filters as query params', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ success: true, data: { bookings: [], nextCursor: null } }),
    )

    await fetchAdminBookings({
      operatorId: 'op_a',
      bookingCode: 'ALP',
      customer: 'a@b.com',
      status: 'ACTIVE',
    })

    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toContain('operatorId=op_a')
    expect(url).toContain('bookingCode=ALP')
    expect(url).toContain('customer=a%40b.com')
    expect(url).toContain('status=ACTIVE')
  })

  it('throws a ParseError when a row carries an out-of-domain status (#711)', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        success: true,
        data: { bookings: [{ ...row, status: 'BOGUS' }], nextCursor: null },
      }),
    )
    await expect(fetchAdminBookings({})).rejects.toBeInstanceOf(ParseError)
  })

  it('throws a ParseError when operatorName is missing — the admin DTO drifted (#711)', async () => {
    const { operatorName: _drop, ...withoutOperatorName } = row
    fetchMock.mockResolvedValue(
      jsonResponse({ success: true, data: { bookings: [withoutOperatorName], nextCursor: null } }),
    )
    await expect(fetchAdminBookings({})).rejects.toBeInstanceOf(ParseError)
  })
})

describe('adminBookingsQueryOptions', () => {
  it('keys the cache by the filter set for per-filter caching', () => {
    const filters = { operatorId: 'op_a' }
    expect(adminBookingsQueryOptions(filters).queryKey).toEqual([
      ...ADMIN_BOOKINGS_QUERY_KEY,
      filters,
    ])
  })
})
