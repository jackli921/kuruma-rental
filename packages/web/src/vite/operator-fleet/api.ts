import { unwrap } from '@/lib/api-error'
import { getApiBaseUrl } from '@/vite/api-base'
import { buildScopeParam } from '@/vite/operator-context'
import type {
  BulkVehicleStatus,
  CreateVehicleInput,
  UpdateVehicleInput,
  VehicleStatus,
} from '@kuruma/shared/validators/vehicle'
import { queryOptions } from '@tanstack/react-query'
import type { ZodType } from 'zod'
import {
  type DailyUtilizationDto,
  type FleetBookingSummary,
  type OperatorFleetVehicle,
  type PhotoDeleteResult,
  type PhotoUploadResult,
  type PickupLocationOption,
  type VehicleClassOption,
  type VehicleDetailBookingDto,
  type VehicleDetailResponse,
  type VehicleMaintenanceLogDto,
  type VehicleRow,
  operatorFleetListSchema,
  photoDeleteResultSchema,
  photoUploadResultSchema,
  pickupLocationOptionsListSchema,
  vehicleClassOptionsListSchema,
  vehicleDetailResponseSchema,
  vehicleRowListSchema,
  vehicleRowSchema,
} from './schema'

// #526: operator fleet management. The Vite shell owns this read projection (it
// never imports the frozen Next module's `vehicle-api.ts`, which is hono-client +
// Bearer-token) so it stays self-contained and cookie-based like the rest of the
// shell. The list endpoint is operator-scoped server-side via the session cookie
// (CallerContext), so an operator session passes NO operatorId — a cross-tenant
// read is impossible from here by construction. #407 slice 4: a PLATFORM_ADMIN
// on the dashboard picker may narrow this aggregate to one operator by appending
// `?operatorId=X` (sent ONLY when picked; the lenient endpoint ignores no-param =
// aggregate). #1264: the /manage/fleet list is itself a picker route now, so it
// threads the picked operator through here; an operator session still passes none.
// Canonical write types come from @kuruma/shared so the (#526 follow-up) forms
// stay in lockstep with the Zod validators rather than drifting a parallel copy.

export type { BulkVehicleStatus, CreateVehicleInput, UpdateVehicleInput, VehicleStatus }

// #711/#785: the response DTO types now live in ./schema, inferred from the Zod
// schemas that validate each body at the network seam. Re-exported here so
// consumers keep importing them from this client unchanged.
export type {
  DailyUtilizationDto,
  FleetBookingSummary,
  OperatorFleetVehicle,
  PhotoDeleteResult,
  PhotoUploadResult,
  PickupLocationOption,
  VehicleClassOption,
  VehicleDetailBookingDto,
  VehicleDetailResponse,
  VehicleMaintenanceLogDto,
  VehicleRow,
}

export const FLEET_QUERY_KEY = ['operator-fleet'] as const

export async function fetchOperatorFleet(
  pickedOperatorId?: string,
): Promise<OperatorFleetVehicle[]> {
  const qs = pickedOperatorId ? `?operatorId=${encodeURIComponent(pickedOperatorId)}` : ''
  const res = await fetch(`${getApiBaseUrl()}/vehicles/fleet-overview${qs}`, {
    credentials: 'include',
  })
  return unwrap(res, operatorFleetListSchema)
}

export function operatorFleetQueryOptions(pickedOperatorId?: string) {
  return queryOptions({
    // Key on the picked operator so a dashboard context switch never serves
    // another tenant's cached fleet; unpicked (incl. /manage/fleet) shares 'all'.
    queryKey: [...FLEET_QUERY_KEY, pickedOperatorId ?? 'all'],
    queryFn: () => fetchOperatorFleet(pickedOperatorId),
  })
}

// --- Mutations (cookie-based; consumed by the #526 follow-up slices) ----------
// All write paths are operator-scoped server-side; the client never names a
// tenant. Each unwraps the ok() envelope and throws ApiError on failure so the
// caller's useMutation onError can surface it.
//
// #817: these write endpoints return the *bare* vehicle row (shared `Vehicle` =
// `VehicleBase`, with none of the fleet-overview enrichment — `utilization`,
// `currentBooking`, …). Each is therefore typed `VehicleRow` and validated with
// `vehicleRowSchema`; the enriched `operatorFleetVehicleSchema` would reject
// every valid write. The four mutation `onSuccess` handlers ignore the result,
// so narrowing the return type from `OperatorFleetVehicle` is consumer-safe.

// Every fleet write is a cookie-authenticated mutation, so the double-submit CSRF
// guard (api middleware/csrf.ts) requires the session's token echoed in the
// `X-CSRF-Token` header — omitting it 403s "CSRF token mismatch". Callers read the
// token from `useSession().data?.csrfToken` (mirrors operator-fees/locations, #1304).
async function writeJson<T>(
  path: string,
  method: 'POST' | 'PATCH',
  body: unknown,
  csrfToken: string,
  schema: ZodType<T>,
): Promise<T> {
  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
    body: JSON.stringify(body),
  })
  return unwrap(res, schema)
}

export function createVehicle(data: CreateVehicleInput, csrfToken: string): Promise<VehicleRow> {
  return writeJson('/vehicles', 'POST', data, csrfToken, vehicleRowSchema)
}

export function updateVehicle(
  id: string,
  data: UpdateVehicleInput,
  csrfToken: string,
): Promise<VehicleRow> {
  return writeJson(
    `/vehicles/${encodeURIComponent(id)}`,
    'PATCH',
    data,
    csrfToken,
    vehicleRowSchema,
  )
}

export function updateVehicleStatus(
  id: string,
  status: VehicleStatus,
  csrfToken: string,
  reason?: string,
): Promise<VehicleRow> {
  const body = reason != null ? { status, reason } : { status }
  return writeJson(
    `/vehicles/${encodeURIComponent(id)}/status`,
    'PATCH',
    body,
    csrfToken,
    vehicleRowSchema,
  )
}

export function bulkUpdateVehicleStatus(
  vehicleIds: string[],
  status: BulkVehicleStatus,
  csrfToken: string,
): Promise<VehicleRow[]> {
  return writeJson(
    '/vehicles/bulk-status',
    'PATCH',
    { vehicleIds, status },
    csrfToken,
    vehicleRowListSchema,
  )
}

export async function retireVehicle(id: string, csrfToken: string): Promise<VehicleRow> {
  const res = await fetch(`${getApiBaseUrl()}/vehicles/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: { 'X-CSRF-Token': csrfToken },
  })
  return unwrap(res, vehicleRowSchema)
}

export async function uploadVehiclePhotos(
  vehicleId: string,
  files: readonly File[],
  csrfToken: string,
): Promise<PhotoUploadResult> {
  const formData = new FormData()
  for (const file of files) formData.append('file', file)
  const res = await fetch(`${getApiBaseUrl()}/vehicles/${encodeURIComponent(vehicleId)}/photos`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'X-CSRF-Token': csrfToken },
    body: formData,
  })
  return unwrap(res, photoUploadResultSchema)
}

export async function deleteVehiclePhoto(
  vehicleId: string,
  photoUrl: string,
  csrfToken: string,
): Promise<PhotoDeleteResult> {
  const url = `${getApiBaseUrl()}/vehicles/${encodeURIComponent(vehicleId)}/photos?url=${encodeURIComponent(photoUrl)}`
  const res = await fetch(url, {
    method: 'DELETE',
    credentials: 'include',
    headers: { 'X-CSRF-Token': csrfToken },
  })
  return unwrap(res, photoDeleteResultSchema)
}

// --- Vehicle detail (#527) -----------------------------------------------------
// The single-vehicle drill-down read. Mirrors @kuruma/shared VehicleDetail
// (which extends VehicleBase) with every date as an ISO string (JSON transport).
// The catalog fields are a superset of what the edit form needs, so the detail
// page hands EditVehicleSheet a row via `vehicleRowFromDetail` with no second
// fetch. The endpoint is tenant-sealed server-side (#527): a foreign or missing
// vehicle 404s, mapped to null so the route loader can fire notFound().

export async function fetchVehicleDetail(id: string): Promise<VehicleDetailResponse | null> {
  const res = await fetch(`${getApiBaseUrl()}/vehicles/${encodeURIComponent(id)}/detail`, {
    credentials: 'include',
  })
  if (res.status === 404) return null
  return unwrap(res, vehicleDetailResponseSchema)
}

export function vehicleDetailQueryOptions(id: string) {
  return queryOptions({
    queryKey: ['operator-fleet', 'detail', id],
    queryFn: () => fetchVehicleDetail(id),
  })
}

/**
 * Adapt the detail DTO to an `OperatorFleetVehicle` so the detail page can reuse
 * `EditVehicleSheet` without a second fetch. The five fleet-overview-only fields
 * (`utilization`, `bookingCountLast30Days`, `currentBooking`, `nextBooking`,
 * `activeMaintenanceReason`) are absent from the detail DTO; the edit form never
 * reads them, so they are stubbed with neutral values. A lossy, write-path-only
 * adapter — never feed the result back into a fleet list.
 */
export function vehicleRowFromDetail(d: VehicleDetailResponse): OperatorFleetVehicle {
  return {
    id: d.id,
    operatorId: d.operatorId,
    classId: d.classId,
    pickupLocationId: d.pickupLocationId,
    name: d.name,
    description: d.description,
    photos: d.photos,
    seats: d.seats,
    luggageCapacity: d.luggageCapacity,
    luggageSize: d.luggageSize,
    transmission: d.transmission,
    fuelType: d.fuelType,
    licensePlate: d.licensePlate,
    status: d.status,
    minRentalHours: d.minRentalHours,
    maxRentalHours: d.maxRentalHours,
    advanceBookingHours: d.advanceBookingHours,
    make: d.make,
    model: d.model,
    year: d.year,
    color: d.color,
    dailyRateJpy: d.dailyRateJpy,
    hourlyRateJpy: d.hourlyRateJpy,
    shakenExpiryDate: d.shakenExpiryDate,
    insuranceExpiryDate: d.insuranceExpiryDate,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    utilization: 0,
    bookingCountLast30Days: 0,
    currentBooking: null,
    nextBooking: null,
    activeMaintenanceReason: null,
  }
}

// Minimal class list for the Add/Edit form's class dropdown — kept here so the
// form slice (#526 follow-up) reads it without touching the classes feature
// (#528). Operator callers stay tenant-scoped server-side; a bypass admin must
// explicitly opt into the cross-operator read.

export async function fetchVehicleClassOptions(operatorId?: string): Promise<VehicleClassOption[]> {
  // `/manage` is the session-authed class list (#528). buildScopeParam sends
  // `operatorId=X` when a bypass admin picked one (#1264 — matches the vehicle's
  // operator so the composite FK holds), else `includeAll=true` (the bypass-role
  // cross-operator read contract; OPERATOR_* callers stay scoped by the API).
  const res = await fetch(
    `${getApiBaseUrl()}/vehicle-classes/manage?${buildScopeParam(operatorId)}`,
    {
      credentials: 'include',
    },
  )
  return unwrap(res, vehicleClassOptionsListSchema)
}

export function vehicleClassOptionsQueryOptions(operatorId?: string) {
  return queryOptions({
    queryKey: ['operator-fleet', 'class-options', operatorId ?? 'all'],
    queryFn: () => fetchVehicleClassOptions(operatorId),
  })
}

// Minimal pickup-location list for the Add/Edit form's location dropdown (#1262).
// Kept fleet-local (a direct fetch, not an `operator-locations` import) to stay
// inside the web module boundary — mirrors fetchVehicleClassOptions above. The
// session-authed `/locations` list is operator-scoped server-side; a UI-created
// vehicle needs a pickupLocationId or it never surfaces in storefront search.
export async function fetchPickupLocationOptions(
  operatorId?: string,
): Promise<PickupLocationOption[]> {
  // `includeArchived=true` keeps a since-archived assigned location resolvable for
  // the edit fallback. buildScopeParam narrows to the picked operator (#1264) or
  // opts into the cross-operator read for a bypass admin; OPERATOR_* stay scoped.
  const res = await fetch(
    `${getApiBaseUrl()}/locations?includeArchived=true&${buildScopeParam(operatorId)}`,
    { credentials: 'include' },
  )
  return unwrap(res, pickupLocationOptionsListSchema)
}

export function pickupLocationOptionsQueryOptions(operatorId?: string) {
  return queryOptions({
    queryKey: ['operator-fleet', 'location-options', operatorId ?? 'all'],
    queryFn: () => fetchPickupLocationOptions(operatorId),
  })
}
