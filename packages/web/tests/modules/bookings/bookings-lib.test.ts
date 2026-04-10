import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api-client', () => ({
  getApiBaseUrl: () => 'http://localhost:8787',
}))

vi.mock('@/auth', () => ({
  auth: vi.fn(),
}))

import { checkAvailability, getBookingById } from '@/lib/bookings'

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

describe('checkAvailability', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns true when vehicle is available', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: { available: true, vehicle: {}, conflicts: [] },
        }),
      ),
    )

    const result = await checkAvailability(
      'vehicle-001',
      new Date('2026-04-15T09:00:00Z'),
      new Date('2026-04-17T09:00:00Z'),
    )

    expect(fetch).toHaveBeenCalledTimes(1)
    const calledUrl = vi.mocked(fetch).mock.calls[0]?.[0]?.toString() ?? ''
    expect(calledUrl).toContain('/availability/vehicle-001')
    expect(calledUrl).toContain('from=2026-04-15T09%3A00%3A00.000Z')
    expect(calledUrl).toContain('to=2026-04-17T09%3A00%3A00.000Z')
    expect(result).toBe(true)
  })

  it('returns false when vehicle is not available', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            available: false,
            vehicle: {},
            conflicts: [{ id: 'booking-existing' }],
          },
        }),
      ),
    )

    const result = await checkAvailability(
      'vehicle-001',
      new Date('2026-04-10T09:00:00Z'),
      new Date('2026-04-12T09:00:00Z'),
    )

    expect(result).toBe(false)
  })

  it('returns false when API returns error', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ success: false, error: 'Vehicle not found' }), { status: 404 }),
    )

    const result = await checkAvailability(
      'nonexistent',
      new Date('2026-04-15T09:00:00Z'),
      new Date('2026-04-17T09:00:00Z'),
    )

    expect(result).toBe(false)
  })
})
