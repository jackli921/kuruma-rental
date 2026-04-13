import { createApiClient } from '@/lib/api-client'
import type { ApiResponse } from '@kuruma/shared/types/api-response'
import type { CreateVehicleInput, VehicleStatus } from '@kuruma/shared/validators/vehicle'

export interface VehicleData {
  id: string
  name: string
  description: string | null
  photos?: string[]
  seats: number
  transmission: 'AUTO' | 'MANUAL'
  fuelType: string | null
  licensePlate: string | null
  status: 'AVAILABLE' | 'MAINTENANCE' | 'RETIRED'
  bufferMinutes: number
  minRentalHours: number | null
  maxRentalHours: number | null
  advanceBookingHours: number | null
  make: string | null
  model: string | null
  year: number | null
  color: string | null
  dailyRateJpy: number | null
  hourlyRateJpy: number | null
  createdAt: string
  updatedAt: string
}

// Enriched row returned by GET /vehicles/fleet-overview. Dates are ISO
// strings (JSON-serialized from the API) rather than Date objects.
// Mirrors @kuruma/shared/types/fleet.FleetVehicleOverview — if you add
// a field there, add it here too. See issue #52.
export interface FleetBookingSummaryData {
  startAt: string
  endAt: string
  renterName: string | null
}

export interface FleetVehicleOverviewData extends VehicleData {
  utilization: number
  bookingCountLast30Days: number
  currentBooking: FleetBookingSummaryData | null
  nextBooking: FleetBookingSummaryData | null
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

export async function fetchVehicles(status?: string, token?: string): Promise<VehicleData[]> {
  const client = createApiClient(token)
  const res = status
    ? await client.vehicles.$get({ query: { status } })
    : await client.vehicles.$get()
  return unwrap<VehicleData[]>(res)
}

export async function fetchVehicleById(id: string, token?: string): Promise<VehicleData | null> {
  const client = createApiClient(token)
  try {
    const res = await client.vehicles[':id'].$get({ param: { id } })
    return await unwrap<VehicleData>(res)
  } catch (e) {
    if (e instanceof Error && e.message === 'Vehicle not found') return null
    throw e
  }
}

export async function createVehicle(
  data: CreateVehicleInput,
  token?: string,
): Promise<VehicleData> {
  const client = createApiClient(token)
  const res = await client.vehicles.$post({ json: data })
  return unwrap<VehicleData>(res)
}

export async function updateVehicle(
  id: string,
  data: Partial<CreateVehicleInput>,
  token?: string,
): Promise<VehicleData> {
  // Raw fetch for PATCH — hc client used only for typed URL construction.
  const client = createApiClient()
  const url = client.vehicles[':id'].$url({ param: { id } })
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  const res = await fetch(url, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(data),
  })
  return unwrap<VehicleData>(res)
}

// Issue #51: one-shot status mutation for the fleet list inline toggle.
// Kept separate from updateVehicle() so callers don't accidentally ship a
// partial vehicle payload when they only mean to flip a status.
export async function updateVehicleStatus(
  id: string,
  status: VehicleStatus,
  token?: string,
): Promise<VehicleData> {
  // Raw fetch for PATCH — hc client used only for typed URL construction.
  const client = createApiClient()
  const url = client.vehicles[':id'].status.$url({ param: { id } })
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  const res = await fetch(url, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ status }),
  })
  return unwrap<VehicleData>(res)
}

export async function retireVehicle(id: string, token?: string): Promise<VehicleData> {
  const client = createApiClient(token)
  const res = await client.vehicles[':id'].$delete({ param: { id } })
  return unwrap<VehicleData>(res)
}

// Issue #53: enriched detail for /manage/vehicles/[id]. Dates are ISO
// strings. Mirrors @kuruma/shared/types/vehicle-detail.VehicleDetail.
export interface VehicleDetailBookingData {
  id: string
  startAt: string
  endAt: string
  renterName: string | null
  source: 'DIRECT' | 'TRIP_COM' | 'MANUAL' | 'OTHER'
  status: 'CONFIRMED' | 'ACTIVE'
}

export interface DailyUtilizationData {
  date: string
  bookedHours: number
}

export interface VehicleDetailData extends VehicleData {
  upcomingBookings: VehicleDetailBookingData[]
  revenueLast7d: number
  revenueLast30d: number
  revenueAllTime: number
  utilizationLast30Days: DailyUtilizationData[]
}

export async function fetchVehicleDetail(
  id: string,
  token?: string,
): Promise<VehicleDetailData | null> {
  const client = createApiClient(token)
  try {
    const res = await client.vehicles[':id'].detail.$get({ param: { id } })
    return await unwrap<VehicleDetailData>(res)
  } catch (e) {
    if (e instanceof Error && e.message === 'Vehicle not found') return null
    throw e
  }
}

export async function fetchFleetOverview(token?: string): Promise<FleetVehicleOverviewData[]> {
  const client = createApiClient(token)
  const res = await client.vehicles['fleet-overview'].$get()
  return unwrap<FleetVehicleOverviewData[]>(res)
}
