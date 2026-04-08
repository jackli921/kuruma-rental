import { describe, expect, it, vi } from 'vitest'

vi.mock('@kuruma/shared/db', () => ({
  getDb: vi.fn(),
}))

vi.mock('@/auth', () => ({
  auth: vi.fn(),
}))

import { getDb } from '@kuruma/shared/db'
import { checkAvailability, getBookingById } from '@/lib/bookings'

const MOCK_BOOKING = {
  id: 'booking-001',
  renterId: 'user-001',
  vehicleId: 'vehicle-001',
  startAt: new Date('2026-04-10T09:00:00Z'),
  endAt: new Date('2026-04-12T09:00:00Z'),
  status: 'CONFIRMED' as const,
  source: 'DIRECT' as const,
  externalId: null,
  notes: null,
  createdAt: new Date('2026-04-01'),
  updatedAt: new Date('2026-04-01'),
}

function mockDbChain(rows: unknown[]) {
  const mockWhere = vi.fn().mockResolvedValue(rows)
  const mockFrom = vi.fn().mockReturnValue({ where: mockWhere })
  const mockSelect = vi.fn().mockReturnValue({ from: mockFrom })
  vi.mocked(getDb).mockReturnValue({ select: mockSelect } as ReturnType<typeof getDb>)
  return { mockSelect, mockFrom, mockWhere }
}

describe('checkAvailability', () => {
  it('returns true when no conflicting bookings exist', async () => {
    mockDbChain([])

    const result = await checkAvailability(
      'vehicle-001',
      new Date('2026-04-15T09:00:00Z'),
      new Date('2026-04-17T09:00:00Z'),
    )

    expect(result).toBe(true)
  })

  it('returns false when conflicting bookings exist', async () => {
    mockDbChain([MOCK_BOOKING])

    const result = await checkAvailability(
      'vehicle-001',
      new Date('2026-04-10T09:00:00Z'),
      new Date('2026-04-12T09:00:00Z'),
    )

    expect(result).toBe(false)
  })
})

describe('getBookingById', () => {
  it('returns the booking when it exists', async () => {
    mockDbChain([MOCK_BOOKING])

    const result = await getBookingById('booking-001')

    expect(result).not.toBeNull()
    expect(result?.id).toBe('booking-001')
    expect(result?.renterId).toBe('user-001')
    expect(result?.vehicleId).toBe('vehicle-001')
    expect(result?.status).toBe('CONFIRMED')
    expect(result?.source).toBe('DIRECT')
  })

  it('returns null when booking does not exist', async () => {
    mockDbChain([])

    const result = await getBookingById('nonexistent-id')

    expect(result).toBeNull()
  })
})
