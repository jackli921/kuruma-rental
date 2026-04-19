// Issue #311: renters book a class, not a specific vehicle. Owner assigns a
// vehicle at pickup. The server action must submit with `classId` only (no
// `vehicleId`) and rely on the backend to pick the car.

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

import { createClassBooking } from '@/lib/bookings'

const START = '2026-05-01T09:00:00.000Z'
const END = '2026-05-03T09:00:00.000Z'

describe('createClassBooking', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns error when user is not authenticated', async () => {
    mockAuth.mockResolvedValue(null)

    const result = await createClassBooking({
      classId: 'class-001',
      startAt: START,
      endAt: END,
    })

    expect(result).toEqual({
      success: false,
      error: 'You must be logged in to make a booking.',
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('returns error when classId is missing', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-001' } })

    const result = await createClassBooking({
      classId: '',
      startAt: START,
      endAt: END,
    })

    expect(result).toEqual({
      success: false,
      error: 'Vehicle class is required.',
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('returns error when end is not after start', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-001' } })

    const result = await createClassBooking({
      classId: 'class-001',
      startAt: END,
      endAt: START,
    })

    expect(result).toEqual({
      success: false,
      error: 'End date must be after start date.',
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('submits classId (no vehicleId), renterId, source=DIRECT, and an idempotencyKey', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-001' } })
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: { id: 'booking-042' } })),
    )

    const result = await createClassBooking({
      classId: 'class-001',
      startAt: START,
      endAt: END,
    })

    expect(result).toEqual({ success: true, bookingId: 'booking-042' })
    expect(fetch).toHaveBeenCalledTimes(1)

    const call = vi.mocked(fetch).mock.calls[0]
    const init = call?.[1] as RequestInit | undefined
    const body = JSON.parse((init?.body as string) ?? '{}')

    expect(body.classId).toBe('class-001')
    expect(body.vehicleId).toBeUndefined()
    expect(body.renterId).toBe('user-001')
    expect(body.startAt).toBe(START)
    expect(body.endAt).toBe(END)
    expect(body.source).toBe('DIRECT')
    expect(body.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('maps 409 Conflict to a no-availability user message', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-001' } })
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ success: false, error: 'Conflict' }), { status: 409 }),
    )

    const result = await createClassBooking({
      classId: 'class-001',
      startAt: START,
      endAt: END,
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toMatch(/no cars available|not available|choose different dates/i)
    }
  })

  it('returns generic error for any other failure', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-001' } })
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ success: false, error: 'Boom' }), { status: 500 }),
    )

    const result = await createClassBooking({
      classId: 'class-001',
      startAt: START,
      endAt: END,
    })

    expect(result).toEqual({ success: false, error: 'Failed to create booking.' })
  })
})
