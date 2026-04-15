import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api-token', () => ({
  getApiToken: vi.fn(),
}))

vi.mock('@/lib/vehicle-api', () => ({
  fetchFleetOverview: vi.fn(),
  createVehicle: vi.fn(),
  updateVehicle: vi.fn(),
  updateVehicleStatus: vi.fn(),
  retireVehicle: vi.fn(),
}))

describe('vehicle-actions', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  describe('fetchFleetOverviewAction', () => {
    it('returns success:false when not authenticated', async () => {
      const { getApiToken } = await import('@/lib/api-token')
      vi.mocked(getApiToken).mockResolvedValueOnce(undefined)

      const { fetchFleetOverviewAction } = await import('@/lib/vehicle-actions')
      const result = await fetchFleetOverviewAction()

      expect(result).toEqual({ success: false, error: 'Authentication required' })
    })

    it('returns success:true with data when API succeeds', async () => {
      const { getApiToken } = await import('@/lib/api-token')
      vi.mocked(getApiToken).mockResolvedValueOnce('mock-token')

      const { fetchFleetOverview } = await import('@/lib/vehicle-api')
      vi.mocked(fetchFleetOverview).mockResolvedValueOnce([{ id: 'v1' }] as never)

      const { fetchFleetOverviewAction } = await import('@/lib/vehicle-actions')
      const result = await fetchFleetOverviewAction()

      expect(result).toEqual({ success: true, data: [{ id: 'v1' }] })
      expect(fetchFleetOverview).toHaveBeenCalledWith('mock-token')
    })

    it('returns success:false with error message when API throws', async () => {
      const { getApiToken } = await import('@/lib/api-token')
      vi.mocked(getApiToken).mockResolvedValueOnce('mock-token')

      const { fetchFleetOverview } = await import('@/lib/vehicle-api')
      vi.mocked(fetchFleetOverview).mockRejectedValueOnce(new Error('Server error'))

      const { fetchFleetOverviewAction } = await import('@/lib/vehicle-actions')
      const result = await fetchFleetOverviewAction()

      expect(result).toEqual({ success: false, error: 'Server error' })
    })
  })

  describe('createVehicleAction', () => {
    it('returns success:false when not authenticated', async () => {
      const { getApiToken } = await import('@/lib/api-token')
      vi.mocked(getApiToken).mockResolvedValueOnce(undefined)

      const { createVehicleAction } = await import('@/lib/vehicle-actions')
      const result = await createVehicleAction({
        name: 'Test',
        seats: 4,
        transmission: 'AUTO',
        bufferMinutes: 60,
      } as never)

      expect(result.success).toBe(false)
    })

    it('forwards token and data to createVehicle', async () => {
      const { getApiToken } = await import('@/lib/api-token')
      vi.mocked(getApiToken).mockResolvedValueOnce('tok')

      const { createVehicle } = await import('@/lib/vehicle-api')
      vi.mocked(createVehicle).mockResolvedValueOnce({ id: 'v1' } as never)

      const { createVehicleAction } = await import('@/lib/vehicle-actions')
      const input = { name: 'Test', seats: 4, transmission: 'AUTO' as const, bufferMinutes: 60 }
      const result = await createVehicleAction(input as never)

      expect(result).toEqual({ success: true, data: { id: 'v1' } })
      expect(createVehicle).toHaveBeenCalledWith(input, 'tok')
    })
  })

  describe('updateVehicleAction', () => {
    it('forwards token, id, and data', async () => {
      const { getApiToken } = await import('@/lib/api-token')
      vi.mocked(getApiToken).mockResolvedValueOnce('tok')

      const { updateVehicle } = await import('@/lib/vehicle-api')
      vi.mocked(updateVehicle).mockResolvedValueOnce({ id: 'v1' } as never)

      const { updateVehicleAction } = await import('@/lib/vehicle-actions')
      const result = await updateVehicleAction('v1', { name: 'New' })

      expect(result).toEqual({ success: true, data: { id: 'v1' } })
      expect(updateVehicle).toHaveBeenCalledWith('v1', { name: 'New' }, 'tok')
    })
  })

  describe('updateVehicleStatusAction', () => {
    it('forwards token, id, and status', async () => {
      const { getApiToken } = await import('@/lib/api-token')
      vi.mocked(getApiToken).mockResolvedValueOnce('tok')

      const { updateVehicleStatus } = await import('@/lib/vehicle-api')
      vi.mocked(updateVehicleStatus).mockResolvedValueOnce({
        id: 'v1',
        status: 'MAINTENANCE',
      } as never)

      const { updateVehicleStatusAction } = await import('@/lib/vehicle-actions')
      const result = await updateVehicleStatusAction('v1', 'MAINTENANCE')

      expect(result).toEqual({ success: true, data: { id: 'v1', status: 'MAINTENANCE' } })
      expect(updateVehicleStatus).toHaveBeenCalledWith('v1', 'MAINTENANCE', undefined, 'tok')
    })
  })

  describe('retireVehicleAction', () => {
    it('forwards token and id', async () => {
      const { getApiToken } = await import('@/lib/api-token')
      vi.mocked(getApiToken).mockResolvedValueOnce('tok')

      const { retireVehicle } = await import('@/lib/vehicle-api')
      vi.mocked(retireVehicle).mockResolvedValueOnce({ id: 'v1', status: 'RETIRED' } as never)

      const { retireVehicleAction } = await import('@/lib/vehicle-actions')
      const result = await retireVehicleAction('v1')

      expect(result).toEqual({ success: true, data: { id: 'v1', status: 'RETIRED' } })
      expect(retireVehicle).toHaveBeenCalledWith('v1', 'tok')
    })
  })
})
