import { getApiBaseUrl } from '@/lib/api-client'
import type { ApiResponse } from '@kuruma/shared/types/api-response'

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

export async function fetchCalendarBookings(from: string, to: string): Promise<CalendarBooking[]> {
  const base = getApiBaseUrl()
  const params = new URLSearchParams({ from, to })
  const res = await fetch(`${base}/bookings?${params.toString()}`)

  if (!res.ok) {
    throw new Error(`Failed to fetch bookings: HTTP ${res.status}`)
  }

  const body: ApiResponse<CalendarBooking[]> = await res.json()
  if (!body.success) {
    throw new Error(body.error ?? 'Invalid bookings response')
  }

  return body.data
}
