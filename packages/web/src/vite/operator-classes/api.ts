import { unwrap } from '@/lib/api-error'
import { getApiBaseUrl } from '@/vite/api-base'
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
 * The Zod schema is the single source: `OperatorClass` is inferred from it
 * (#711), so the runtime parse at the seam and the compile-time type cannot
 * drift apart, and a renamed/missing API field fails in {@link fetchOperatorClasses}
 * instead of surfacing as `undefined` deep in the grid.
 */
export const operatorClassSchema = z.object({
  id: z.string(),
  // The owning operator. Optional only because legacy fixtures predate it; the
  // API always returns it. Used to scope edit-form options (#456).
  operatorId: z.string().optional(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  photos: z.array(z.string()),
  seats: z.number(),
  luggageCapacity: z.number(),
  luggageSize: z.enum(['SMALL', 'MEDIUM', 'LARGE']).nullable(),
  transmission: z.enum(['AUTO', 'MANUAL']),
  fuelType: z.string().nullable(),
  acrissCode: z.string().nullable(),
  sortOrder: z.number(),
  status: z.enum(['ACTIVE', 'ARCHIVED']),
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
