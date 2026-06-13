import { unwrap } from '@/lib/api-error'
import { getApiBaseUrl } from '@/vite/api-base'
import type { BookingDto } from '@/vite/bookings/api'
import type { BookingEventPayload, BookingEventType } from '@kuruma/shared/db/schema'
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
  // Degrade to an empty list on failure: the vehicle columns + sidebar filter are
  // a day-view convenience, so a vehicle-list error must NOT take down the whole
  // bookings calendar (week/month render fine without columns, and the route's
  // loader Promise.all would otherwise reject and blank the page — the exact
  // coupling that broke the operator portal when this read /vehicles/fleet-overview).
  try {
    const res = await fetch(`${getApiBaseUrl()}/vehicles?limit=${VEHICLES_PAGE_LIMIT}`, {
      credentials: 'include',
    })
    const data = await unwrap<Array<{ id: string; name: string }>>(res)
    return data.map((v) => ({ id: v.id, name: v.name }))
  } catch {
    return []
  }
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

// #616: the stable prefix every operator-bookings query is keyed under. A write
// invalidates THIS key; React Query's prefix match cascades to the calendar,
// detail, events, pending-count and substitution-candidates entries in one call,
// so no mutation has to enumerate the sub-keys it touched.
export const OPERATOR_BOOKINGS_KEY = ['operator-bookings'] as const

// --- Substitution candidates (#616) -----------------------------------------
// The operator-only GET returns the same-store, same-ACRISS AVAILABLE vehicles
// that can replace the booking's assigned car. The server enforces the match
// (slice 1); the client just lists what it returns. Minimal {id,name} — the
// dialog picks by id and shows the name, mirroring fetchCalendarVehicles.
export interface SubstitutionCandidate {
  id: string
  name: string
}

export async function fetchSubstitutionCandidates(id: string): Promise<SubstitutionCandidate[]> {
  const res = await fetch(
    `${getApiBaseUrl()}/bookings/${encodeURIComponent(id)}/substitution-candidates`,
    { credentials: 'include' },
  )
  const data = await unwrap<Array<{ id: string; name: string }>>(res)
  return data.map((v) => ({ id: v.id, name: v.name }))
}

export function substitutionCandidatesQueryOptions(id: string) {
  return queryOptions({
    queryKey: ['operator-bookings', 'substitution-candidates', id],
    queryFn: () => fetchSubstitutionCandidates(id),
  })
}

// --- Pending-orders count (#616 nav badge) ----------------------------------
// Instant-booked orders sit at CONFIRMED until the operator marks them
// active/completed, so the count of CONFIRMED bookings IS the "new orders
// awaiting action" signal the nav badge surfaces. Reuses the list endpoint with
// NO expansion (the lightest rows) and returns the row count; the badge view
// owns its display cap. The scan limit keeps the request cheap — an operator
// runs ~40-50 cars, so a real pending queue never approaches it.
const PENDING_SCAN_LIMIT = 50

export async function fetchPendingBookingsCount(): Promise<number> {
  const sp = new URLSearchParams({ status: 'CONFIRMED', limit: String(PENDING_SCAN_LIMIT) })
  const res = await fetch(`${getApiBaseUrl()}/bookings?${sp.toString()}`, {
    credentials: 'include',
  })
  const data = await unwrap<unknown[]>(res)
  return data.length
}

export function pendingBookingsCountQueryOptions() {
  return queryOptions({
    queryKey: ['operator-bookings', 'pending-count'],
    queryFn: fetchPendingBookingsCount,
  })
}

// --- Mutations (cookie-based, CSRF-gated) -----------------------------------
// Operator booking actions (#616): status transitions, cancel, and vehicle
// substitution. The global csrf() middleware rejects a cookie-authed mutation
// that omits a matching X-CSRF-Token, so every write threads the session token.
// Content-Type is set only when there's a body (a bodyless POST must not claim
// JSON). Each unwraps the updated booking; the component wires useMutation and
// invalidates OPERATOR_BOOKINGS_KEY on success (no optimistic UI).
async function writeBooking(
  path: string,
  method: 'POST' | 'PATCH',
  csrfToken: string,
  body?: unknown,
): Promise<BookingDto> {
  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    method,
    credentials: 'include',
    headers: {
      'X-CSRF-Token': csrfToken,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return unwrap<BookingDto>(res)
}

export function updateBookingStatus(
  id: string,
  status: OperatorBookingStatus,
  csrfToken: string,
): Promise<BookingDto> {
  return writeBooking(`/bookings/${encodeURIComponent(id)}/status`, 'PATCH', csrfToken, { status })
}

// DELETE-equivalent (the API models cancel as a POST that records a cancellation
// fee in the meta); the projection in `data` is the now-CANCELLED booking.
export function cancelBooking(id: string, csrfToken: string): Promise<BookingDto> {
  return writeBooking(`/bookings/${encodeURIComponent(id)}/cancel`, 'POST', csrfToken)
}

export function substituteVehicle(
  id: string,
  newVehicleId: string,
  reason: string | null,
  csrfToken: string,
): Promise<BookingDto> {
  const body: { newVehicleId: string; reason?: string } = { newVehicleId }
  if (reason) body.reason = reason
  return writeBooking(`/bookings/${encodeURIComponent(id)}/substitute`, 'POST', csrfToken, body)
}
