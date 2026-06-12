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
