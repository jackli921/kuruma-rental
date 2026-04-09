import { getApiBaseUrl } from './api-client'

export interface DashboardStats {
  totalBookings: number
  activeVehicles: number
  totalCustomers: number
  unreadMessages: number
}

export async function fetchDashboardStats(): Promise<DashboardStats | null> {
  try {
    const res = await fetch(`${getApiBaseUrl()}/stats`)
    if (!res.ok) return null

    const body = await res.json()
    if (!body?.success || !body?.data) return null

    const { totalBookings, activeVehicles, totalCustomers, unreadMessages } = body.data
    if (
      typeof totalBookings !== 'number' ||
      typeof activeVehicles !== 'number' ||
      typeof totalCustomers !== 'number' ||
      typeof unreadMessages !== 'number'
    ) {
      return null
    }

    return { totalBookings, activeVehicles, totalCustomers, unreadMessages }
  } catch {
    return null
  }
}
