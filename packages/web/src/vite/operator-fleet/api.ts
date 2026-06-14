import { unwrap } from '@/lib/api-error'
import { getApiBaseUrl } from '@/vite/api-base'
import type {
  BulkVehicleStatus,
  CreateVehicleInput,
  UpdateVehicleInput,
  VehicleStatus,
} from '@kuruma/shared/validators/vehicle'
import { queryOptions } from '@tanstack/react-query'
import {
  type DailyUtilizationDto,
  type FleetBookingSummary,
  type OperatorFleetVehicle,
  type PhotoDeleteResult,
  type PhotoUploadResult,
  type VehicleClassOption,
  type VehicleDetailBookingDto,
  type VehicleDetailResponse,
  type VehicleMaintenanceLogDto,
  operatorFleetListSchema,
  photoDeleteResultSchema,
  photoUploadResultSchema,
  vehicleClassOptionsListSchema,
  vehicleDetailResponseSchema,
} from './schema'

// #526: operator fleet management. The Vite shell owns this read projection (it
// never imports the frozen Next module's `vehicle-api.ts`, which is hono-client +
// Bearer-token) so it stays self-contained and cookie-based like the rest of the
// shell. The list endpoint is operator-scoped server-side via the session cookie
// (CallerContext), so this client passes NO operatorId — a cross-tenant read is
// impossible from here by construction. Canonical write types come from
// @kuruma/shared so the (#526 follow-up) forms stay in lockstep with the Zod
// validators rather than drifting a parallel copy.

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
  VehicleClassOption,
  VehicleDetailBookingDto,
  VehicleDetailResponse,
  VehicleMaintenanceLogDto,
}

export const FLEET_QUERY_KEY = ['operator-fleet'] as const

export async function fetchOperatorFleet(): Promise<OperatorFleetVehicle[]> {
  const res = await fetch(`${getApiBaseUrl()}/vehicles/fleet-overview`, {
    credentials: 'include',
  })
  return unwrap(res, operatorFleetListSchema)
}

export function operatorFleetQueryOptions() {
  return queryOptions({
    queryKey: FLEET_QUERY_KEY,
    queryFn: fetchOperatorFleet,
  })
}

// --- Mutations (cookie-based; consumed by the #526 follow-up slices) ----------
// All write paths are operator-scoped server-side; the client never names a
// tenant. Each unwraps the ok() envelope and throws ApiError on failure so the
// caller's useMutation onError can surface it.
//
// #711 scope note: these write endpoints return the *bare* vehicle row (no
// fleet-overview enrichment — `utilization`, `currentBooking`, …), so the
// `OperatorFleetVehicle` return annotation is wider than the wire body.
// Validating it with `operatorFleetVehicleSchema` would reject every valid
// write, so the writes keep the legacy passthrough; correcting the return type
// (and its consumers) to the base-vehicle shape is a tracked follow-up.

async function writeJson<T>(path: string, method: 'POST' | 'PATCH', body: unknown): Promise<T> {
  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return unwrap<T>(res)
}

export function createVehicle(data: CreateVehicleInput): Promise<OperatorFleetVehicle> {
  return writeJson<OperatorFleetVehicle>('/vehicles', 'POST', data)
}

export function updateVehicle(id: string, data: UpdateVehicleInput): Promise<OperatorFleetVehicle> {
  return writeJson<OperatorFleetVehicle>(`/vehicles/${encodeURIComponent(id)}`, 'PATCH', data)
}

export function updateVehicleStatus(
  id: string,
  status: VehicleStatus,
  reason?: string,
): Promise<OperatorFleetVehicle> {
  const body = reason != null ? { status, reason } : { status }
  return writeJson<OperatorFleetVehicle>(
    `/vehicles/${encodeURIComponent(id)}/status`,
    'PATCH',
    body,
  )
}

export function bulkUpdateVehicleStatus(
  vehicleIds: string[],
  status: BulkVehicleStatus,
): Promise<OperatorFleetVehicle[]> {
  return writeJson<OperatorFleetVehicle[]>('/vehicles/bulk-status', 'PATCH', { vehicleIds, status })
}

export async function retireVehicle(id: string): Promise<OperatorFleetVehicle> {
  const res = await fetch(`${getApiBaseUrl()}/vehicles/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  return unwrap<OperatorFleetVehicle>(res)
}

export async function uploadVehiclePhotos(
  vehicleId: string,
  files: readonly File[],
): Promise<PhotoUploadResult> {
  const formData = new FormData()
  for (const file of files) formData.append('file', file)
  const res = await fetch(`${getApiBaseUrl()}/vehicles/${encodeURIComponent(vehicleId)}/photos`, {
    method: 'POST',
    credentials: 'include',
    body: formData,
  })
  return unwrap(res, photoUploadResultSchema)
}

export async function deleteVehiclePhoto(
  vehicleId: string,
  photoUrl: string,
): Promise<PhotoDeleteResult> {
  const url = `${getApiBaseUrl()}/vehicles/${encodeURIComponent(vehicleId)}/photos?url=${encodeURIComponent(photoUrl)}`
  const res = await fetch(url, { method: 'DELETE', credentials: 'include' })
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
// (#528). Operator-scoped server-side.

export async function fetchVehicleClassOptions(): Promise<VehicleClassOption[]> {
  // `/manage` is the tenant-scoped, session-authed class list (#528). The public
  // `/vehicle-classes` is PUBLIC_CONTEXT 'all'-scope — it would leak every
  // operator's classes into this operator's own form dropdown. Depends on #528
  // (the /manage route) being on trunk first. The schema strips the full class
  // rows down to {id,name} for the dropdown.
  const res = await fetch(`${getApiBaseUrl()}/vehicle-classes/manage`, { credentials: 'include' })
  return unwrap(res, vehicleClassOptionsListSchema)
}

export function vehicleClassOptionsQueryOptions() {
  return queryOptions({
    queryKey: ['operator-fleet', 'class-options'],
    queryFn: fetchVehicleClassOptions,
  })
}
