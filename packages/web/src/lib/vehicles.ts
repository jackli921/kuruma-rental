import { getApiBaseUrl } from '@/lib/api-client'

interface Vehicle {
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

interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
}

export async function getAvailableVehicles(from?: string, to?: string): Promise<Vehicle[]> {
  const base = getApiBaseUrl()

  const url =
    from && to
      ? `${base}/availability?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
      : `${base}/vehicles?status=AVAILABLE`

  const res = await fetch(url)
  const json: ApiResponse<Vehicle[]> = await res.json()

  if (!json.success || !json.data) return []

  return json.data
}

export async function getVehicleById(id: string): Promise<Vehicle | null> {
  const base = getApiBaseUrl()
  const res = await fetch(`${base}/vehicles/${encodeURIComponent(id)}`)
  const json: ApiResponse<Vehicle> = await res.json()

  if (!json.success || !json.data) return null

  return json.data
}
