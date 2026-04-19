import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api-client', () => ({
  createApiClient: () => {
    const { hc } = require('hono/client')
    return hc('http://localhost:8787')
  },
}))

vi.mock('@/auth', () => ({
  auth: vi.fn(),
}))

import { getBookingById } from '@/lib/bookings'

const MOCK_BOOKING = {
  id: 'booking-001',
  renterId: 'user-001',
  vehicleId: 'vehicle-001',
  startAt: '2026-04-10T09:00:00.000Z',
  endAt: '2026-04-12T09:00:00.000Z',
  status: 'CONFIRMED',
  source: 'DIRECT',
  externalId: null,
  notes: null,
  createdAt: '2026-04-01T00:00:00.000Z',
  updatedAt: '2026-04-01T00:00:00.000Z',
}

describe('getBookingById', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('calls GET /bookings/:id and returns the booking', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: MOCK_BOOKING })),
    )

    const result = await getBookingById('booking-001')

    expect(fetch).toHaveBeenCalledTimes(1)
    const calledUrl = vi.mocked(fetch).mock.calls[0]?.[0]?.toString() ?? ''
    expect(calledUrl).toBe('http://localhost:8787/bookings/booking-001')
    expect(result).not.toBeNull()
    expect(result?.id).toBe('booking-001')
    expect(result?.renterId).toBe('user-001')
    expect(result?.vehicleId).toBe('vehicle-001')
    expect(result?.status).toBe('CONFIRMED')
  })

  it('returns null when booking does not exist', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ success: false, error: 'Booking not found' }), { status: 404 }),
    )

    const result = await getBookingById('nonexistent-id')

    expect(result).toBeNull()
  })
})
