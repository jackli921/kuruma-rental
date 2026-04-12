import { createApiClient } from '@/lib/api-client'
import type { ApiResponse } from '@kuruma/shared/types/api-response'

export interface Vehicle {
  id: string
  name: string
  description: string | null
  photos?: string[]
  seats: number
  transmission: 'AUTO' | 'MANUAL'
  fuelType: string | null
  status: string
  bufferMinutes: number
  minRentalHours: number | null
  maxRentalHours: number | null
  advanceBookingHours: number | null
  createdAt: string
  updatedAt: string
}

export async function getAvailableVehicles(from?: string, to?: string): Promise<Vehicle[]> {
  const client = createApiClient()

  const res =
    from && to
      ? await client.availability.$get({ query: { from, to } })
      : await client.vehicles.$get({ query: { status: 'AVAILABLE' } })

  const json = (await res.json()) as ApiResponse<Vehicle[]>

  if (!json.success) return []

  return json.data
}

export async function getVehicleById(id: string): Promise<Vehicle | null> {
  const client = createApiClient()
  const res = await client.vehicles[':id'].$get({ param: { id } })
  const json = (await res.json()) as ApiResponse<Vehicle>

  if (!json.success) return null

  return json.data
}
