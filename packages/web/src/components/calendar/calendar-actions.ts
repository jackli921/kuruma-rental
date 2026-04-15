'use server'

import { createApiClient } from '@/lib/api-client'
import { getApiToken } from '@/lib/api-token'
import { fetchCalendarBookings } from '@/lib/calendar'
import type { CalendarBooking } from '@/lib/calendar'
import type { ApiResponse } from '@kuruma/shared/types/api-response'

export async function fetchVehicleCalendarBookings(
  vehicleId: string,
  from: string,
  to: string,
): Promise<CalendarBooking[]> {
  const token = await getApiToken()
  if (!token) throw new Error('Not authenticated')

  return fetchCalendarBookings(from, to, vehicleId, token)
}

export type ActionResult = { success: true } | { success: false; error: string }

export async function updateBookingStatus(
  bookingId: string,
  status: 'ACTIVE' | 'COMPLETED',
): Promise<ActionResult> {
  const token = await getApiToken()
  if (!token) return { success: false, error: 'Authentication required' }

  const client = createApiClient()
  const url = client.bookings[':id'].status.$url({ param: { id: bookingId } })
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ status }),
  })

  const body = (await res.json()) as ApiResponse<unknown>
  if (!body.success) {
    return { success: false, error: body.error ?? 'Failed to update booking status' }
  }
  return { success: true }
}

export async function cancelBooking(bookingId: string): Promise<ActionResult> {
  const token = await getApiToken()
  if (!token) return { success: false, error: 'Authentication required' }

  const client = createApiClient(token)
  const res = await client.bookings[':id'].cancel.$post({
    param: { id: bookingId },
  })

  const body = (await res.json()) as ApiResponse<unknown>
  if (!body.success) {
    return { success: false, error: body.error ?? 'Failed to cancel booking' }
  }
  return { success: true }
}
