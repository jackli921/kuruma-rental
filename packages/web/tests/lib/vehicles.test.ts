import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api-client', () => ({
  getApiBaseUrl: () => 'http://localhost:8787',
}))

import { getAvailableVehicles, getVehicleById } from '@/lib/vehicles'

const MOCK_VEHICLE = {
  id: 'vehicle-001',
  name: 'Toyota Corolla',
  description: 'A reliable sedan',
  seats: 5,
  transmission: 'AUTO' as const,
  fuelType: 'Gasoline',
  status: 'AVAILABLE' as const,
  bufferMinutes: 60,
  minRentalHours: 4,
  maxRentalHours: 168,
  advanceBookingHours: 24,
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
}

const MOCK_VEHICLE_2 = {
  ...MOCK_VEHICLE,
  id: 'vehicle-002',
  name: 'Honda N-BOX',
}

describe('getAvailableVehicles', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('calls GET /vehicles?status=AVAILABLE when no dates provided', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: [MOCK_VEHICLE, MOCK_VEHICLE_2] })),
    )

    const result = await getAvailableVehicles()

    expect(fetch).toHaveBeenCalledTimes(1)
    const calledUrl = vi.mocked(fetch).mock.calls[0]?.[0]?.toString() ?? ''
    expect(calledUrl).toContain('/vehicles')
    expect(calledUrl).not.toContain('/availability')
    expect(result).toHaveLength(2)
    expect(result[0]?.name).toBe('Toyota Corolla')
  })

  it('calls GET /availability?from=...&to=... when dates provided', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: [MOCK_VEHICLE] })),
    )

    const result = await getAvailableVehicles('2026-04-10', '2026-04-12')

    expect(fetch).toHaveBeenCalledTimes(1)
    const calledUrl = vi.mocked(fetch).mock.calls[0]?.[0]?.toString() ?? ''
    expect(calledUrl).toContain('/availability')
    expect(calledUrl).toContain('from=2026-04-10')
    expect(calledUrl).toContain('to=2026-04-12')
    expect(result).toHaveLength(1)
    expect(result[0]?.name).toBe('Toyota Corolla')
  })

  it('returns empty array when API returns no vehicles', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ success: true, data: [] })))

    const result = await getAvailableVehicles()

    expect(result).toEqual([])
  })

  it('returns empty array when API returns error', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ success: false, error: 'Bad request' }), { status: 400 }),
    )

    const result = await getAvailableVehicles()

    expect(result).toEqual([])
  })
})

describe('getVehicleById', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('calls GET /vehicles/:id and returns the vehicle', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: MOCK_VEHICLE })),
    )

    const result = await getVehicleById('vehicle-001')

    expect(fetch).toHaveBeenCalledTimes(1)
    const calledUrl = vi.mocked(fetch).mock.calls[0]?.[0]?.toString() ?? ''
    expect(calledUrl).toContain('/vehicles/vehicle-001')
    expect(result).not.toBeNull()
    expect(result?.id).toBe('vehicle-001')
    expect(result?.name).toBe('Toyota Corolla')
  })

  it('returns null when vehicle not found', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ success: false, error: 'Vehicle not found' }), { status: 404 }),
    )

    const result = await getVehicleById('nonexistent')

    expect(result).toBeNull()
  })
})
