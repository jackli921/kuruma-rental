import { beforeEach, describe, expect, it, vi } from 'vitest'

const API_BASE = 'http://localhost:8787'

vi.mock('@/lib/api-client', () => ({
  getApiBaseUrl: () => API_BASE,
}))

const mockBooking = {
  id: 'b1',
  renterId: 'user1',
  vehicleId: 'v1',
  startAt: '2026-04-15T09:00:00Z',
  endAt: '2026-04-16T09:00:00Z',
  effectiveEndAt: '2026-04-16T10:00:00Z',
  status: 'CONFIRMED',
  source: 'DIRECT',
  externalId: null,
  notes: null,
  createdAt: '2026-04-10T00:00:00Z',
  updatedAt: '2026-04-10T00:00:00Z',
}

describe('booking-api', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  describe('fetchBookings', () => {
    it('fetches bookings from GET /bookings and unwraps response', async () => {
      const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, data: [mockBooking] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )

      const { fetchBookings } = await import('@/lib/booking-api')
      const result = await fetchBookings()

      expect(spy).toHaveBeenCalledWith(`${API_BASE}/bookings`, undefined)
      expect(result).toEqual([mockBooking])
    })

    it('passes date range filters as query params', async () => {
      const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, data: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )

      const from = '2026-04-14T00:00:00Z'
      const to = '2026-04-21T00:00:00Z'

      const { fetchBookings } = await import('@/lib/booking-api')
      await fetchBookings({ from, to })

      const calledUrl = spy.mock.calls[0]?.[0] as string
      expect(calledUrl).toContain('from=')
      expect(calledUrl).toContain('to=')
      expect(calledUrl).toContain(encodeURIComponent(from))
      expect(calledUrl).toContain(encodeURIComponent(to))
    })

    it('passes status filter as query param', async () => {
      const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, data: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )

      const { fetchBookings } = await import('@/lib/booking-api')
      await fetchBookings({ status: 'CONFIRMED' })

      const calledUrl = spy.mock.calls[0]?.[0] as string
      expect(calledUrl).toContain('status=CONFIRMED')
    })

    it('passes vehicleId filter as query param', async () => {
      const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, data: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )

      const { fetchBookings } = await import('@/lib/booking-api')
      await fetchBookings({ vehicleId: 'v1' })

      const calledUrl = spy.mock.calls[0]?.[0] as string
      expect(calledUrl).toContain('vehicleId=v1')
    })

    it('throws on API error response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ success: false, error: 'Server error' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }),
      )

      const { fetchBookings } = await import('@/lib/booking-api')
      await expect(fetchBookings()).rejects.toThrow()
    })
  })
})
