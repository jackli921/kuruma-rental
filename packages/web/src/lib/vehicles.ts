import { createApiClient } from '@/lib/api-client'
import type { VehicleData } from '@/lib/vehicle-api'
import type { ApiResponse } from '@kuruma/shared/types/api-response'

type Vehicle = VehicleData

export async function getAvailableVehicles(
  from?: string,
  to?: string,
  token?: string,
): Promise<Vehicle[]> {
  const client = createApiClient(token)

  const res =
    from && to
      ? await client.availability.$get({ query: { from, to } })
      : await client.vehicles.$get({ query: { status: 'AVAILABLE' } })

  const json = (await res.json()) as ApiResponse<Vehicle[]>

  if (!json.success) return []

  return json.data
}

export async function getVehicleById(id: string, token?: string): Promise<Vehicle | null> {
  const client = createApiClient(token)
  const res = await client.vehicles[':id'].$get({ param: { id } })
  const json = (await res.json()) as ApiResponse<Vehicle>

  if (!json.success) return null

  return json.data
}
