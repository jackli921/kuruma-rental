import { getApiBaseUrl } from '@/lib/api-client'

export interface CalendarBooking {
  id: string
  vehicleId: string
  renterId: string
  startAt: string
  endAt: string
  effectiveEndAt: string
  status: 'CONFIRMED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED'
  source: 'DIRECT' | 'TRIP_COM' | 'MANUAL' | 'OTHER'
  notes: string | null
}

interface ApiResponse<T> {
  success: boolean
  data: T
  error?: string
}

export async function fetchCalendarBookings(from: string, to: string): Promise<CalendarBooking[]> {
  const base = getApiBaseUrl()
  const params = new URLSearchParams({ from, to })
  const url = `${base}/bookings?${params.toString()}`
  console.log(`[calendar] fetchCalendarBookings url=${url} base=${base}`)
  const res = await fetch(url)
  console.log(`[calendar] fetchCalendarBookings status=${res.status}`)

  if (!res.ok) {
    throw new Error(`Failed to fetch bookings: HTTP ${res.status} url=${url}`)
  }

  const body: ApiResponse<CalendarBooking[]> = await res.json()
  if (!body.success || !Array.isArray(body.data)) {
    throw new Error(body.error ?? 'Invalid bookings response')
  }

  return body.data
}
