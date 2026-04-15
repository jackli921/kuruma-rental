import { beforeEach, describe, expect, it, vi } from 'vitest'

const API_BASE = 'http://localhost:8787'

// Mock createApiClient before importing the module under test
vi.mock('@/lib/api-client', () => ({
  createApiClient: (_token?: string) => {
    const { hc } = require('hono/client')
    return hc('http://localhost:8787')
  },
}))

const mockVehicle = {
  id: 'v1',
  name: 'Toyota Corolla',
  description: null,
  photos: [],
  seats: 5,
  transmission: 'AUTO',
  fuelType: null,
  licensePlate: null,
  status: 'AVAILABLE',
  bufferMinutes: 60,
  minRentalHours: null,
  maxRentalHours: null,
  advanceBookingHours: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

describe('vehicle-api', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
  })

  describe('fetchVehicles', () => {
    it('fetches vehicles from GET /vehicles and unwraps response', async () => {
      const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, data: [mockVehicle] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )

      const { fetchVehicles } = await import('@/lib/vehicle-api')
      const result = await fetchVehicles()

      const calledUrl = spy.mock.calls[0]?.[0]?.toString() ?? ''
      expect(calledUrl).toBe(`${API_BASE}/vehicles`)
      expect(result).toEqual([mockVehicle])
    })

    it('passes status filter as query param', async () => {
      const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, data: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )

      const { fetchVehicles } = await import('@/lib/vehicle-api')
      await fetchVehicles('RETIRED')

      const calledUrl = spy.mock.calls[0]?.[0]?.toString() ?? ''
      expect(calledUrl).toBe(`${API_BASE}/vehicles?status=RETIRED`)
    })

    it('throws on API error response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ success: false, error: 'Server error' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }),
      )

      const { fetchVehicles } = await import('@/lib/vehicle-api')
      await expect(fetchVehicles()).rejects.toThrow()
    })
  })

  describe('fetchVehicleById', () => {
    it('fetches a single vehicle by id', async () => {
      const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, data: mockVehicle }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )

      const { fetchVehicleById } = await import('@/lib/vehicle-api')
      const result = await fetchVehicleById('v1')

      const calledUrl = spy.mock.calls[0]?.[0]?.toString() ?? ''
      expect(calledUrl).toBe(`${API_BASE}/vehicles/v1`)
      expect(result).toEqual(mockVehicle)
    })

    it('returns null for 404', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ success: false, error: 'Vehicle not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }),
      )

      const { fetchVehicleById } = await import('@/lib/vehicle-api')
      const result = await fetchVehicleById('nonexistent')

      expect(result).toBeNull()
    })
  })

  describe('createVehicle', () => {
    it('sends POST /vehicles with body and returns created vehicle', async () => {
      const input = {
        name: 'Honda Fit',
        seats: 5,
        transmission: 'AUTO' as const,
        bufferMinutes: 60,
      }
      const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, data: { ...mockVehicle, ...input } }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        }),
      )

      const { createVehicle } = await import('@/lib/vehicle-api')
      const result = await createVehicle(input)

      const calledUrl = spy.mock.calls[0]?.[0]?.toString() ?? ''
      expect(calledUrl).toBe(`${API_BASE}/vehicles`)
      const init = spy.mock.calls[0]?.[1] as RequestInit
      expect(init.method).toBe('POST')
      expect(JSON.parse(init.body as string)).toEqual(input)
      expect(result.name).toBe('Honda Fit')
    })
  })

  describe('updateVehicle', () => {
    it('sends PATCH /vehicles/:id with body and returns updated vehicle', async () => {
      const updates = { name: 'Updated Corolla' }
      const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, data: { ...mockVehicle, ...updates } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )

      const { updateVehicle } = await import('@/lib/vehicle-api')
      const result = await updateVehicle('v1', updates)

      const calledUrl = spy.mock.calls[0]?.[0]?.toString() ?? ''
      expect(calledUrl).toBe(`${API_BASE}/vehicles/v1`)
      const init = spy.mock.calls[0]?.[1] as RequestInit
      expect(init.method).toBe('PATCH')
      expect(JSON.parse(init.body as string)).toEqual(updates)
      expect(result.name).toBe('Updated Corolla')
    })

    it('passes Authorization header in raw fetch when token is provided', async () => {
      const updates = { name: 'Updated Corolla' }
      const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, data: { ...mockVehicle, ...updates } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )

      const { updateVehicle } = await import('@/lib/vehicle-api')
      await updateVehicle('v1', updates, 'test-jwt-token')

      const init = spy.mock.calls[0]?.[1] as RequestInit
      const headers = init.headers as Record<string, string>
      expect(headers.Authorization).toBe('Bearer test-jwt-token')
      expect(headers['Content-Type']).toBe('application/json')
    })
  })

  describe('updateVehicleStatus (issue #51)', () => {
    it('sends PATCH /vehicles/:id/status with { status } and returns updated vehicle', async () => {
      const spy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ success: true, data: { ...mockVehicle, status: 'MAINTENANCE' } }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        )

      const { updateVehicleStatus } = await import('@/lib/vehicle-api')
      const result = await updateVehicleStatus('v1', 'MAINTENANCE')

      const calledUrl = spy.mock.calls[0]?.[0]?.toString() ?? ''
      expect(calledUrl).toBe(`${API_BASE}/vehicles/v1/status`)
      const init = spy.mock.calls[0]?.[1] as RequestInit
      expect(init.method).toBe('PATCH')
      expect(JSON.parse(init.body as string)).toEqual({ status: 'MAINTENANCE' })
      expect(result.status).toBe('MAINTENANCE')
    })

    it('passes Authorization header in raw fetch when token is provided', async () => {
      const spy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ success: true, data: { ...mockVehicle, status: 'MAINTENANCE' } }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        )

      const { updateVehicleStatus } = await import('@/lib/vehicle-api')
      await updateVehicleStatus('v1', 'MAINTENANCE', 'test-jwt-token')

      const init = spy.mock.calls[0]?.[1] as RequestInit
      const headers = init.headers as Record<string, string>
      expect(headers.Authorization).toBe('Bearer test-jwt-token')
      expect(headers['Content-Type']).toBe('application/json')
    })

    it('surfaces server errors as thrown Error', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ success: false, error: 'Vehicle not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }),
      )

      const { updateVehicleStatus } = await import('@/lib/vehicle-api')
      await expect(updateVehicleStatus('nope', 'AVAILABLE')).rejects.toThrow('Vehicle not found')
    })
  })

  describe('retireVehicle', () => {
    it('sends DELETE /vehicles/:id and returns retired vehicle', async () => {
      const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, data: { ...mockVehicle, status: 'RETIRED' } }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      )

      const { retireVehicle } = await import('@/lib/vehicle-api')
      const result = await retireVehicle('v1')

      const calledUrl = spy.mock.calls[0]?.[0]?.toString() ?? ''
      expect(calledUrl).toBe(`${API_BASE}/vehicles/v1`)
      const init = spy.mock.calls[0]?.[1] as RequestInit
      expect(init.method).toBe('DELETE')
      expect(result.status).toBe('RETIRED')
    })
  })
})
