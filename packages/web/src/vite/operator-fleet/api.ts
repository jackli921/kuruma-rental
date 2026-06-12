import { unwrap } from '@/lib/api-error'
import { getApiBaseUrl } from '@/vite/api-base'
import type { LuggageSize } from '@kuruma/shared/lib/luggage'
import type {
  BulkVehicleStatus,
  CreateVehicleInput,
  UpdateVehicleInput,
  VehicleStatus,
} from '@kuruma/shared/validators/vehicle'
import { queryOptions } from '@tanstack/react-query'

// #526: operator fleet management. The Vite shell owns this read projection (it
// never imports the frozen Next module's `vehicle-api.ts`, which is hono-client +
// Bearer-token) so it stays self-contained and cookie-based like the rest of the
// shell. The list endpoint is operator-scoped server-side via the session cookie
// (CallerContext), so this client passes NO operatorId — a cross-tenant read is
// impossible from here by construction. Canonical write types come from
// @kuruma/shared so the (#526 follow-up) forms stay in lockstep with the Zod
// validators rather than drifting a parallel copy.

export type { BulkVehicleStatus, CreateVehicleInput, UpdateVehicleInput, VehicleStatus }

/** A booking touching a fleet vehicle, as the overview needs it. ISO strings. */
export interface FleetBookingSummary {
  startAt: string
  endAt: string
  renterName: string | null
}

/**
 * One fleet row from `GET /vehicles/fleet-overview`. Mirrors
 * `@kuruma/shared/types/fleet.FleetVehicleOverview` with dates as ISO strings
 * (JSON-serialized). If a field is added there, add it here too.
 */
export interface OperatorFleetVehicle {
  id: string
  operatorId: string
  classId: string | null
  pickupLocationId: string | null
  name: string
  description: string | null
  photos: string[]
  seats: number
  luggageCapacity: number | null
  luggageSize: LuggageSize | null
  transmission: 'AUTO' | 'MANUAL'
  fuelType: string | null
  licensePlate: string | null
  status: VehicleStatus
  minRentalHours: number | null
  maxRentalHours: number | null
  advanceBookingHours: number | null
  make: string | null
  model: string | null
  year: number | null
  color: string | null
  dailyRateJpy: number | null
  hourlyRateJpy: number | null
  shakenExpiryDate: string | null
  insuranceExpiryDate: string | null
  createdAt: string
  updatedAt: string
  utilization: number
  bookingCountLast30Days: number
  currentBooking: FleetBookingSummary | null
  nextBooking: FleetBookingSummary | null
  activeMaintenanceReason: string | null
}

export const FLEET_QUERY_KEY = ['operator-fleet'] as const

export async function fetchOperatorFleet(): Promise<OperatorFleetVehicle[]> {
  const res = await fetch(`${getApiBaseUrl()}/vehicles/fleet-overview`, {
    credentials: 'include',
  })
  return unwrap<OperatorFleetVehicle[]>(res)
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

export interface PhotoUploadResult {
  uploaded: string[]
  total: number
}

export interface PhotoDeleteResult {
  deleted: string
  remaining: number
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
  return unwrap<PhotoUploadResult>(res)
}

export async function deleteVehiclePhoto(
  vehicleId: string,
  photoUrl: string,
): Promise<PhotoDeleteResult> {
  const url = `${getApiBaseUrl()}/vehicles/${encodeURIComponent(vehicleId)}/photos?url=${encodeURIComponent(photoUrl)}`
  const res = await fetch(url, { method: 'DELETE', credentials: 'include' })
  return unwrap<PhotoDeleteResult>(res)
}

// Minimal class list for the Add/Edit form's class dropdown — kept here so the
// form slice (#526 follow-up) reads it without touching the classes feature
// (#528). Operator-scoped server-side.
export interface VehicleClassOption {
  id: string
  name: string
}

export async function fetchVehicleClassOptions(): Promise<VehicleClassOption[]> {
  const res = await fetch(`${getApiBaseUrl()}/vehicle-classes`, { credentials: 'include' })
  const data = await unwrap<Array<{ id: string; name: string }>>(res)
  return data.map((c) => ({ id: c.id, name: c.name }))
}

export function vehicleClassOptionsQueryOptions() {
  return queryOptions({
    queryKey: ['operator-fleet', 'class-options'],
    queryFn: fetchVehicleClassOptions,
  })
}
