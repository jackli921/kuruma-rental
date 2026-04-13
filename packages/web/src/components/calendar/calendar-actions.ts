'use server'

import { auth } from '@/auth'
import { signApiToken } from '@/lib/api-client'
import { fetchCalendarBookings } from '@/lib/calendar'
import type { CalendarBooking } from '@/lib/calendar'

export async function fetchVehicleCalendarBookings(
  vehicleId: string,
  from: string,
  to: string,
): Promise<CalendarBooking[]> {
  const session = await auth()
  const user = session?.user as { id?: string; role?: string } | undefined
  if (!user?.id) throw new Error('Not authenticated')

  const token = await signApiToken({ id: user.id, role: user.role ?? 'RENTER' })
  return fetchCalendarBookings(from, to, vehicleId, { Authorization: `Bearer ${token}` })
}
