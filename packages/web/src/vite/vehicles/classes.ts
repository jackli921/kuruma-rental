import { unwrap } from '@/lib/api-error'
import { getApiBaseUrl } from '@/vite/api-base'
import { LUGGAGE_SIZES, TRANSMISSIONS, VEHICLE_CLASS_STATUSES } from '@kuruma/shared/enums'
import { queryOptions } from '@tanstack/react-query'
import { z } from 'zod'

// JSON-serialized VehicleClass — dates arrive as ISO strings from the API. The
// Vite shell owns this DTO (rather than importing the frozen Next module's copy)
// so it stays self-contained once `modules/classes` is deleted at cutover.
// Inferred from the schema (#711) so the compile-time type and the runtime parse
// at the seam share one source. Mirrors operator-classes/api.ts — the same
// `toVehicleClass` producer feeds both. Enum domains anchor to the shared
// @kuruma/shared/enums SSoT so they can't drift from the DB pgEnums (#688).
// operatorId is pinned required (DB notNull; all three read endpoints serialize
// it, incl. the public ones), so an absent value fails as drift here rather than
// as `undefined` deep in render.
const vehicleClassSchema = z.object({
  id: z.string(),
  operatorId: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  photos: z.array(z.string()),
  seats: z.number(),
  luggageCapacity: z.number(),
  luggageSize: z.enum(LUGGAGE_SIZES),
  transmission: z.enum(TRANSMISSIONS),
  fuelType: z.string().nullable(),
  acrissCode: z.string().nullable(),
  sortOrder: z.number(),
  status: z.enum(VEHICLE_CLASS_STATUSES),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type VehicleClassData = z.infer<typeof vehicleClassSchema>

// Renter-facing catalog: the public /vehicle-classes endpoint, status-filtered to
// ACTIVE and sorted server-side by sortOrder. No auth — anonymous visitors browse.
export async function fetchActiveClasses(): Promise<VehicleClassData[]> {
  const res = await fetch(`${getApiBaseUrl()}/vehicle-classes?status=ACTIVE`, {
    credentials: 'include',
  })
  return unwrap(res, vehicleClassSchema.array())
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
  return unwrap(res, vehicleClassSchema)
}

// Protected single-class read for the booking confirmation label (#511). Unlike
// the public list/by-slug endpoints, GET /vehicle-classes/:id requires auth — but
// `operatorReadScope` maps a RENTER to the cross-operator `all` scope, so a
// logged-in renter reads any class (the confirmation page is `_renter`-gated, so
// the session cookie rides along via credentials). 404 (archived/unknown) → null,
// so the page simply omits the class row rather than erroring.
export async function fetchClassById(id: string): Promise<VehicleClassData | null> {
  const res = await fetch(`${getApiBaseUrl()}/vehicle-classes/${encodeURIComponent(id)}`, {
    credentials: 'include',
  })
  if (res.status === 404) return null
  return unwrap(res, vehicleClassSchema)
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

export function classByIdQueryOptions(id: string) {
  return queryOptions({
    queryKey: ['vehicle-classes', id],
    queryFn: () => fetchClassById(id),
  })
}
