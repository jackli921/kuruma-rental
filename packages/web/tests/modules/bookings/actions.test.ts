import { describe, expect, it, vi, beforeEach } from 'vitest'

const mockAuth = vi.fn()
const mockGetDb = vi.fn()
const mockRedirect = vi.fn()

vi.mock('@/auth', () => ({
  auth: () => mockAuth(),
}))

vi.mock('@kuruma/shared/db', () => ({
  getDb: () => mockGetDb(),
}))

vi.mock('@/i18n/routing', () => ({
  redirect: (...args: unknown[]) => mockRedirect(...args),
}))

import { createBooking } from '@/lib/bookings'

describe('createBooking', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it('creates booking and returns success with booking id', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-001' } })

    const mockInsertValues = vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([
        {
          id: 'booking-new',
          renterId: 'user-001',
          vehicleId: 'vehicle-001',
          startAt: new Date('2026-04-15T09:00:00Z'),
          endAt: new Date('2026-04-17T09:00:00Z'),
          status: 'CONFIRMED',
          source: 'DIRECT',
        },
      ]),
    })
    const mockInsert = vi.fn().mockReturnValue({ values: mockInsertValues })

    // Also mock checkAvailability's query (select chain returns no conflicts)
    const mockWhere = vi.fn().mockResolvedValue([])
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere })
    const mockSelect = vi.fn().mockReturnValue({ from: mockFrom })

    mockGetDb.mockReturnValue({
      select: mockSelect,
      insert: mockInsert,
    })

    const result = await createBooking({
      vehicleId: 'vehicle-001',
      startAt: '2026-04-15T09:00:00Z',
      endAt: '2026-04-17T09:00:00Z',
    })

    expect(result).toEqual({
      success: true,
      bookingId: 'booking-new',
    })
  })

  it('returns error when vehicle is not available', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-001' } })

    // Mock checkAvailability's query (select chain returns conflicts)
    const mockWhere = vi.fn().mockResolvedValue([
      {
        id: 'booking-existing',
        vehicleId: 'vehicle-001',
        startAt: new Date('2026-04-14T09:00:00Z'),
        endAt: new Date('2026-04-16T09:00:00Z'),
      },
    ])
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere })
    const mockSelect = vi.fn().mockReturnValue({ from: mockFrom })

    mockGetDb.mockReturnValue({
      select: mockSelect,
    })

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
})
