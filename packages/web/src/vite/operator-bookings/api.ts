import { ApiError, unwrap } from '@/lib/api-error'
import { getApiBaseUrl } from '@/vite/api-base'
import type { BookingDto } from '@/vite/bookings/api'
import type { BookingEventPayload, BookingEventType } from '@kuruma/shared/db/schema'
import type { CancellationResult } from '@kuruma/shared/lib/cancellation-policy'
import { queryOptions } from '@tanstack/react-query'

// #512: operator booking view. The Vite shell owns these DTOs (it never imports
// the frozen Next module's copy) so it stays self-contained and process.env-free.
// Namespaced under `operator-bookings` to stay clear of the renter `vite/bookings`
// client (#511) — the two features evolve independently and must not collide.
//
// The list endpoint is operator-scoped server-side via the session cookie
// (CallerContext in the repo layer), so this client passes NO operatorId — a
// cross-tenant read is impossible from here by construction.

export type OperatorBookingStatus = 'CONFIRMED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED'

/** A booking row as the operator view needs it. Dates are ISO strings (JSON). */
export interface OperatorBookingRow {
  id: string
  bookingCode: string
  status: OperatorBookingStatus
  startAt: string
  endAt: string
  totalPrice: number | null
  // The fulfilling car's display name (#392 — there is no `vehicleId`; the server
  // resolves the *assigned* vehicle via `expand=vehicle`). Null when the expansion
  // is absent (e.g. the vehicle was deleted) so the view can fall back gracefully.
  vehicleName: string | null
  renter: { id: string; name: string | null; email: string | null } | null
}

/** The JSON shape of one `GET /bookings?expand=vehicle,renter` item we read. */
interface RawOperatorBooking {
  id: string
  bookingCode: string
  status: OperatorBookingStatus
  startAt: string
  endAt: string
  // The turnaround-aware end (#551) and the server-assigned vehicle id (#392).
  // Present on the list response; the calendar binds events to vehicle columns
  // by `assignedVehicleId`, and draws the block out to `effectiveEndAt`.
  effectiveEndAt?: string | undefined
  assignedVehicleId?: string | null | undefined
  totalPrice: number | null
  vehicle?: { name: string; photos: string[] } | undefined
  renter?: { id: string; name: string | null; email: string | null; language: string } | undefined
}

export interface OperatorBookingFilters {
  status?: OperatorBookingStatus
  limit?: number
}

function toRow(b: RawOperatorBooking): OperatorBookingRow {
  return {
    id: b.id,
    bookingCode: b.bookingCode,
    status: b.status,
    startAt: b.startAt,
    endAt: b.endAt,
    totalPrice: b.totalPrice,
    vehicleName: b.vehicle?.name ?? null,
    renter: b.renter ? { id: b.renter.id, name: b.renter.name, email: b.renter.email } : null,
  }
}

export async function fetchOperatorBookings(
  filters: OperatorBookingFilters = {},
): Promise<OperatorBookingRow[]> {
  const sp = new URLSearchParams({ expand: 'vehicle,renter' })
  if (filters.status) sp.set('status', filters.status)
  if (filters.limit) sp.set('limit', String(filters.limit))

  const res = await fetch(`${getApiBaseUrl()}/bookings?${sp.toString()}`, {
    credentials: 'include',
  })
  const data = await unwrap<RawOperatorBooking[]>(res)
  return data.map(toRow)
}

export function operatorBookingsQueryOptions(filters: OperatorBookingFilters = {}) {
  return queryOptions({
    // Key on every filter that changes the response (status + limit) so two
    // callers with different limits never collide on a stale cache entry.
    queryKey: ['operator-bookings', filters.status, filters.limit],
    queryFn: () => fetchOperatorBookings(filters),
  })
}

// #525: the operator calendar reads bookings over a date range. Unlike the list
// row, it carries the assigned vehicle id (the resource-column key) and the
// turnaround-aware end so a booking's block spans its real off-fleet window.
/** A booking as the operator *calendar* needs it. Dates are ISO strings (JSON). */
export interface CalendarBookingRow {
  id: string
  bookingCode: string
  status: OperatorBookingStatus
  startAt: string
  effectiveEndAt: string
  // The fulfilling car's id (resource-column key). Null for a class-only booking
  // not yet assigned a vehicle — such a booking has no column to live in.
  vehicleId: string | null
  renterName: string | null
  renterEmail: string | null
  totalPrice: number | null
}

// Pull a generous page (the API caps `limit` at 100); a single range fetch keeps
// the calendar a pure function of [from, to]. Deeper paging is a later concern.
const CALENDAR_PAGE_LIMIT = 100

function toCalendarRow(b: RawOperatorBooking): CalendarBookingRow {
  return {
    id: b.id,
    bookingCode: b.bookingCode,
    status: b.status,
    startAt: b.startAt,
    effectiveEndAt: b.effectiveEndAt ?? b.endAt,
    vehicleId: b.assignedVehicleId ?? null,
    renterName: b.renter?.name ?? null,
    renterEmail: b.renter?.email ?? null,
    totalPrice: b.totalPrice,
  }
}

export async function fetchCalendarBookings(
  from: string,
  to: string,
): Promise<CalendarBookingRow[]> {
  // `expand=renter` only: the event title needs the renter, but the vehicle
  // *name* comes from the fleet resource list — events bind to columns by id.
  const sp = new URLSearchParams({
    from,
    to,
    expand: 'renter',
    limit: String(CALENDAR_PAGE_LIMIT),
  })
  const res = await fetch(`${getApiBaseUrl()}/bookings?${sp.toString()}`, {
    credentials: 'include',
  })
  const data = await unwrap<RawOperatorBooking[]>(res)
  return data.map(toCalendarRow)
}

export function operatorCalendarQueryOptions(from: string, to: string) {
  return queryOptions({
    queryKey: ['operator-bookings', 'calendar', from, to],
    queryFn: () => fetchCalendarBookings(from, to),
  })
}

// #525: the calendar's day-view columns + sidebar filter need the operator's own
// vehicles as {id, name}. Read them from the tenant-scoped `GET /vehicles`
// (operator-accessible — CallerContext scopes the rows to this tenant), NOT
// `/vehicles/fleet-overview`: that is a STAFF-only, platform-wide endpoint (it
// 403s for an OPERATOR_* session and isn't tenant-scoped), so the calendar must
// not depend on it. Operators run ~40-50 cars; one page (the API max, 100)
// covers the fleet for the columns.
const VEHICLES_PAGE_LIMIT = 100

/** A fleet vehicle as the calendar consumes it: a day-view column + filter row. */
export interface CalendarVehicle {
  id: string
  name: string
}

export async function fetchCalendarVehicles(): Promise<CalendarVehicle[]> {
  const res = await fetch(`${getApiBaseUrl()}/vehicles?limit=${VEHICLES_PAGE_LIMIT}`, {
    credentials: 'include',
  })
  const data = await unwrap<Array<{ id: string; name: string }>>(res)
  return data.map((v) => ({ id: v.id, name: v.name }))
}

export function operatorCalendarVehiclesQueryOptions() {
  return queryOptions({
    queryKey: ['operator-bookings', 'calendar', 'vehicles'],
    queryFn: fetchCalendarVehicles,
  })
}

// #549: the deep-linked trip-detail page has no list row, so it reads the single
// booking WITH `expand=vehicle,renter` (slice 2) — a superset of the renter
// BookingDto carrying the assigned car + renter on top of the operator block.
export interface OperatorBookingDetailDto extends BookingDto {
  vehicle?: { name: string; photos: string[] } | undefined
  renter?: { id: string; name: string | null; email: string | null; language: string } | undefined
}

export async function fetchOperatorBookingDetail(
  id: string,
): Promise<OperatorBookingDetailDto | null> {
  const res = await fetch(
    `${getApiBaseUrl()}/bookings/${encodeURIComponent(id)}?expand=vehicle,renter`,
    { credentials: 'include' },
  )
  // The single read is IDOR/tenant-sealed server-side (404 for a foreign or
  // missing booking); map it to null so the loader can fire notFound().
  if (res.status === 404) return null
  return unwrap<OperatorBookingDetailDto>(res)
}

export function operatorBookingDetailQueryOptions(id: string) {
  return queryOptions({
    queryKey: ['operator-bookings', 'detail', id],
    queryFn: () => fetchOperatorBookingDetail(id),
  })
}

/**
 * Derive the OperatorBookingRow shape the pure OperatorBookingDetail panel still
 * consumes from the expanded single read — the page has no list row to pass.
 */
export function operatorRowFromDetail(dto: OperatorBookingDetailDto): OperatorBookingRow {
  return {
    id: dto.id,
    bookingCode: dto.bookingCode,
    status: dto.status,
    startAt: dto.startAt,
    endAt: dto.endAt,
    totalPrice: dto.totalPrice,
    vehicleName: dto.vehicle?.name ?? null,
    renter: dto.renter
      ? { id: dto.renter.id, name: dto.renter.name, email: dto.renter.email }
      : null,
  }
}

/** One lifecycle event as the operator timeline reads it (dates are ISO JSON). */
export interface BookingEventDto {
  id: string
  type: BookingEventType
  payload: BookingEventPayload
  actorId: string | null
  createdAt: string
}

export async function fetchBookingEvents(id: string): Promise<BookingEventDto[]> {
  // Operator/management-only endpoint (#549) — a renter caller 403s, which
  // unwrap() surfaces as an ApiError to the route's error boundary.
  const res = await fetch(`${getApiBaseUrl()}/bookings/${encodeURIComponent(id)}/events`, {
    credentials: 'include',
  })
  return unwrap<BookingEventDto[]>(res)
}

export function bookingEventsQueryOptions(id: string) {
  return queryOptions({
    queryKey: ['operator-bookings', 'events', id],
    queryFn: () => fetchBookingEvents(id),
  })
}

// --- #616: operator order actions (substitute / cancel / status) -------------
// Writes are cookie-authed, so each threads the session CSRF token — the global
// csrf() middleware rejects a mutation without a matching X-CSRF-Token. Mirrors
// the operator-add-ons client; the bare operator-fleet writeJson omits the
// header and must not be copied for writes. The trip-detail page wires these
// into useMutation and invalidates the ['operator-bookings'] prefix on success.

async function writeBooking<T>(
  path: string,
  method: 'POST' | 'PATCH',
  body: unknown,
  csrfToken: string,
): Promise<T> {
  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
    body: JSON.stringify(body),
  })
  return unwrap<T>(res)
}

export async function updateBookingStatus(
  id: string,
  status: OperatorBookingStatus,
  csrfToken: string,
): Promise<BookingDto> {
  return writeBooking<BookingDto>(
    `/bookings/${encodeURIComponent(id)}/status`,
    'PATCH',
    { status },
    csrfToken,
  )
}

export async function substituteVehicle(
  id: string,
  newVehicleId: string,
  reason: string | null,
  csrfToken: string,
): Promise<BookingDto> {
  return writeBooking<BookingDto>(
    `/bookings/${encodeURIComponent(id)}/substitute`,
    'POST',
    { newVehicleId, ...(reason ? { reason } : {}) },
    csrfToken,
  )
}

export interface CancelBookingResult {
  booking: BookingDto
  cancellation: CancellationResult
}

// Cancel returns the fee tier in the envelope META (alongside `data`), which
// unwrap() discards — so read the raw envelope to surface { booking, cancellation }.
export async function cancelBooking(id: string, csrfToken: string): Promise<CancelBookingResult> {
  const res = await fetch(`${getApiBaseUrl()}/bookings/${encodeURIComponent(id)}/cancel`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'X-CSRF-Token': csrfToken },
  })
  const body = (await res.json().catch(() => ({
    success: false as const,
    error: `Non-JSON response (HTTP ${res.status})`,
  }))) as
    | { success: true; data: BookingDto; cancellation: CancellationResult }
    | { success: false; error: string }
  if (!body.success) throw new ApiError(body.error, res.status)
  return { booking: body.data, cancellation: body.cancellation }
}

/** A vehicle eligible to replace the assigned car (same store + ACRISS class). */
export interface SubstitutionCandidate {
  id: string
  name: string
}

export async function fetchSubstitutionCandidates(id: string): Promise<SubstitutionCandidate[]> {
  const res = await fetch(
    `${getApiBaseUrl()}/bookings/${encodeURIComponent(id)}/substitution-candidates`,
    { credentials: 'include' },
  )
  return unwrap<SubstitutionCandidate[]>(res)
}

export function substitutionCandidatesQueryOptions(id: string) {
  return queryOptions({
    queryKey: ['operator-bookings', 'substitution-candidates', id],
    queryFn: () => fetchSubstitutionCandidates(id),
  })
}

// New-order badge (#616 step 7): the count of CONFIRMED (open, not-yet-active)
// bookings. The list envelope carries no total and caps at `limit`, so the badge
// reads min(count, limit) and renders `{limit}+` at the cap (see NavBadge). This
// is an approximate "needs attention" signal, not an unseen-count — a CONFIRMED
// booking stays counted until it goes ACTIVE/CANCELLED (notification-ledger
// unread count is the principled follow-up).
export const PENDING_BOOKINGS_BADGE_LIMIT = 99

export async function fetchPendingBookingsCount(): Promise<number> {
  const res = await fetch(
    `${getApiBaseUrl()}/bookings?status=CONFIRMED&limit=${PENDING_BOOKINGS_BADGE_LIMIT}`,
    { credentials: 'include' },
  )
  const data = await unwrap<unknown[]>(res)
  return data.length
}

export function pendingBookingsCountQueryOptions() {
  return queryOptions({
    queryKey: ['operator-bookings', 'pending-count'],
    queryFn: fetchPendingBookingsCount,
  })
}
