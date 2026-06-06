import { createApiClient } from '@/lib/api-client'
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
  totalPrice: number | null
  renterName?: string | null
  renterEmail?: string | null
  renterLanguage?: string | null
}

interface BookingWithRenter {
  id: string
  // #392: the API returns the fulfilling car as `assignedVehicleId` (the legacy
  // `vehicleId` column is gone). The calendar binds events to vehicle columns by
  // this id.
  assignedVehicleId: string
  renterId: string
  startAt: string
  endAt: string
  effectiveEndAt: string
  status: CalendarBooking['status']
  source: CalendarBooking['source']
  notes: string | null
  totalPrice: number | null
  renter?: { id: string; name: string | null; email: string; language: string }
}

export async function fetchCalendarBookings(
  from: string,
  to: string,
  vehicleId?: string,
  token?: string,
): Promise<CalendarBooking[]> {
  const client = createApiClient(token)
  const query: Record<string, string> = { from, to, expand: 'renter' }
  if (vehicleId) query.vehicleId = vehicleId
  const res = await client.bookings.$get({ query })

  if (!res.ok) {
    throw new Error(`Failed to fetch bookings: HTTP ${res.status}`)
  }

  const body = (await res.json()) as ApiResponse<BookingWithRenter[]>
  if (!body.success) {
    throw new Error(body.error ?? 'Invalid bookings response')
  }

  return body.data.map((b) => ({
    id: b.id,
    vehicleId: b.assignedVehicleId,
    renterId: b.renterId,
    startAt: b.startAt,
    endAt: b.endAt,
    effectiveEndAt: b.effectiveEndAt,
    status: b.status,
    source: b.source,
    notes: b.notes,
    totalPrice: b.totalPrice,
    renterName: b.renter?.name ?? null,
    renterEmail: b.renter?.email ?? null,
    renterLanguage: b.renter?.language ?? null,
  }))
}
