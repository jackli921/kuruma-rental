'use server'

import { getApiToken } from '@/lib/api-token'
import { fetchCalendarBookings } from '@/lib/calendar'
import type { CalendarBooking } from '@/lib/calendar'

export async function fetchAllCalendarBookings(
  from: string,
  to: string,
): Promise<CalendarBooking[]> {
  const token = await getApiToken()
  if (!token) throw new Error('Not authenticated')

  return fetchCalendarBookings(from, to, undefined, token)
}
