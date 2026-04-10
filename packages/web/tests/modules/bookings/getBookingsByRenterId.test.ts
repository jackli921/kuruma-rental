import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api-client', () => ({
  getApiBaseUrl: () => 'http://localhost:8787',
}))

vi.mock('@/auth', () => ({
  auth: vi.fn(),
}))

import { getBookingsByRenterId } from '@/lib/bookings'

const MOCK_BOOKING_WITH_VEHICLE_1 = {
  id: 'booking-001',
  vehicleId: 'vehicle-001',
  renterId: 'user-001',
  startAt: '2026-04-10T09:00:00.000Z',
  endAt: '2026-04-12T09:00:00.000Z',
  status: 'CONFIRMED',
  createdAt: '2026-04-01T00:00:00.000Z',
  vehicle: {
    name: 'Toyota Corolla',
    photos: ['https://example.com/photo1.jpg', 'https://example.com/photo2.jpg'],
  },
}

const MOCK_BOOKING_WITH_VEHICLE_2 = {
  id: 'booking-002',
  vehicleId: 'vehicle-002',
  renterId: 'user-001',
  startAt: '2026-04-15T10:00:00.000Z',
  endAt: '2026-04-17T10:00:00.000Z',
  status: 'ACTIVE',
  createdAt: '2026-04-05T00:00:00.000Z',
  vehicle: {
    name: 'Honda Fit',
    photos: [],
  },
}

describe('getBookingsByRenterId', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('calls GET /bookings?renterId=X&expand=vehicle and maps response', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: [MOCK_BOOKING_WITH_VEHICLE_1, MOCK_BOOKING_WITH_VEHICLE_2],
        }),
      ),
    )

    const result = await getBookingsByRenterId('user-001')

    expect(fetch).toHaveBeenCalledTimes(1)
    const calledUrl = vi.mocked(fetch).mock.calls[0]?.[0]?.toString() ?? ''
    expect(calledUrl).toBe(
      'http://localhost:8787/bookings?renterId=user-001&expand=vehicle',
    )

    expect(result).toHaveLength(2)

    expect(result[0]?.id).toBe('booking-001')
    expect(result[0]?.vehicleId).toBe('vehicle-001')
    expect(result[0]?.vehicleName).toBe('Toyota Corolla')
    expect(result[0]?.vehiclePhoto).toBe('https://example.com/photo1.jpg')
    expect(result[0]?.startAt).toBe('2026-04-10T09:00:00.000Z')
    expect(result[0]?.endAt).toBe('2026-04-12T09:00:00.000Z')
    expect(result[0]?.status).toBe('CONFIRMED')
    expect(result[0]?.createdAt).toBe('2026-04-01T00:00:00.000Z')

    expect(result[1]?.id).toBe('booking-002')
    expect(result[1]?.vehicleName).toBe('Honda Fit')
    expect(result[1]?.vehiclePhoto).toBeNull()
    expect(result[1]?.status).toBe('ACTIVE')
  })

  it('returns empty array for unknown renter', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: [] })),
    )

    const result = await getBookingsByRenterId('nonexistent-user')

    expect(result).toEqual([])
  })

  it('returns empty array when API returns error', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ success: false, error: 'Server error' }), { status: 500 }),
    )

    const result = await getBookingsByRenterId('user-001')

    expect(result).toEqual([])
  })
})
