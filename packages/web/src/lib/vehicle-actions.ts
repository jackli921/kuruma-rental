'use server'

import { auth } from '@/auth'
import { signApiToken } from '@/lib/api-client'
import { fetchFleetOverview } from '@/lib/vehicle-api'
import type { FleetVehicleOverviewData } from '@/lib/vehicle-api'

export async function fetchFleetOverviewAuthenticated(): Promise<FleetVehicleOverviewData[]> {
  const session = await auth()
  const user = session?.user as { id?: string; role?: string } | undefined
  if (!user?.id) throw new Error('Not authenticated')

  const token = await signApiToken({ id: user.id, role: user.role ?? 'RENTER' })
  return fetchFleetOverview({ Authorization: `Bearer ${token}` })
}
