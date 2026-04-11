import { getApiBaseUrl } from '@/lib/api-client'
import type { CreateVehicleInput } from '@kuruma/shared/validators/vehicle'

interface ApiResponse<T> {
  success: boolean
  data: T
  error?: string
}

export interface VehicleData {
  id: string
  name: string
  description: string | null
  photos?: string[]
  seats: number
  transmission: 'AUTO' | 'MANUAL'
  fuelType: string | null
  status: 'AVAILABLE' | 'MAINTENANCE' | 'RETIRED'
  bufferMinutes: number
  minRentalHours: number | null
  maxRentalHours: number | null
  advanceBookingHours: number | null
  dailyRateJpy: number | null
  hourlyRateJpy: number | null
  createdAt: string
  updatedAt: string
}

async function apiRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: 'Unknown error' }))
    throw new Error((body as ApiResponse<never>).error ?? `HTTP ${res.status}`)
  }

  const body: ApiResponse<T> = await res.json()
  return body.data
}

export async function fetchVehicles(status?: string): Promise<VehicleData[]> {
  const base = getApiBaseUrl()
  const params = status ? `?status=${status}` : ''
  return apiRequest<VehicleData[]>(`${base}/vehicles${params}`)
}

export async function fetchVehicleById(id: string): Promise<VehicleData | null> {
  const base = getApiBaseUrl()
  try {
    return await apiRequest<VehicleData>(`${base}/vehicles/${id}`)
  } catch (e) {
    if (e instanceof Error && e.message === 'Vehicle not found') return null
    throw e
  }
}

export async function createVehicle(data: CreateVehicleInput): Promise<VehicleData> {
  const base = getApiBaseUrl()
  return apiRequest<VehicleData>(`${base}/vehicles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
}

export async function updateVehicle(
  id: string,
  data: Partial<CreateVehicleInput>,
): Promise<VehicleData> {
  const base = getApiBaseUrl()
  return apiRequest<VehicleData>(`${base}/vehicles/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
}

export async function retireVehicle(id: string): Promise<VehicleData> {
  const base = getApiBaseUrl()
  return apiRequest<VehicleData>(`${base}/vehicles/${id}`, { method: 'DELETE' })
}
