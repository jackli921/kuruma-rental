// Slice 6 (#392): renters book a CONCRETE vehicle chosen in the storefront.
// The server action submits requestedVehicleId + pickup/dropoff location +
// optional insuranceOptionId (no classId — server-derived) and forces source
// DIRECT. renterId is forced to self at the API, so it is not sent.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockAuth = vi.fn()

vi.mock('@/auth', () => ({
  auth: () => mockAuth(),
}))

vi.mock('@/lib/api-client', () => ({
  createApiClient: () => {
    const { hc } = require('hono/client')
    return hc('http://localhost:8787')
  },
}))

vi.mock('@/lib/api-token', () => ({
  getApiToken: vi.fn().mockResolvedValue('test-token'),
}))

import { createBooking } from '@/lib/bookings'

const START = '2026-05-01T09:00:00.000Z'
const END = '2026-05-03T09:00:00.000Z'

const VALID = {
  requestedVehicleId: 'veh-001',
  pickupLocationId: 'loc-001',
  dropoffLocationId: 'loc-001',
  startAt: START,
  endAt: END,
}

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

    const result = await createBooking(VALID)

    expect(result).toEqual({
      success: false,
      error: 'You must be logged in to make a booking.',
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('returns error when the requested vehicle is missing', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-001' } })

    const result = await createBooking({ ...VALID, requestedVehicleId: '' })

    expect(result).toEqual({
      success: false,
      error: 'Vehicle and pickup location are required.',
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('returns error when end is not after start', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-001' } })

    const result = await createBooking({ ...VALID, startAt: END, endAt: START })

    expect(result).toEqual({
      success: false,
      error: 'End date must be after start date.',
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('submits the slice-6 contract (concrete vehicle + locations + insurance, no classId)', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-001' } })
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: { id: 'booking-042' } })),
    )

    const result = await createBooking({ ...VALID, insuranceOptionId: 'ins-001' })

    expect(result).toEqual({ success: true, bookingId: 'booking-042' })
    expect(fetch).toHaveBeenCalledTimes(1)

    const call = vi.mocked(fetch).mock.calls[0]
    const init = call?.[1] as RequestInit | undefined
    const body = JSON.parse((init?.body as string) ?? '{}')

    expect(body.requestedVehicleId).toBe('veh-001')
    expect(body.pickupLocationId).toBe('loc-001')
    expect(body.dropoffLocationId).toBe('loc-001')
    expect(body.insuranceOptionId).toBe('ins-001')
    expect(body.classId).toBeUndefined()
    expect(body.startAt).toBe(START)
    expect(body.endAt).toBe(END)
    expect(body.source).toBe('DIRECT')
    expect(body.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('omits insuranceOptionId when the renter declines coverage', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-001' } })
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: { id: 'booking-043' } })),
    )

    await createBooking({ ...VALID, insuranceOptionId: null })

    const init = vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit | undefined
    const body = JSON.parse((init?.body as string) ?? '{}')
    expect(body).not.toHaveProperty('insuranceOptionId')
  })

  it('maps 409 Conflict to a no-longer-available user message', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-001' } })
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ success: false, error: 'Conflict' }), { status: 409 }),
    )

    const result = await createBooking(VALID)

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toMatch(/no longer available|just booked|choose another/i)
    }
  })

  it('returns generic error for any other failure', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-001' } })
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ success: false, error: 'Boom' }), { status: 500 }),
    )

    const result = await createBooking(VALID)

    expect(result).toEqual({ success: false, error: 'Failed to create booking.' })
  })
})
