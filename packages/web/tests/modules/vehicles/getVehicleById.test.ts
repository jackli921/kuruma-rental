import { describe, expect, it, vi } from 'vitest'

// Mock the DB module before importing the function under test
vi.mock('@kuruma/shared/db', () => ({
  getDb: vi.fn(),
}))

// Must import after mocking
import { getDb } from '@kuruma/shared/db'
import { getVehicleById } from '@/lib/vehicles'

const MOCK_VEHICLE = {
  id: 'vehicle-001',
  name: 'Toyota Corolla',
  description: 'A reliable sedan for city driving.',
  photos: ['https://example.com/photo1.jpg', 'https://example.com/photo2.jpg'],
  seats: 5,
  transmission: 'AUTO' as const,
  fuelType: 'Gasoline',
  status: 'AVAILABLE' as const,
  bufferMinutes: 60,
  minRentalHours: 4,
  maxRentalHours: 168,
  advanceBookingHours: 24,
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
}

describe('getVehicleById', () => {
  it('returns the vehicle when it exists', async () => {
    const mockWhere = vi.fn().mockResolvedValue([MOCK_VEHICLE])
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere })
    const mockSelect = vi.fn().mockReturnValue({ from: mockFrom })
    vi.mocked(getDb).mockReturnValue({ select: mockSelect } as ReturnType<typeof getDb>)

    const result = await getVehicleById('vehicle-001')

    expect(result).not.toBeNull()
    expect(result?.id).toBe('vehicle-001')
    expect(result?.name).toBe('Toyota Corolla')
    expect(result?.description).toBe('A reliable sedan for city driving.')
    expect(result?.photos).toEqual([
      'https://example.com/photo1.jpg',
      'https://example.com/photo2.jpg',
    ])
    expect(result?.seats).toBe(5)
    expect(result?.transmission).toBe('AUTO')
    expect(result?.fuelType).toBe('Gasoline')
  })

  it('returns null when vehicle does not exist', async () => {
    const mockWhere = vi.fn().mockResolvedValue([])
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere })
    const mockSelect = vi.fn().mockReturnValue({ from: mockFrom })
    vi.mocked(getDb).mockReturnValue({ select: mockSelect } as ReturnType<typeof getDb>)

    const result = await getVehicleById('nonexistent-id')

    expect(result).toBeNull()
  })
})
