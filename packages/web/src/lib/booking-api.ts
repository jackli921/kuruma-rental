import { getApiBaseUrl } from '@/lib/api-client'

interface ApiResponse<T> {
  success: boolean
  data: T
  error?: string
}

export interface BookingData {
  id: string
  renterId: string
  vehicleId: string
  startAt: string
  endAt: string
  effectiveEndAt: string
  status: 'CONFIRMED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED'
  source: 'DIRECT' | 'TRIP_COM' | 'MANUAL' | 'OTHER'
  externalId: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
}

interface BookingFilters {
  from?: string
  to?: string
  status?: string
  vehicleId?: string
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

export async function fetchBookings(filters?: BookingFilters): Promise<BookingData[]> {
  const base = getApiBaseUrl()
  const params = new URLSearchParams()

  if (filters?.from) params.set('from', filters.from)
  if (filters?.to) params.set('to', filters.to)
  if (filters?.status) params.set('status', filters.status)
  if (filters?.vehicleId) params.set('vehicleId', filters.vehicleId)

  const qs = params.toString()
  return apiRequest<BookingData[]>(`${base}/bookings${qs ? `?${qs}` : ''}`)
}
