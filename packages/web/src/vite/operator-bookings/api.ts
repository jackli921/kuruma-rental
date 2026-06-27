import { unwrap, unwrapPage } from '@/lib/api-error'
import { getApiBaseUrl } from '@/vite/api-base'
import { type BookingDto, bookingDtoSchema } from '@/vite/bookings/api'
import type { BookingStatus } from '@kuruma/shared/enums'
import { queryOptions } from '@tanstack/react-query'
import {
  type BookingEventDto,
  type CustomerSearchResult,
  type OperatorBookingDetailDto,
  type RawOperatorBooking,
  bookingEventSchema,
  calendarVehicleRowSchema,
  customerSearchResultSchema,
  operatorBookingDetailSchema,
  rawOperatorBookingSchema,
  substitutionCandidateRowSchema,
} from './schema'

// #711 (3b): the response DTO types + schemas live in ./schema, inferred from /
// pinned to the Zod schemas that validate each body at the network seam. The
// detail + event types are re-exported so consumers import them from here
// unchanged.
export type { BookingEventDto, CustomerSearchResult, OperatorBookingDetailDto }

// #512: operator booking view. The Vite shell owns these DTOs (it never imports
// the frozen Next module's copy) so it stays self-contained and process.env-free.
// Namespaced under `operator-bookings` to stay clear of the renter `vite/bookings`
// client (#511) — the two features evolve independently and must not collide.
//
// The list endpoint is operator-scoped server-side via the session cookie
// (CallerContext in the repo layer), so this client passes NO operatorId — a
// cross-tenant read is impossible from here by construction.

export type OperatorBookingStatus = BookingStatus

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

// The JSON shape of one `GET /bookings?expand=renter` item (RawOperatorBooking)
// is validated by `rawOperatorBookingSchema` in ./schema.

// #525: the operator calendar reads bookings over a date range. Unlike the list
// row, it carries the assigned vehicle id (the resource-column key) and the
// turnaround-aware end so a booking's block spans its real off-fleet window.
/** A booking as the operator *calendar* needs it. Dates are ISO strings (JSON). */
export interface CalendarBookingRow {
  id: string
  bookingCode: string
  status: OperatorBookingStatus
  startAt: string
  // The booked end (pickup→dropoff). The timeline renders [startAt, endAt] as the
  // solid "booked" band and [endAt, effectiveEndAt] as a lighter turnaround band,
  // so both bounds are carried (#1100). Plans #1101/#1102 also need this.
  endAt: string
  effectiveEndAt: string
  // The fulfilling car's id (resource-column key). Null for a class-only booking
  // not yet assigned a vehicle — such a booking has no column to live in.
  vehicleId: string | null
  renterName: string | null
  renterEmail: string | null
  totalPrice: number | null
}

// The API caps `limit` at 100. A 50-car fleet over a multi-day window routinely
// holds more than one page of (range-overlapping) bookings, so a single fetch
// silently dropped bars off the timeline (#1100 #2 — the biggest correctness
// risk). The calendar now follows the cursor to completion instead.
const CALENDAR_PAGE_LIMIT = 100
// Safety bound on the cursor walk: ~50 cars × a few weeks is a few hundred rows;
// 100 pages (10k rows) is far beyond any real fleet+window. Hitting it means a
// cursor bug or an absurd range — throw loudly rather than truncate silently.
const MAX_CALENDAR_PAGES = 100

function toCalendarRow(b: RawOperatorBooking): CalendarBookingRow {
  return {
    id: b.id,
    bookingCode: b.bookingCode,
    status: b.status,
    startAt: b.startAt,
    endAt: b.endAt,
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
  // Follow the cursor to the end so no booking is dropped (#1100 #2). `expand=renter`
  // only: the event title needs the renter, but the vehicle *name* comes from the
  // fleet resource list — events bind to columns by id.
  const rows: RawOperatorBooking[] = []
  let cursor: string | null = null
  for (let page = 0; page < MAX_CALENDAR_PAGES; page++) {
    const sp = new URLSearchParams({
      from,
      to,
      expand: 'renter',
      limit: String(CALENDAR_PAGE_LIMIT),
    })
    if (cursor) sp.set('cursor', cursor)
    const res = await fetch(`${getApiBaseUrl()}/bookings?${sp.toString()}`, {
      credentials: 'include',
    })
    const { data, nextCursor } = await unwrapPage(res, rawOperatorBookingSchema.array())
    rows.push(...data)
    cursor = nextCursor
    if (!cursor) return rows.map(toCalendarRow)
  }
  throw new Error(
    `Calendar pagination exceeded ${MAX_CALENDAR_PAGES} pages for [${from}, ${to}] — refusing to truncate silently`,
  )
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
    const data = await unwrap(res, calendarVehicleRowSchema.array())
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
// The DTO + its schema (operatorBookingDetailSchema) live in ./schema.

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
  return unwrap(res, operatorBookingDetailSchema)
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

// #610: operator vehicle substitution. POST /bookings/:id/substitute swaps the
// booking's assigned car for another AVAILABLE vehicle of the SAME operator,
// pickup location and ACRISS class (the server enforces all three). The renter's
// `requestedVehicleId` is preserved; only `assignedVehicleId` + a re-snapshotted
// totalPrice change, and a VEHICLE_SUBSTITUTED audit event (系统留痕) is appended,
// which the existing timeline renders once the events query is invalidated. As a
// cookie-authed POST it is CSRF-gated (global csrf()), so the caller echoes the
// session token. `reason` is optional in the schema, so it is omitted when blank.
export async function substituteBooking(
  bookingId: string,
  newVehicleId: string,
  reason: string | null,
  csrfToken: string,
): Promise<BookingDto> {
  const body = reason != null ? { newVehicleId, reason } : { newVehicleId }
  const res = await fetch(
    `${getApiBaseUrl()}/bookings/${encodeURIComponent(bookingId)}/substitute`,
    {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify(body),
    },
  )
  return unwrap(res, bookingDtoSchema)
}

// The lifecycle-event DTO (BookingEventDto) + its discriminated-payload schema
// (bookingEventSchema) live in ./schema; the type is re-exported above.
export async function fetchBookingEvents(id: string): Promise<BookingEventDto[]> {
  // Operator/management-only endpoint (#549) — a renter caller 403s, which
  // unwrap() surfaces as an ApiError to the route's error boundary.
  const res = await fetch(`${getApiBaseUrl()}/bookings/${encodeURIComponent(id)}/events`, {
    credentials: 'include',
  })
  return unwrap(res, bookingEventSchema.array())
}

export function bookingEventsQueryOptions(id: string) {
  return queryOptions({
    queryKey: ['operator-bookings', 'events', id],
    queryFn: () => fetchBookingEvents(id),
  })
}

// #464: operator worklist — CLASS_COMBO float bookings still awaiting a concrete
// car (status CONFIRMED or ACTIVE, assignedVehicleId null). The key is shared with
// AssignVehicleDialog's invalidation target so a successful assign removes the
// booking from this list in one cache-invalidation call.
export const NEEDS_ASSIGNMENT_QUERY_KEY = ['operator-bookings', 'needs-assignment'] as const

// #1197: pull a full page (the API caps `limit` at 100). Without an explicit
// limit the route defaults to 20 and unwrap() drops `nextCursor`, so an operator
// with >20 unassigned floats would silently see only 20 on this action worklist.
const NEEDS_ASSIGNMENT_PAGE_LIMIT = 100

export async function fetchNeedsAssignment(): Promise<RawOperatorBooking[]> {
  // `expand=renter` is supported alongside `needsAssignment=true` (the route
  // applies all filters before the expansion join), so renter name/email are
  // included when the user table has them. The rawOperatorBookingSchema already
  // carries the optional renter block, so no new schema is needed here.
  const sp = new URLSearchParams({
    needsAssignment: 'true',
    expand: 'renter',
    limit: String(NEEDS_ASSIGNMENT_PAGE_LIMIT),
  })
  const res = await fetch(`${getApiBaseUrl()}/bookings?${sp.toString()}`, {
    credentials: 'include',
  })
  return unwrap(res, rawOperatorBookingSchema.array())
}

export function needsAssignmentQueryOptions() {
  return queryOptions({
    queryKey: NEEDS_ASSIGNMENT_QUERY_KEY,
    queryFn: fetchNeedsAssignment,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  })
}

// #616: the stable prefix every operator-bookings query is keyed under. A write
// invalidates THIS key; React Query's prefix match cascades to the calendar,
// detail, events and substitution-candidates entries in one call, so no mutation
// has to enumerate the sub-keys it touched.
export const OPERATOR_BOOKINGS_KEY = ['operator-bookings'] as const

// --- Substitution candidates (#616, closes #621) ----------------------------
// The operator-only GET returns the same-store, same-ACRISS AVAILABLE vehicles
// that can replace the booking's assigned car. The server enforces the match by
// ACRISS *code* — the authoritative rule #610's client-side classId filter only
// approximated (#621); this endpoint is that fix. The client just lists what it
// returns: name + plate for the picker label.
export interface SubstitutionCandidate {
  id: string
  name: string
  licensePlate: string | null
}

export async function fetchSubstitutionCandidates(id: string): Promise<SubstitutionCandidate[]> {
  const res = await fetch(
    `${getApiBaseUrl()}/bookings/${encodeURIComponent(id)}/substitution-candidates`,
    { credentials: 'include' },
  )
  const data = await unwrap(res, substitutionCandidateRowSchema.array())
  return data.map((v) => ({ id: v.id, name: v.name, licensePlate: v.licensePlate ?? null }))
}

export function substitutionCandidatesQueryOptions(id: string) {
  return queryOptions({
    queryKey: ['operator-bookings', 'substitution-candidates', id],
    queryFn: () => fetchSubstitutionCandidates(id),
  })
}

// #464: assign a concrete vehicle to a CLASS_COMBO float booking. The server
// enforces same-operator / same-pickup-location / same-ACRISS / AVAILABLE /
// road-legal — the candidate set comes from substitution-candidates. A
// VEHICLE_ASSIGNED audit event is appended; the booking transitions from a
// float to a fully-assigned car. CSRF-gated (cookie-authed POST).
export async function assignVehicle(
  bookingId: string,
  vehicleId: string,
  reason: string | null,
  csrfToken: string,
): Promise<BookingDto> {
  const body = reason != null ? { vehicleId, reason } : { vehicleId }
  const res = await fetch(`${getApiBaseUrl()}/bookings/${encodeURIComponent(bookingId)}/assign`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
    body: JSON.stringify(body),
  })
  return unwrap(res, bookingDtoSchema)
}

// --- Status mutations (cookie-based, CSRF-gated) ----------------------------
// Operator booking lifecycle actions (#616): status transitions + cancel.
// (Vehicle substitution lives in substituteBooking above, shipped with #610.)
// The global csrf() middleware rejects a cookie-authed mutation that omits a
// matching X-CSRF-Token, so every write threads the session token. Content-Type
// is set only when there's a body (a bodyless POST must not claim JSON). Each
// unwraps the updated booking; the component wires useMutation and invalidates
// OPERATOR_BOOKINGS_KEY on success (no optimistic UI).
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
  return unwrap(res, bookingDtoSchema)
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

// --- Existing-customer search (#589 1d slice 3) ------------------------------
// The dialog can attach an EXISTING renter instead of creating a walk-in. This
// reads the one operator-reachable customer route: CustomerService.search scopes
// an OPERATOR_* caller to renters within its own tenant (prior-booking), so the
// picker can't enumerate the global user table (#396/#475) — the client passes
// only `q`, never an operatorId; the session cookie carries the tenant scope.
export async function searchCustomers(q: string): Promise<CustomerSearchResult[]> {
  const sp = new URLSearchParams({ q })
  const res = await fetch(`${getApiBaseUrl()}/customers/search?${sp.toString()}`, {
    credentials: 'include',
  })
  return unwrap(res, customerSearchResultSchema.array())
}

// The picker drives this with its debounced query. `enabled` mirrors the server's
// 2-char minimum so an under-length term never fires a guaranteed-400 request.
const CUSTOMER_SEARCH_MIN_CHARS = 2
export function customerSearchQueryOptions(q: string) {
  return queryOptions({
    queryKey: ['operator-bookings', 'customer-search', q],
    queryFn: () => searchCustomers(q),
    enabled: q.trim().length >= CUSTOMER_SEARCH_MIN_CHARS,
  })
}

// --- Manual booking creation (#589 1d) --------------------------------------
// An operator books on behalf of a customer from the calendar. The customer is a
// discriminated union, never a flag-bag: a brand-new *walk-in* (inline name +
// phone) or an *existing* renter by id. Modeling it as `{ kind }` makes
// the impossible "both/neither customer" state unrepresentable and mirrors the
// server's mutually-exclusive walkInCustomer/renterId refine. NO email is ever
// sent for a walk-in: email is globally unique, so a create-by-email would leak
// whether an address exists (#396/#475); the server mints a synthetic placeholder.
export type ManualBookingCustomer =
  | { kind: 'walk-in'; name: string; phone: string }
  | { kind: 'existing'; renterId: string }

export interface CreateManualBookingInput {
  requestedVehicleId: string
  // Pickup and dropoff are separate ids (the form sets both from one select today;
  // one-way rentals are a later track) so the wire contract already carries both.
  pickupLocationId: string
  dropoffLocationId: string
  /** ISO datetime — the form converts its JST datetime-local via parseJstDateTimeLocal. */
  startAt: string
  endAt: string
  customer: ManualBookingCustomer
  /** Client-minted per attempt so a double-submit/retry replays server-side
   *  (booking-creation's idempotency guard) instead of creating a duplicate. */
  idempotencyKey: string
}

// Instant-book on the operator side. `source=MANUAL` so the booking is attributed
// correctly — the route honors a manual booker's source but defaults to DIRECT,
// which would mislabel it. `disclaimerAccepted` is omitted: operators are
// consent-exempt (the route requires it only for a RENTER self-serve booking).
// Cookie + CSRF-gated, so the session token rides the write; unwrap throws an
// ApiError on a domain failure (409 just-booked / 400 bad range / 403 scope) for
// the dialog to surface.
export function createManualBooking(
  input: CreateManualBookingInput,
  csrfToken: string,
): Promise<BookingDto> {
  // The customer source is XOR: an existing renter sends `renterId`, a walk-in
  // sends inline `walkInCustomer`. Building exactly one block keeps the wire body
  // mutually exclusive — mirroring the server's createBookingSchema refine, so the
  // "both/neither" 400 is unreachable from this client by construction.
  const customerBody =
    input.customer.kind === 'existing'
      ? { renterId: input.customer.renterId }
      : { walkInCustomer: { name: input.customer.name, phone: input.customer.phone } }
  // Composes the shared writeBooking helper (credentials + X-CSRF-Token + JSON +
  // unwrap in one auditable place). The body always exists, so JSON is sent.
  return writeBooking('/bookings', 'POST', csrfToken, {
    requestedVehicleId: input.requestedVehicleId,
    pickupLocationId: input.pickupLocationId,
    dropoffLocationId: input.dropoffLocationId,
    startAt: input.startAt,
    endAt: input.endAt,
    source: 'MANUAL',
    idempotencyKey: input.idempotencyKey,
    ...customerBody,
  })
}
