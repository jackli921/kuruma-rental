import { unwrap } from '@/lib/api-error'
import { getApiBaseUrl } from '@/vite/api-base'
import { LUGGAGE_SIZES, TRANSMISSIONS, VEHICLE_CLASS_STATUSES } from '@kuruma/shared/enums'
import type {
  CreateVehicleClassInput,
  UpdateVehicleClassInput,
} from '@kuruma/shared/validators/vehicle-class'
import { queryOptions } from '@tanstack/react-query'
import { z } from 'zod'

// #528: operator vehicle-classes management. Self-contained Vite client — it
// never imports the frozen Next module's `modules/classes/api.ts` (process.env
// + bearer-token path). Auth is the session cookie (`credentials: 'include'`),
// so there is no token in browser code.
//
// Reads go through the protected `/vehicle-classes/manage` list, which is
// operator-scoped server-side and honors `includeArchived`. The public
// `GET /vehicle-classes` is ACTIVE-only, cross-operator, and edge-cached — it
// can't power an owner's manage screen.

/**
 * A vehicle class as the operator manage screen needs it (JSON: ISO dates).
 * `OperatorClass` is inferred from this schema (#711), so web's compile-time
 * type and the runtime parse at the seam derive from one source and cannot drift
 * apart. The schema still hand-mirrors the API's DTO, so it can't *prove* the
 * contract — but if the API renames or drops a field it fails as a `ParseError`
 * in {@link fetchOperatorClasses} (a runtime tripwire) instead of surfacing as
 * `undefined` deep in the grid.
 */
export const operatorClassSchema = z.object({
  id: z.string(),
  // The owning operator (DB notNull; the manage list and every mutation return
  // it). Required so an absent operatorId fails as drift here rather than
  // surfacing as `undefined` in the edit-form scoping (#456) — the #711 point.
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

export type OperatorClass = z.infer<typeof operatorClassSchema>

export interface OperatorClassFilters {
  includeArchived?: boolean
}

export async function fetchOperatorClasses(
  filters: OperatorClassFilters = {},
): Promise<OperatorClass[]> {
  // includeArchived=true so the owner sees soft-deleted classes (muted badge)
  // and can tell why a slug is taken.
  const qs = filters.includeArchived ? '?includeArchived=true' : ''
  const res = await fetch(`${getApiBaseUrl()}/vehicle-classes/manage${qs}`, {
    credentials: 'include',
  })
  return unwrap(res, operatorClassSchema.array())
}

export function operatorClassesQueryOptions(filters: OperatorClassFilters = {}) {
  return queryOptions({
    // Key on includeArchived so the active-only and with-archived views never
    // collide on a stale cache entry.
    queryKey: ['operator-classes', filters.includeArchived ?? false],
    queryFn: () => fetchOperatorClasses(filters),
  })
}

async function mutateJson<T>(
  url: string,
  method: 'POST' | 'PATCH',
  body: unknown,
  schema?: z.ZodType<T>,
): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return unwrap(res, schema)
}

export function createOperatorClass(input: CreateVehicleClassInput): Promise<OperatorClass> {
  return mutateJson(`${getApiBaseUrl()}/vehicle-classes`, 'POST', input, operatorClassSchema)
}

export function updateOperatorClass(
  id: string,
  input: UpdateVehicleClassInput,
): Promise<OperatorClass> {
  return mutateJson(`${getApiBaseUrl()}/vehicle-classes/${id}`, 'PATCH', input, operatorClassSchema)
}

// API DELETE performs a soft archive (status -> ARCHIVED). Name reflects the
// semantic, not the HTTP verb. The active-bookings guard is enforced
// server-side (409), so the UI surfaces that error rather than pre-checking.
export async function archiveOperatorClass(id: string): Promise<OperatorClass> {
  const res = await fetch(`${getApiBaseUrl()}/vehicle-classes/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  return unwrap(res, operatorClassSchema)
}
