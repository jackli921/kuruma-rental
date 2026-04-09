import { describe, expect, it, vi } from 'vitest'

vi.mock('@kuruma/shared/db', () => ({
  getDb: vi.fn(),
}))

vi.mock('@/auth', () => ({
  auth: vi.fn(),
}))

import { getDb } from '@kuruma/shared/db'
import { getBookingsByRenterId } from '@/lib/bookings'

const MOCK_JOINED_ROW = {
  bookings: {
    id: 'booking-001',
    vehicleId: 'vehicle-001',
    startAt: new Date('2026-04-10T09:00:00Z'),
    endAt: new Date('2026-04-12T09:00:00Z'),
    status: 'CONFIRMED' as const,
    createdAt: new Date('2026-04-01T00:00:00Z'),
  },
  vehicles: {
    name: 'Toyota Corolla',
    photos: ['https://example.com/photo1.jpg', 'https://example.com/photo2.jpg'],
  },
}

const MOCK_JOINED_ROW_2 = {
  bookings: {
    id: 'booking-002',
    vehicleId: 'vehicle-002',
    startAt: new Date('2026-04-15T10:00:00Z'),
    endAt: new Date('2026-04-17T10:00:00Z'),
    status: 'ACTIVE' as const,
    createdAt: new Date('2026-04-05T00:00:00Z'),
  },
  vehicles: {
    name: 'Honda Fit',
    photos: [],
  },
}

function mockDbJoinChain(rows: unknown[]) {
  const mockOrderBy = vi.fn().mockResolvedValue(rows)
  const mockWhere = vi.fn().mockReturnValue({ orderBy: mockOrderBy })
  const mockInnerJoin = vi.fn().mockReturnValue({ where: mockWhere })
  const mockFrom = vi.fn().mockReturnValue({ innerJoin: mockInnerJoin })
  const mockSelect = vi.fn().mockReturnValue({ from: mockFrom })
  vi.mocked(getDb).mockReturnValue({ select: mockSelect } as ReturnType<typeof getDb>)
  return { mockSelect, mockFrom, mockInnerJoin, mockWhere, mockOrderBy }
}

describe('getBookingsByRenterId', () => {
  it('returns bookings with joined vehicle name and photo', async () => {
    mockDbJoinChain([MOCK_JOINED_ROW, MOCK_JOINED_ROW_2])

    const result = await getBookingsByRenterId('user-001')

    expect(result).toHaveLength(2)

    expect(result[0]?.id).toBe('booking-001')
    expect(result[0]?.vehicleId).toBe('vehicle-001')
    expect(result[0]?.vehicleName).toBe('Toyota Corolla')
    expect(result[0]?.vehiclePhoto).toBe('https://example.com/photo1.jpg')
    expect(result[0]?.startAt).toEqual(new Date('2026-04-10T09:00:00Z'))
    expect(result[0]?.endAt).toEqual(new Date('2026-04-12T09:00:00Z'))
    expect(result[0]?.status).toBe('CONFIRMED')
    expect(result[0]?.createdAt).toEqual(new Date('2026-04-01T00:00:00Z'))

    expect(result[1]?.id).toBe('booking-002')
    expect(result[1]?.vehicleName).toBe('Honda Fit')
    expect(result[1]?.vehiclePhoto).toBeNull()
    expect(result[1]?.status).toBe('ACTIVE')
  })

  it('returns empty array for unknown renter', async () => {
    mockDbJoinChain([])

    const result = await getBookingsByRenterId('nonexistent-user')

    expect(result).toEqual([])
  })
})
