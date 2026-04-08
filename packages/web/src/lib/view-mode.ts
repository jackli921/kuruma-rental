import { cookies } from 'next/headers'

export type ViewMode = 'renter' | 'business'

const COOKIE_NAME = 'kuruma-view'
const BUSINESS_ROLES = new Set(['STAFF', 'ADMIN'])

export function isBusiness(role: string | undefined): boolean {
  return BUSINESS_ROLES.has(role ?? '')
}

export async function getViewMode(role: string | undefined): Promise<ViewMode> {
  if (!isBusiness(role)) return 'renter'

  const cookieStore = await cookies()
  const value = cookieStore.get(COOKIE_NAME)?.value
  if (value === 'renter') return 'renter'
  return 'business'
}
