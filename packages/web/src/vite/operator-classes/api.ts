import { unwrap } from '@/lib/api-error'
import { getApiBaseUrl } from '@/vite/api-base'
import type {
  CreateVehicleClassInput,
  UpdateVehicleClassInput,
} from '@kuruma/shared/validators/vehicle-class'
import { queryOptions } from '@tanstack/react-query'

// #528: operator vehicle-classes management. Self-contained Vite client — it
// never imports the frozen Next module's `modules/classes/api.ts` (process.env
// + bearer-token path). Auth is the session cookie (`credentials: 'include'`),
// so there is no token in browser code.
//
// Reads go through the protected `/vehicle-classes/manage` list, which is
// operator-scoped server-side and honors `includeArchived`. The public
// `GET /vehicle-classes` is ACTIVE-only, cross-operator, and edge-cached — it
// can't power an owner's manage screen.

/** A vehicle class as the operator manage screen needs it (JSON: ISO dates). */
export interface OperatorClass {
  id: string
  // The owning operator. Optional only because legacy fixtures predate it; the
  // API always returns it. Used to scope edit-form options (#456).
  operatorId?: string
  name: string
  slug: string
  description: string | null
  photos: string[]
  seats: number
  luggageCapacity: number
  luggageSize: 'SMALL' | 'MEDIUM' | 'LARGE' | null
  transmission: 'AUTO' | 'MANUAL'
  fuelType: string | null
  acrissCode: string | null
  sortOrder: number
  status: 'ACTIVE' | 'ARCHIVED'
  createdAt: string
  updatedAt: string
}

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
  return unwrap<OperatorClass[]>(res)
}

export function operatorClassesQueryOptions(filters: OperatorClassFilters = {}) {
  return queryOptions({
    // Key on includeArchived so the active-only and with-archived views never
    // collide on a stale cache entry.
    queryKey: ['operator-classes', filters.includeArchived ?? false],
    queryFn: () => fetchOperatorClasses(filters),
  })
}

async function mutateJson<T>(url: string, method: 'POST' | 'PATCH', body: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return unwrap<T>(res)
}

export function createOperatorClass(input: CreateVehicleClassInput): Promise<OperatorClass> {
  return mutateJson<OperatorClass>(`${getApiBaseUrl()}/vehicle-classes`, 'POST', input)
}

export function updateOperatorClass(
  id: string,
  input: UpdateVehicleClassInput,
): Promise<OperatorClass> {
  return mutateJson<OperatorClass>(`${getApiBaseUrl()}/vehicle-classes/${id}`, 'PATCH', input)
}

// API DELETE performs a soft archive (status -> ARCHIVED). Name reflects the
// semantic, not the HTTP verb. The active-bookings guard is enforced
// server-side (409), so the UI surfaces that error rather than pre-checking.
export async function archiveOperatorClass(id: string): Promise<OperatorClass> {
  const res = await fetch(`${getApiBaseUrl()}/vehicle-classes/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  return unwrap<OperatorClass>(res)
}
