import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockAuth = vi.fn()

vi.mock('@/auth', () => ({
  auth: () => mockAuth(),
}))

vi.mock('@/lib/api-client', () => ({
  getApiBaseUrl: () => 'http://localhost:8787',
}))

import { createBooking } from '@/lib/bookings'

describe('createBooking', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns error when user is not authenticated', async () => {
    mockAuth.mockResolvedValue(null)

    const result = await createBooking({
      vehicleId: 'vehicle-001',
      startAt: '2026-04-15T09:00:00Z',
      endAt: '2026-04-17T09:00:00Z',
    })

    expect(result).toEqual({
      success: false,
      error: 'You must be logged in to make a booking.',
    })
  })

  it('returns error when vehicleId is missing', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-001' } })

    const result = await createBooking({
      vehicleId: '',
      startAt: '2026-04-15T09:00:00Z',
      endAt: '2026-04-17T09:00:00Z',
    })

    expect(result).toEqual({
      success: false,
      error: 'Vehicle ID is required.',
    })
  })

  it('returns error when dates are missing', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-001' } })

    const result = await createBooking({
      vehicleId: 'vehicle-001',
      startAt: '',
      endAt: '',
    })

    expect(result).toEqual({
      success: false,
      error: 'Start and end dates are required.',
    })
  })

  it('returns error when end date is before start date', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-001' } })

    const result = await createBooking({
      vehicleId: 'vehicle-001',
      startAt: '2026-04-17T09:00:00Z',
      endAt: '2026-04-15T09:00:00Z',
    })

    expect(result).toEqual({
      success: false,
      error: 'End date must be after start date.',
    })
  })

  it('creates booking via API and returns success with booking id', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-001' } })

    // First fetch: checkAvailability -> available
    // Second fetch: POST /bookings -> created booking
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            data: { available: true, vehicle: {}, conflicts: [] },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            data: {
              id: 'booking-new',
              renterId: 'user-001',
              vehicleId: 'vehicle-001',
              status: 'CONFIRMED',
            },
          }),
          { status: 201 },
        ),
      )

    const result = await createBooking({
      vehicleId: 'vehicle-001',
      startAt: '2026-04-15T09:00:00Z',
      endAt: '2026-04-17T09:00:00Z',
    })

    expect(result).toEqual({
      success: true,
      bookingId: 'booking-new',
    })

    // Verify POST was called with correct body
    expect(fetch).toHaveBeenCalledTimes(2)
    const postCall = vi.mocked(fetch).mock.calls[1]
    const postUrl = postCall?.[0]?.toString() ?? ''
    expect(postUrl).toBe('http://localhost:8787/bookings')
    const postInit = postCall?.[1] as RequestInit
    expect(postInit.method).toBe('POST')
    const body = JSON.parse(postInit.body as string)
    expect(body.vehicleId).toBe('vehicle-001')
    expect(body.renterId).toBe('user-001')
    expect(body.source).toBe('DIRECT')
  })

  it('returns error when vehicle is not available', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-001' } })

    vi.mocked(fetch).mockResolvedValueOnce(
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

    const result = await createBooking({
      vehicleId: 'vehicle-001',
      startAt: '2026-04-15T09:00:00Z',
      endAt: '2026-04-17T09:00:00Z',
    })

    expect(result).toEqual({
      success: false,
      error: 'This vehicle is not available for the selected dates.',
    })
  })

  it('returns error when API POST fails', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-001' } })

    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            data: { available: true, vehicle: {}, conflicts: [] },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: false,
            error: { vehicleId: ['Vehicle not found'] },
          }),
          { status: 400 },
        ),
      )

    const result = await createBooking({
      vehicleId: 'vehicle-001',
      startAt: '2026-04-15T09:00:00Z',
      endAt: '2026-04-17T09:00:00Z',
    })

    expect(result).toEqual({
      success: false,
      error: 'Failed to create booking.',
    })
  })
})
