import { createApiClient } from '@/lib/api-client'
import type { ApiResponse } from '@kuruma/shared/types/api-response'
import type { LocationOperatingHours } from '@kuruma/shared/types/location'
import type { CreateLocationInput, UpdateLocationInput } from '@kuruma/shared/validators/location'

// JSON-serialized Location — dates come as ISO strings from the API.
export interface LocationData {
  id: string
  operatorId: string
  name: string
  address: string
  operatingHours: LocationOperatingHours
  timezone: string
  defaultTurnaroundMinutes: number
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
  // #435: bypass-scope callers (PLATFORM_ADMIN) must opt into a cross-operator
  // read — GET /locations 400s otherwise. Operator-scoped callers auto-scope
  // and the API ignores this flag for them.
  includeAll?: boolean
}

export async function fetchLocations(
  options: ListOptions = {},
  token?: string,
): Promise<LocationData[]> {
  const client = createApiClient(token)
  const query: Record<string, string> = {}
  if (options.status) query.status = options.status
  if (options.includeArchived) query.includeArchived = 'true'
  if (options.includeAll) query.includeAll = 'true'
  const res = await client.locations.$get(Object.keys(query).length > 0 ? { query } : undefined)
  return unwrap<LocationData[]>(res)
}

export async function createLocation(
  data: CreateLocationInput,
  token?: string,
): Promise<LocationData> {
  const client = createApiClient(token)
  const res = await client.locations.$post({ json: data })
  return unwrap<LocationData>(res)
}

// Raw fetch for PATCH — hc client used only for typed URL construction
// (mirrors updateClass; the location routes parse the body manually).
export async function updateLocation(
  id: string,
  data: UpdateLocationInput,
  token?: string,
): Promise<LocationData> {
  const client = createApiClient()
  const url = client.locations[':id'].$url({ param: { id } })
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  const res = await fetch(url, { method: 'PATCH', headers, body: JSON.stringify(data) })
  return unwrap<LocationData>(res)
}

// API DELETE performs a soft archive (status → ARCHIVED). Name reflects the
// semantic, not the HTTP verb.
export async function archiveLocation(id: string, token?: string): Promise<LocationData> {
  const client = createApiClient(token)
  const res = await client.locations[':id'].$delete({ param: { id } })
  return unwrap<LocationData>(res)
}
