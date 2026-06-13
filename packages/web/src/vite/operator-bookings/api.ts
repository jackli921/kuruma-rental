import { unwrap } from '@/lib/api-error'
import type { SubstitutionVehicle } from '@/lib/substitution'
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

// #610: operator-only vehicle substitution (故障车换同级别车). Swaps the assigned
// car for another AVAILABLE vehicle of the same class + pickup location; the
// server re-validates those rules, re-snapshots totalPrice and appends the
// VEHICLE_SUBSTITUTED audit event (which the timeline already renders). Cookie-
// authed + CSRF-gated, so the caller echoes the session token. An empty reason is
// dropped so the body carries only what the operator supplied.
export async function substituteBooking(
  bookingId: string,
  newVehicleId: string,
  reason: string,
  csrfToken: string,
): Promise<BookingDto> {
  const trimmedReason = reason.trim()
  const res = await fetch(
    `${getApiBaseUrl()}/bookings/${encodeURIComponent(bookingId)}/substitute`,
    {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({
        newVehicleId,
        ...(trimmedReason ? { reason: trimmedReason } : {}),
      }),
    },
  )
  return unwrap<BookingDto>(res)
}

// #610: the substitution picker needs the operator's own vehicles with the four
// fields the candidate rule reads (classId, pickupLocationId, status) plus name +
// plate for display. Read them from the lean tenant-scoped `GET /vehicles` (the
// same operator-accessible list the calendar uses), NOT the heavy STAFF-only
// `/vehicles/fleet-overview` — and degrade to [] on failure so a vehicle-list
// error never blanks the trip-detail page (timeline included). The pure
// `selectSubstitutionCandidates` filter is the single rule authority, so this
// fetches the whole page and lets the filter narrow it.
type RawSubstitutionVehicle = {
  id: string
  name: string
  licensePlate: string | null
  classId: string | null
  pickupLocationId: string | null
  status: string
}

export async function fetchSubstitutionCandidates(): Promise<SubstitutionVehicle[]> {
  try {
    const res = await fetch(`${getApiBaseUrl()}/vehicles?limit=${VEHICLES_PAGE_LIMIT}`, {
      credentials: 'include',
    })
    const data = await unwrap<RawSubstitutionVehicle[]>(res)
    return data.map((v) => ({
      id: v.id,
      name: v.name,
      licensePlate: v.licensePlate,
      classId: v.classId,
      pickupLocationId: v.pickupLocationId,
      status: v.status,
    }))
  } catch {
    return []
  }
}

export function substitutionCandidatesQueryOptions() {
  return queryOptions({
    queryKey: ['operator-bookings', 'substitution-candidates'],
    queryFn: fetchSubstitutionCandidates,
  })
}
