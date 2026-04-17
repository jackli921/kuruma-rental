import { createApiClient } from '@/lib/api-client'
import type { ApiResponse } from '@kuruma/shared/types/api-response'
import type {
  CreateVehicleClassInput,
  UpdateVehicleClassInput,
} from '@kuruma/shared/validators/vehicle-class'

// JSON-serialized VehicleClass — dates come as ISO strings from the API.
export interface VehicleClassData {
  id: string
  name: string
  slug: string
  description: string | null
  photos: string[]
  seats: number
  luggageCapacity: number
  transmission: 'AUTO' | 'MANUAL'
  fuelType: string | null
  dailyRateJpy: number | null
  hourlyRateJpy: number | null
  sortOrder: number
  status: 'ACTIVE' | 'ARCHIVED'
  createdAt: string
  updatedAt: string
}

async function unwrap<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({
    success: false as const,
    error: `Non-JSON response (HTTP ${res.status})`,
  }))) as ApiResponse<T>

  if (!body.success) {
    throw new Error(body.error ?? `HTTP ${res.status}`)
  }

  return body.data
}

interface ListOptions {
  status?: 'ACTIVE' | 'ARCHIVED'
  includeArchived?: boolean
}

export async function fetchClasses(
  options: ListOptions = {},
  token?: string,
): Promise<VehicleClassData[]> {
  const client = createApiClient(token)
  const query: Record<string, string> = {}
  if (options.status) query.status = options.status
  if (options.includeArchived) query.includeArchived = 'true'
  const res = await client['vehicle-classes'].$get(
    Object.keys(query).length > 0 ? { query } : undefined,
  )
  return unwrap<VehicleClassData[]>(res)
}

export async function fetchClassById(id: string, token?: string): Promise<VehicleClassData | null> {
  const client = createApiClient(token)
  try {
    const res = await client['vehicle-classes'][':id'].$get({ param: { id } })
    return await unwrap<VehicleClassData>(res)
  } catch (e) {
    if (e instanceof Error && e.message === 'Vehicle class not found') return null
    throw e
  }
}

export async function createClass(
  data: CreateVehicleClassInput,
  token?: string,
): Promise<VehicleClassData> {
  const client = createApiClient(token)
  const res = await client['vehicle-classes'].$post({ json: data })
  return unwrap<VehicleClassData>(res)
}

export async function updateClass(
  id: string,
  data: UpdateVehicleClassInput,
  token?: string,
): Promise<VehicleClassData> {
  // Raw fetch for PATCH — hc client used only for typed URL construction.
  const client = createApiClient()
  const url = client['vehicle-classes'][':id'].$url({ param: { id } })
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  const res = await fetch(url, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(data),
  })
  return unwrap<VehicleClassData>(res)
}

// API DELETE performs a soft archive (status → ARCHIVED). Name reflects the
// semantic, not the HTTP verb.
export async function archiveClass(id: string, token?: string): Promise<VehicleClassData> {
  const client = createApiClient(token)
  const res = await client['vehicle-classes'][':id'].$delete({ param: { id } })
  return unwrap<VehicleClassData>(res)
}
