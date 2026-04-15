'use server'

import { getApiToken } from '@/lib/api-token'
import { fetchCalendarBookings } from '@/lib/calendar'
import type { CalendarBooking } from '@/lib/calendar'

export async function fetchVehicleCalendarBookings(
  vehicleId: string,
  from: string,
  to: string,
): Promise<CalendarBooking[]> {
  const token = await getApiToken()
  if (!token) throw new Error('Not authenticated')

  return fetchCalendarBookings(from, to, vehicleId, token)
}
