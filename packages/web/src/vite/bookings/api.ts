import { unwrap } from '@/lib/api-error'
import { getApiBaseUrl } from '@/vite/api-base'
import type { AddOnSnapshot, FeeSnapshotItem, InsuranceSnapshot } from '@kuruma/shared/db/schema'
import { BOOKING_STATUSES, type BookingStatus, FEE_TYPES, FEE_UNITS } from '@kuruma/shared/enums'
import { queryOptions } from '@tanstack/react-query'
import { z } from 'zod'

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
  status: BookingStatus
  source: string
  insuranceOptionId: string | null
  insuranceSnapshot: InsuranceSnapshot | null
  feeSnapshot: FeeSnapshotItem[]
  addOnSnapshot: AddOnSnapshot[]
  totalPrice: number | null
  notes: string | null
  createdAt: string
  updatedAt: string
  operator?: { name: string; preAuthHandoffUrl: string | null } | undefined
}

// #711: response schemas pin the runtime parse to the DTOs above via `satisfies
// z.ZodType<...>` — the interfaces stay the single source for the shape, while a
// drifted/dropped field now fails as a ParseError at the seam instead of
// surfacing as `undefined` on the confirmation page or in My Bookings.
const insuranceSnapshotSchema = z.object({
  insuranceOptionId: z.string(),
  name: z.string(),
  dailyPriceJpy: z.number(),
  deductibleJpy: z.number().nullable(),
}) satisfies z.ZodType<InsuranceSnapshot>

const feeSnapshotItemSchema = z.object({
  feeType: z.enum(FEE_TYPES),
  unit: z.enum(FEE_UNITS),
  amountJpy: z.number(),
  vehicleClassId: z.string().nullable(),
}) satisfies z.ZodType<FeeSnapshotItem>

const addOnSnapshotSchema = z.object({
  addOnId: z.string(),
  name: z.string(),
  priceJpy: z.number(),
}) satisfies z.ZodType<AddOnSnapshot>

const bookingDtoSchema = z.object({
  id: z.string(),
  bookingCode: z.string(),
  renterId: z.string(),
  classId: z.string().nullable(),
  requestedVehicleId: z.string(),
  assignedVehicleId: z.string(),
  pickupLocationId: z.string(),
  dropoffLocationId: z.string(),
  startAt: z.string(),
  endAt: z.string(),
  effectiveEndAt: z.string(),
  status: z.enum(BOOKING_STATUSES),
  source: z.string(),
  insuranceOptionId: z.string().nullable(),
  insuranceSnapshot: insuranceSnapshotSchema.nullable(),
  feeSnapshot: z.array(feeSnapshotItemSchema),
  addOnSnapshot: z.array(addOnSnapshotSchema),
  totalPrice: z.number().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  operator: z.object({ name: z.string(), preAuthHandoffUrl: z.string().nullable() }).optional(),
}) satisfies z.ZodType<BookingDto>

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
  /** Renter consent to the liability disclaimer (#613), recorded on the booking.
   *  Supplied at the payment step; the server rejects a RENTER booking without it
   *  (400 CONSENT_REQUIRED). Replaces the dropped online document upload. */
  disclaimerAccepted: boolean
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
      disclaimerAccepted: input.disclaimerAccepted,
    }),
  })
  return unwrap(res, bookingDtoSchema)
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
  return unwrap(res, bookingDtoSchema)
}

export function bookingByIdQueryOptions(id: string) {
  return queryOptions({
    queryKey: ['bookings', id],
    queryFn: () => fetchBookingById(id),
  })
}

// "My Bookings" (#543). The full BookingDto has no vehicle name, so the list view
// reads a leaner row shape from `GET /bookings?expand=vehicle`: the assigned car's
// display name flattened in, dates as ISO strings. Mirrors operator-bookings/api
// `OperatorBookingRow`/`toRow`, but renter-scoped and without the renter block.
export type MyBookingStatus = BookingStatus

export interface MyBookingRow {
  id: string
  bookingCode: string
  status: MyBookingStatus
  startAt: string
  endAt: string
  totalPrice: number | null
  // The assigned car's name (#392 — there is no `vehicleId`; the server resolves
  // it via `expand=vehicle`). Null when the expansion is absent (vehicle deleted).
  vehicleName: string | null
}

interface RawMyBooking {
  id: string
  bookingCode: string
  status: MyBookingStatus
  startAt: string
  endAt: string
  totalPrice: number | null
  vehicle?: { name: string; photos: string[] } | undefined
}

const rawMyBookingSchema = z.object({
  id: z.string(),
  bookingCode: z.string(),
  status: z.enum(BOOKING_STATUSES),
  startAt: z.string(),
  endAt: z.string(),
  totalPrice: z.number().nullable(),
  vehicle: z.object({ name: z.string(), photos: z.array(z.string()) }).optional(),
}) satisfies z.ZodType<RawMyBooking>

function toMyRow(b: RawMyBooking): MyBookingRow {
  return {
    id: b.id,
    bookingCode: b.bookingCode,
    status: b.status,
    startAt: b.startAt,
    endAt: b.endAt,
    totalPrice: b.totalPrice,
    vehicleName: b.vehicle?.name ?? null,
  }
}

// Principal-identical read: `renterId=self` means "bookings where I am the renter"
// for any caller, so an operator-in-renter-view never sees tenant rows mislabeled
// as personal (#543 P1). Server ownership scoping (CallerContext) is the real
// boundary; this filter guarantees the page means the same thing for every caller.
// First page only — `nextCursor` is intentionally discarded (no pagination yet).
export async function fetchMyBookings(renterId: string): Promise<MyBookingRow[]> {
  const sp = new URLSearchParams({ expand: 'vehicle', renterId })
  const res = await fetch(`${getApiBaseUrl()}/bookings?${sp.toString()}`, {
    credentials: 'include',
  })
  const data = await unwrap(res, rawMyBookingSchema.array())
  return data.map(toMyRow)
}

export function myBookingsQueryOptions(renterId: string) {
  return queryOptions({
    queryKey: ['bookings', 'mine', renterId],
    queryFn: () => fetchMyBookings(renterId),
  })
}
