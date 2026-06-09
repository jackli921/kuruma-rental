import { unwrap } from '@/lib/api-error'
import { getApiBaseUrl } from '@/vite/api-base'
import type { LuggageSize } from '@kuruma/shared/lib/luggage'
import { queryOptions } from '@tanstack/react-query'

// JSON-serialized VehicleClass — dates arrive as ISO strings from the API. The
// Vite shell owns this DTO (rather than importing the frozen Next module's copy)
// so it stays self-contained once `modules/classes` is deleted at cutover.
export interface VehicleClassData {
  id: string
  operatorId?: string
  name: string
  slug: string
  description: string | null
  photos: string[]
  seats: number
  luggageCapacity: number
  luggageSize: LuggageSize
  transmission: 'AUTO' | 'MANUAL'
  fuelType: string | null
  acrissCode: string | null
  sortOrder: number
  status: 'ACTIVE' | 'ARCHIVED'
  createdAt: string
  updatedAt: string
}

// Renter-facing catalog: the public /vehicle-classes endpoint, status-filtered to
// ACTIVE and sorted server-side by sortOrder. No auth — anonymous visitors browse.
export async function fetchActiveClasses(): Promise<VehicleClassData[]> {
  const res = await fetch(`${getApiBaseUrl()}/vehicle-classes?status=ACTIVE`, {
    credentials: 'include',
  })
  return unwrap<VehicleClassData[]>(res)
}

// Public slug lookup. A 404 is "no such class" (returns null so the route renders
// notFound), not an error to surface on the boundary.
export async function fetchClassBySlug(slug: string): Promise<VehicleClassData | null> {
  const res = await fetch(
    `${getApiBaseUrl()}/vehicle-classes/by-slug/${encodeURIComponent(slug)}`,
    {
      credentials: 'include',
    },
  )
  if (res.status === 404) return null
  return unwrap<VehicleClassData>(res)
}

export function activeClassesQueryOptions() {
  return queryOptions({
    queryKey: ['vehicle-classes', 'active'],
    queryFn: fetchActiveClasses,
  })
}

export function classBySlugQueryOptions(slug: string) {
  return queryOptions({
    queryKey: ['vehicle-classes', 'by-slug', slug],
    queryFn: () => fetchClassBySlug(slug),
  })
}
