import { unwrap } from '@/lib/api-error'
import { getApiBaseUrl } from '@/vite/api-base'
import type { AddOnSnapshot, FeeSnapshotItem, InsuranceSnapshot } from '@kuruma/shared/db/schema'
import { queryOptions } from '@tanstack/react-query'

// JSON-serialized booking (#392/#460) as the renter read model sees it — dates
// are ISO strings (no Date instances). The Vite shell owns this DTO rather than
// importing the frozen Next module's copy so it stays free of that module's
// process.env path. Mirrors the API's `BookingWithOperator` projection
// (services/booking.ts findById): the operator block is attached on a single
// read and carries the renter-safe pre-auth handoff URL (#393 §4h).
export interface BookingDto {
  id: string
  bookingCode: string
  renterId: string
  classId: string | null
  requestedVehicleId: string
  assignedVehicleId: string
  pickupLocationId: string
  dropoffLocationId: string
  startAt: string
  endAt: string
  effectiveEndAt: string
  status: 'CONFIRMED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED'
  source: string
  insuranceOptionId: string | null
  insuranceSnapshot: InsuranceSnapshot | null
  feeSnapshot: FeeSnapshotItem[]
  addOnSnapshot: AddOnSnapshot[]
  totalPrice: number | null
  notes: string | null
  createdAt: string
  updatedAt: string
  operator?: { name: string; preAuthHandoffUrl: string | null }
}

// What the renter selected in the wizard; the server derives operatorId, classId,
// assignedVehicleId, totalPrice + snapshots (none are client fields, proposal §6.2).
export interface CreateBookingInput {
  requestedVehicleId: string
  pickupLocationId: string
  dropoffLocationId: string
  startAt: string
  endAt: string
  /** null = the renter declined coverage or the operator has no active option. */
  insuranceOptionId: string | null
  addOnIds: string[]
  /** Generated once per wizard mount so a double-submit replays, not double-books. */
  idempotencyKey: string
}

// Instant-book (#511): POST /bookings creates a CONFIRMED booking — no online
// payment in the path (pre-auth is handled later via the operator handoff link
// shown on confirmation). Cookie-authenticated + CSRF-gated, so the caller echoes
// the session CSRF token. `unwrap()` throws an ApiError carrying the status, so
// the submit step can branch on 400 (domain) / 403 (doc-verification) / 409
// (vehicle just taken) / 401 (signed out).
export async function createBooking(
  input: CreateBookingInput,
  csrfToken: string,
): Promise<BookingDto> {
  const res = await fetch(`${getApiBaseUrl()}/bookings`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
    body: JSON.stringify({
      requestedVehicleId: input.requestedVehicleId,
      pickupLocationId: input.pickupLocationId,
      dropoffLocationId: input.dropoffLocationId,
      startAt: input.startAt,
      endAt: input.endAt,
      ...(input.insuranceOptionId ? { insuranceOptionId: input.insuranceOptionId } : {}),
      addOnIds: input.addOnIds,
      idempotencyKey: input.idempotencyKey,
    }),
  })
  return unwrap<BookingDto>(res)
}

// Renter-scoped read for the confirmation page. The API's GET /bookings/:id is
// IDOR-sealed (#396) — a booking the caller doesn't own resolves to 404, which we
// map to `null` so the route's loader fires notFound() instead of letting an
// ApiError reach the error boundary (mirrors fetchStorefrontDetail / message-api).
export async function fetchBookingById(id: string): Promise<BookingDto | null> {
  const res = await fetch(`${getApiBaseUrl()}/bookings/${encodeURIComponent(id)}`, {
    credentials: 'include',
  })
  if (res.status === 404) return null
  return unwrap<BookingDto>(res)
}

export function bookingByIdQueryOptions(id: string) {
  return queryOptions({
    queryKey: ['bookings', id],
    queryFn: () => fetchBookingById(id),
  })
}
