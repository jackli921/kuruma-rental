import { ApiError, ParseError } from '@/lib/api-error'
import {
  type OperatorBookingDetailDto,
  bookingEventsQueryOptions,
  cancelBooking,
  createManualBooking,
  customerSearchQueryOptions,
  fetchBookingEvents,
  fetchCalendarBookings,
  fetchCalendarVehicles,
  fetchNeedsAssignment,
  fetchOperatorBookingDetail,
  fetchSubstitutionCandidates,
  operatorBookingDetailQueryOptions,
  operatorCalendarQueryOptions,
  operatorCalendarVehiclesQueryOptions,
  operatorRowFromDetail,
  searchCustomers,
  substituteBooking,
  substitutionCandidatesQueryOptions,
  updateBookingStatus,
} from '@/vite/operator-bookings/api'
import { afterEach, describe, expect, it, vi } from 'vitest'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

// #549: the deep-linked trip-detail page reads the single booking WITH expansion
// (it has no list row) plus the lifecycle events for the timeline.

// A full BookingDto as it arrives over JSON (dates = ISO strings). #711: now that
// the client validates responses, fixtures must carry every required field — a
// partial body would (correctly) fail at the seam. The substitute/status/cancel
// writes return this bare shape (no operator/vehicle/renter block).
const bookingRaw = (over: Record<string, unknown> = {}) => ({
  id: 'bk-1',
  bookingCode: 'ABCD2345',
  renterId: 'r-1',
  classId: 'cls-1',
  requestedVehicleId: 'veh-req',
  assignedVehicleId: 'veh-1',
  pickupLocationId: 'loc-1',
  dropoffLocationId: 'loc-1',
  startAt: '2026-07-01T01:00:00.000Z',
  endAt: '2026-07-03T01:00:00.000Z',
  effectiveEndAt: '2026-07-03T02:00:00.000Z',
  status: 'CONFIRMED',
  source: 'DIRECT',
  insuranceOptionId: null,
  insuranceSnapshot: null,
  feeSnapshot: [],
  addOnSnapshot: [],
  totalPrice: 24000,
  notes: null,
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
  ...over,
})

// The expanded single read = the bare booking + operator/vehicle/renter blocks.
const detailRaw = (over: Record<string, unknown> = {}) => ({
  ...bookingRaw(),
  operator: { name: 'Op', preAuthHandoffUrl: null },
  vehicle: { name: 'Toyota Aqua', photos: ['a.jpg'] },
  renter: { id: 'r-1', name: 'Jane', email: 'jane@example.com', language: 'en' },
  ...over,
})

// A valid lifecycle event: payload is the #716 discriminated union keyed on `type`.
const eventRaw = (over: Record<string, unknown> = {}) => ({
  id: 'evt-1',
  type: 'STATUS_CHANGED',
  payload: { type: 'STATUS_CHANGED', from: 'CONFIRMED', to: 'ACTIVE' },
  actorId: 'r-1',
  createdAt: '2026-07-01T01:00:00.000Z',
  ...over,
})

describe('fetchOperatorBookingDetail', () => {
  it('requests the single booking expanding vehicle and renter, with credentials', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: detailRaw() }))
    vi.stubGlobal('fetch', fetchMock)

    await fetchOperatorBookingDetail('bk-1')

    const [url, init] = fetchMock.mock.calls[0]!
    const parsed = new URL(url as string, 'http://x')
    expect(parsed.pathname).toBe('/api/bookings/bk-1')
    expect(parsed.searchParams.get('expand')).toBe('vehicle,renter')
    expect((init as RequestInit).credentials).toBe('include')
  })

  it('returns the expanded booking carrying operator block, vehicle, renter', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ success: true, data: detailRaw() })),
    )

    const dto = await fetchOperatorBookingDetail('bk-1')

    expect(dto).toMatchObject({
      id: 'bk-1',
      operator: { name: 'Op', preAuthHandoffUrl: null },
      vehicle: { name: 'Toyota Aqua' },
      renter: { id: 'r-1', email: 'jane@example.com' },
    })
  })

  it('maps a 404 to null so the route loader can notFound()', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ success: false, error: 'Booking not found' }, 404)),
    )

    expect(await fetchOperatorBookingDetail('missing')).toBeNull()
  })
})

describe('operatorBookingDetailQueryOptions', () => {
  it('keys by the booking detail id', () => {
    expect(operatorBookingDetailQueryOptions('bk-1').queryKey).toEqual([
      'operator-bookings',
      'detail',
      'bk-1',
    ])
  })
})

describe('operatorRowFromDetail', () => {
  it('derives the row shape (vehicle name + renter) the detail panel consumes', () => {
    const row = operatorRowFromDetail(detailRaw() as unknown as OperatorBookingDetailDto)
    expect(row).toEqual({
      id: 'bk-1',
      bookingCode: 'ABCD2345',
      status: 'CONFIRMED',
      startAt: '2026-07-01T01:00:00.000Z',
      endAt: '2026-07-03T01:00:00.000Z',
      totalPrice: 24000,
      vehicleName: 'Toyota Aqua',
      renter: { id: 'r-1', name: 'Jane', email: 'jane@example.com' },
    })
  })

  it('nulls vehicleName + renter when the expansion is absent', () => {
    const dto = { ...detailRaw(), vehicle: undefined, renter: undefined }
    const row = operatorRowFromDetail(dto as unknown as OperatorBookingDetailDto)
    expect(row.vehicleName).toBeNull()
    expect(row.renter).toBeNull()
  })
})

describe('fetchBookingEvents', () => {
  it('requests the operator events endpoint with credentials', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: [] }))
    vi.stubGlobal('fetch', fetchMock)

    await fetchBookingEvents('bk-1')

    const [url, init] = fetchMock.mock.calls[0]!
    expect(new URL(url as string, 'http://x').pathname).toBe('/api/bookings/bk-1/events')
    expect((init as RequestInit).credentials).toBe('include')
  })

  it('returns the events array from the envelope', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ success: true, data: [eventRaw()] })),
    )

    const events = await fetchBookingEvents('bk-1')

    expect(events).toEqual([eventRaw()])
  })

  it('throws ApiError on a failure envelope (e.g. a renter 403)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ success: false, error: 'Only operators' }, 403)),
    )

    await expect(fetchBookingEvents('bk-1')).rejects.toBeInstanceOf(ApiError)
  })

  // #1198: every discriminated-union arm needs a `.parse` round-trip — the
  // output-covariant `satisfies z.ZodType` does NOT prove a wrong arm is caught
  // (that hole shipped the original VEHICLE_ASSIGNED ParseError, #464).
  it('parses a VEHICLE_SUBSTITUTED event payload through the schema', async () => {
    const substituted = eventRaw({
      type: 'VEHICLE_SUBSTITUTED',
      payload: {
        type: 'VEHICLE_SUBSTITUTED',
        fromVehicleId: 'veh-old',
        toVehicleId: 'veh-new',
        reason: 'mechanical fault',
      },
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ success: true, data: [substituted] })),
    )

    const events = await fetchBookingEvents('bk-1')

    expect(events).toEqual([substituted])
  })

  it('parses a legacy BOOKING_CANCELLED payload missing cancellationReason -> defaults to null', async () => {
    // Pre-#868 rows carry no cancellationReason key; the schema's `.default(null)`
    // is load-bearing — without it the whole timeline ParseErrors for old
    // cancelled bookings. Assert the default actually applies.
    const legacyCancelled = eventRaw({
      type: 'BOOKING_CANCELLED',
      payload: {
        type: 'BOOKING_CANCELLED',
        cancellationFee: 5000,
        cancelledAt: '2026-07-01T02:00:00.000Z',
      },
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ success: true, data: [legacyCancelled] })),
    )

    const [event] = await fetchBookingEvents('bk-1')

    expect(event?.payload).toEqual({
      type: 'BOOKING_CANCELLED',
      cancellationFee: 5000,
      cancelledAt: '2026-07-01T02:00:00.000Z',
      cancellationReason: null,
    })
  })
})

describe('fetchNeedsAssignment', () => {
  it('requests a full page (limit=100) so the worklist is not truncated at the default 20 (#1197)', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: [] }))
    vi.stubGlobal('fetch', fetchMock)

    await fetchNeedsAssignment()

    const url = new URL(fetchMock.mock.calls[0]![0] as string, 'http://x')
    expect(url.pathname).toBe('/api/bookings')
    expect(url.searchParams.get('needsAssignment')).toBe('true')
    expect(url.searchParams.get('limit')).toBe('100')
    // #1223: the FloatRow renter label depends on the renter expansion; pin it so a
    // mutation dropping expand=renter is caught.
    expect(url.searchParams.get('expand')).toBe('renter')
  })
})

describe('bookingEventsQueryOptions', () => {
  it('keys by the booking events id', () => {
    expect(bookingEventsQueryOptions('bk-1').queryKey).toEqual([
      'operator-bookings',
      'events',
      'bk-1',
    ])
  })
})

// Slice A (#525): the operator *calendar* reads bookings over a date range. It
// needs the assigned vehicle id (the resource-column key the list row #512
// deliberately omits) and the turnaround-aware effectiveEndAt for the event end.

const calendarRaw = (over: Record<string, unknown> = {}) => ({
  id: 'bk-1',
  operatorId: 'op-1',
  renterId: 'r-1',
  assignedVehicleId: 'veh-1',
  bookingCode: 'ABCD2345',
  status: 'CONFIRMED',
  startAt: '2026-07-01T01:00:00.000Z',
  endAt: '2026-07-03T01:00:00.000Z',
  effectiveEndAt: '2026-07-03T02:00:00.000Z',
  totalPrice: 24000,
  renter: { id: 'r-1', name: 'Jane', email: 'jane@example.com', language: 'en' },
  ...over,
})

describe('fetchCalendarBookings', () => {
  it('requests the range expanding renter with a high limit and credentials', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: [], nextCursor: null }))
    vi.stubGlobal('fetch', fetchMock)

    await fetchCalendarBookings('2026-07-01T00:00:00.000Z', '2026-07-31T23:59:59.999Z')

    const [url, init] = fetchMock.mock.calls[0]!
    const parsed = new URL(url as string, 'http://x')
    expect(parsed.pathname).toBe('/api/bookings')
    expect(parsed.searchParams.get('from')).toBe('2026-07-01T00:00:00.000Z')
    expect(parsed.searchParams.get('to')).toBe('2026-07-31T23:59:59.999Z')
    expect(parsed.searchParams.get('expand')).toBe('renter')
    expect(parsed.searchParams.get('limit')).toBe('100')
    expect((init as RequestInit).credentials).toBe('include')
  })

  it('maps raw bookings to calendar rows (vehicleId from assignedVehicleId, turnaround end)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ success: true, data: [calendarRaw()], nextCursor: null })),
    )

    const rows = await fetchCalendarBookings('2026-07-01T00:00:00.000Z', '2026-07-31T23:59:59.999Z')

    expect(rows).toEqual([
      {
        id: 'bk-1',
        bookingCode: 'ABCD2345',
        status: 'CONFIRMED',
        startAt: '2026-07-01T01:00:00.000Z',
        endAt: '2026-07-03T01:00:00.000Z',
        effectiveEndAt: '2026-07-03T02:00:00.000Z',
        vehicleId: 'veh-1',
        renterName: 'Jane',
        renterEmail: 'jane@example.com',
        totalPrice: 24000,
      },
    ])
  })

  it('falls back to endAt when effectiveEndAt is absent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          success: true,
          data: [calendarRaw({ effectiveEndAt: undefined })],
          nextCursor: null,
        }),
      ),
    )

    const [row] = await fetchCalendarBookings('a', 'b')
    expect(row!.effectiveEndAt).toBe('2026-07-03T01:00:00.000Z')
  })

  it('nulls vehicleId + renter fields when absent (class-only / unexpanded)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          success: true,
          data: [calendarRaw({ assignedVehicleId: undefined, renter: undefined })],
          nextCursor: null,
        }),
      ),
    )

    const [row] = await fetchCalendarBookings('a', 'b')
    expect(row!.vehicleId).toBeNull()
    expect(row!.renterName).toBeNull()
    expect(row!.renterEmail).toBeNull()
  })

  it('throws ApiError on a failure envelope', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ success: false, error: 'Unauthorized' }, 401)),
    )

    await expect(fetchCalendarBookings('a', 'b')).rejects.toBeInstanceOf(ApiError)
  })

  it('follows the cursor across pages so >100 bookings are never silently dropped (#1100 #2)', async () => {
    // 130 bookings (a 50-car fleet over a multi-day window) span two pages. The old
    // single-fetch + 100-cap returned only the first page with no signal.
    const page1 = Array.from({ length: 100 }, (_, i) => calendarRaw({ id: `bk-${i}` }))
    const page2 = Array.from({ length: 30 }, (_, i) => calendarRaw({ id: `bk-${100 + i}` }))
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ success: true, data: page1, nextCursor: 'cursor-2' }))
      .mockResolvedValueOnce(jsonResponse({ success: true, data: page2, nextCursor: null }))
    vi.stubGlobal('fetch', fetchMock)

    const rows = await fetchCalendarBookings('a', 'b')

    expect(fetchMock).toHaveBeenCalledTimes(2)
    // The second request echoed the cursor the first page returned.
    expect(
      new URL(fetchMock.mock.calls[1]![0] as string, 'http://x').searchParams.get('cursor'),
    ).toBe('cursor-2')
    // Every booking survived, in order — none dropped at the page boundary.
    expect(rows.map((r) => r.id)).toEqual(Array.from({ length: 130 }, (_, i) => `bk-${i}`))
  })
})

describe('operatorCalendarQueryOptions', () => {
  it('keys by the calendar range (from + to), with a null picked-operator slot by default', () => {
    expect(operatorCalendarQueryOptions('2026-07-01', '2026-07-31').queryKey).toEqual([
      'operator-bookings',
      'calendar',
      '2026-07-01',
      '2026-07-31',
      null,
    ])
  })
})

// #525: the calendar reads the operator's own vehicles ({id,name}) from the
// tenant-scoped GET /vehicles for its day-view columns + sidebar filter. It must
// degrade to [] on failure so a vehicle-list error never blanks the bookings.

describe('fetchCalendarVehicles', () => {
  it('requests the operator vehicles with a bounded limit and credentials', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: [] }))
    vi.stubGlobal('fetch', fetchMock)

    await fetchCalendarVehicles()

    const [url, init] = fetchMock.mock.calls[0]!
    const parsed = new URL(url as string, 'http://x')
    expect(parsed.pathname).toBe('/api/vehicles')
    expect(parsed.searchParams.get('limit')).toBe('100')
    expect((init as RequestInit).credentials).toBe('include')
  })

  it('maps rows to {id, name} only', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          success: true,
          data: [{ id: 'veh-1', name: 'Toyota Aqua', status: 'ACTIVE', seats: 5 }],
        }),
      ),
    )

    const vehicles = await fetchCalendarVehicles()
    expect(vehicles).toEqual([{ id: 'veh-1', name: 'Toyota Aqua' }])
  })

  it('degrades to [] on a failure envelope (must not blank the calendar)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ success: false, error: 'Forbidden' }, 403)),
    )

    expect(await fetchCalendarVehicles()).toEqual([])
  })

  it('degrades to [] when the request itself rejects (network error)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('network down')
      }),
    )

    expect(await fetchCalendarVehicles()).toEqual([])
  })
})

describe('operatorCalendarVehiclesQueryOptions', () => {
  it('keys by the calendar vehicles list', () => {
    expect(operatorCalendarVehiclesQueryOptions().queryKey).toEqual([
      'operator-bookings',
      'calendar',
      'vehicles',
      null,
    ])
  })
})

// Slice 2 (#616): operator booking actions — substitution candidates + the
// CSRF-gated status mutations the BookingActionsPanel + SubstituteVehicleDialog
// drive (no optimistic UI; the component invalidates the `operator-bookings`
// prefix on success). Vehicle substitution itself shipped with #610 below.

describe('fetchSubstitutionCandidates', () => {
  it('GETs the operator-only candidates endpoint with credentials and maps to {id,name,plate}', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        success: true,
        data: [{ id: 'veh-2', name: 'Honda Fit', licensePlate: 'OSAKA 1234', status: 'AVAILABLE' }],
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const candidates = await fetchSubstitutionCandidates('bk-1')

    const [url, init] = fetchMock.mock.calls[0]!
    expect(new URL(url as string, 'http://x').pathname).toBe(
      '/api/bookings/bk-1/substitution-candidates',
    )
    expect((init as RequestInit).credentials).toBe('include')
    expect(candidates).toEqual([{ id: 'veh-2', name: 'Honda Fit', licensePlate: 'OSAKA 1234' }])
  })

  it('defaults licensePlate to null when the field is absent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ success: true, data: [{ id: 'veh-2', name: 'Honda Fit' }] }),
      ),
    )

    const [candidate] = await fetchSubstitutionCandidates('bk-1')
    expect(candidate).toEqual({ id: 'veh-2', name: 'Honda Fit', licensePlate: null })
  })

  it('encodes the booking id into the path', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: [] }))
    vi.stubGlobal('fetch', fetchMock)

    await fetchSubstitutionCandidates('a/b')

    const [url] = fetchMock.mock.calls[0]!
    expect(new URL(url as string, 'http://x').pathname).toBe(
      '/api/bookings/a%2Fb/substitution-candidates',
    )
  })

  it('throws ApiError on a failure envelope (e.g. a renter 403)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ success: false, error: 'Only operators' }, 403)),
    )

    await expect(fetchSubstitutionCandidates('bk-1')).rejects.toBeInstanceOf(ApiError)
  })
})

describe('substitutionCandidatesQueryOptions', () => {
  it('keys by the booking substitution-candidates id', () => {
    expect(substitutionCandidatesQueryOptions('bk-1').queryKey).toEqual([
      'operator-bookings',
      'substitution-candidates',
      'bk-1',
    ])
  })
})

describe('updateBookingStatus', () => {
  it('PATCHes /bookings/:id/status with the status body, CSRF + JSON headers, credentials', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ success: true, data: bookingRaw({ status: 'ACTIVE' }) }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await updateBookingStatus('bk-1', 'ACTIVE', 'csrf-1')

    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit]
    expect(new URL(url, 'http://x').pathname).toBe('/api/bookings/bk-1/status')
    // #1361: a tenant operator (no pick) must NOT append operatorId — an always-append
    // mutation would send `operatorId=undefined`, which pathname-only checks miss.
    expect(new URL(url, 'http://x').searchParams.has('operatorId')).toBe(false)
    expect(init.method).toBe('PATCH')
    expect(init.credentials).toBe('include')
    expect(init.headers).toEqual({ 'Content-Type': 'application/json', 'X-CSRF-Token': 'csrf-1' })
    expect(JSON.parse(init.body as string)).toEqual({ status: 'ACTIVE' })
    expect(result).toMatchObject({ id: 'bk-1', status: 'ACTIVE' })
  })

  it('throws ApiError on an invalid-transition 400', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(
          { success: false, error: 'Invalid status transition from COMPLETED to ACTIVE' },
          400,
        ),
      ),
    )

    await expect(updateBookingStatus('bk-1', 'ACTIVE', 'csrf')).rejects.toThrow(
      'Invalid status transition',
    )
  })

  it('appends ?operatorId= when a picker admin acts as an operator (#1361)', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ success: true, data: bookingRaw({ status: 'ACTIVE' }) }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await updateBookingStatus('bk-1', 'ACTIVE', 'csrf-1', 'op_7')

    const [url] = fetchMock.mock.calls[0]! as [string, RequestInit]
    expect(new URL(url, 'http://x').searchParams.get('operatorId')).toBe('op_7')
  })
})

describe('cancelBooking', () => {
  it('POSTs /bookings/:id/cancel with the CSRF header and no body', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        success: true,
        data: bookingRaw({ status: 'CANCELLED' }),
        cancellation: { feeJpy: 0 },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await cancelBooking('bk-1', 'csrf-2')

    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit]
    expect(new URL(url, 'http://x').pathname).toBe('/api/bookings/bk-1/cancel')
    // #1361: no pick -> no operatorId (see updateBookingStatus note above).
    expect(new URL(url, 'http://x').searchParams.has('operatorId')).toBe(false)
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('include')
    expect(init.headers).toEqual({ 'X-CSRF-Token': 'csrf-2' })
    expect(init.body).toBeUndefined()
    expect(result).toMatchObject({ id: 'bk-1', status: 'CANCELLED' })
  })

  it('appends ?operatorId= when a picker admin acts as an operator (#1361)', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ success: true, data: bookingRaw({ status: 'CANCELLED' }) }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await cancelBooking('bk-1', 'csrf-2', 'op_7')

    const [url] = fetchMock.mock.calls[0]! as [string, RequestInit]
    expect(new URL(url, 'http://x').searchParams.get('operatorId')).toBe('op_7')
  })
})

// #610: operator vehicle substitution. POST /bookings/:id/substitute swaps the
// assigned car for another AVAILABLE same-class, same-location vehicle. Cookie +
// CSRF-gated (global csrf()), so the caller echoes the session CSRF token.
describe('substituteBooking', () => {
  it('POSTs the substitute endpoint with the new vehicle id, reason, csrf header and credentials', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: detailRaw() }))
    vi.stubGlobal('fetch', fetchMock)

    await substituteBooking('bk-1', 'veh-2', 'engine fault', 'csrf-tok')

    const [url, init] = fetchMock.mock.calls[0]!
    const parsed = new URL(url as string, 'http://x')
    expect(parsed.pathname).toBe('/api/bookings/bk-1/substitute')
    const request = init as RequestInit
    expect(request.method).toBe('POST')
    expect(request.credentials).toBe('include')
    expect((request.headers as Record<string, string>)['X-CSRF-Token']).toBe('csrf-tok')
    expect(JSON.parse(request.body as string)).toEqual({
      newVehicleId: 'veh-2',
      reason: 'engine fault',
    })
  })

  it('omits the reason field when none is given (schema reason is optional)', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: detailRaw() }))
    vi.stubGlobal('fetch', fetchMock)

    await substituteBooking('bk-1', 'veh-2', null, 'csrf-tok')

    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string)
    expect(body).toEqual({ newVehicleId: 'veh-2' })
  })

  it('throws ApiError on a domain failure (e.g. 409 replacement just booked)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ success: false, error: 'Vehicle already booked' }, 409)),
    )

    await expect(substituteBooking('bk-1', 'veh-2', null, 'csrf-tok')).rejects.toBeInstanceOf(
      ApiError,
    )
  })
})

// #589 1d (slice 2): operator manual booking — the walk-in path. POST /bookings
// with an inline `walkInCustomer {name, phone}` (no email — the #396/#475
// enumeration defense) and `source=MANUAL` (the route honors a manual booker's
// source; default DIRECT would mislabel it). No `renterId` (mutually exclusive
// with walkInCustomer) and no `disclaimerAccepted` (operators are consent-exempt;
// only a RENTER self-serve booking must accept). CSRF-gated like every cookie write.
describe('createManualBooking', () => {
  const walkInInput = {
    requestedVehicleId: 'veh-1',
    pickupLocationId: 'loc-1',
    dropoffLocationId: 'loc-1',
    startAt: '2026-07-01T01:00:00.000Z',
    endAt: '2026-07-03T01:00:00.000Z',
    customer: { kind: 'walk-in' as const, name: 'Taro Yamada', phone: '+81 90 1234 5678' },
    idempotencyKey: '11111111-2222-4333-8444-555555555555',
  }

  it('POSTs /bookings with the walk-in body, source MANUAL, CSRF + JSON headers, credentials', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ success: true, data: bookingRaw({ source: 'MANUAL' }) }, 201),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await createManualBooking(walkInInput, 'csrf-tok')

    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit]
    expect(new URL(url, 'http://x').pathname).toBe('/api/bookings')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('include')
    expect(init.headers).toEqual({ 'Content-Type': 'application/json', 'X-CSRF-Token': 'csrf-tok' })
    // The whole body is pinned: walkInCustomer (not renterId), source MANUAL, the
    // pickup/dropoff pair, ISO times — and NO disclaimerAccepted key.
    expect(JSON.parse(init.body as string)).toEqual({
      requestedVehicleId: 'veh-1',
      pickupLocationId: 'loc-1',
      dropoffLocationId: 'loc-1',
      startAt: '2026-07-01T01:00:00.000Z',
      endAt: '2026-07-03T01:00:00.000Z',
      source: 'MANUAL',
      walkInCustomer: { name: 'Taro Yamada', phone: '+81 90 1234 5678' },
      idempotencyKey: '11111111-2222-4333-8444-555555555555',
    })
    expect(result).toMatchObject({ id: 'bk-1', source: 'MANUAL' })
  })

  it('POSTs an EXISTING-customer body with renterId and NO walkInCustomer', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ success: true, data: bookingRaw({ source: 'MANUAL' }) }, 201),
    )
    vi.stubGlobal('fetch', fetchMock)

    await createManualBooking(
      { ...walkInInput, customer: { kind: 'existing', renterId: 'r-9' } },
      'csrf-tok',
    )

    const [, init] = fetchMock.mock.calls[0]! as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    // The XOR is honored on the wire: renterId present, walkInCustomer absent —
    // mirroring the server's mutually-exclusive customer-source refine.
    expect(body).toEqual({
      requestedVehicleId: 'veh-1',
      pickupLocationId: 'loc-1',
      dropoffLocationId: 'loc-1',
      startAt: '2026-07-01T01:00:00.000Z',
      endAt: '2026-07-03T01:00:00.000Z',
      source: 'MANUAL',
      renterId: 'r-9',
      idempotencyKey: '11111111-2222-4333-8444-555555555555',
    })
    expect(body).not.toHaveProperty('walkInCustomer')
  })

  it('throws ApiError on a domain failure (e.g. 409 vehicle just booked)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ success: false, error: 'Vehicle already booked' }, 409)),
    )

    await expect(createManualBooking(walkInInput, 'csrf-tok')).rejects.toBeInstanceOf(ApiError)
  })

  it('rejects with ParseError when the created booking drifts', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ success: true, data: bookingRaw({ totalPrice: 'lots' }) })),
    )

    await expect(createManualBooking(walkInInput, 'csrf-tok')).rejects.toBeInstanceOf(ParseError)
  })
})

// #589 1d (slice 3): the manual-booking dialog can attach an EXISTING renter.
// searchCustomers reads the one operator-reachable customer route — the server
// scopes an OPERATOR_* caller to its own prior renters, so the client sends only
// the query `q` (a cross-tenant or global-enumeration read is impossible here).
describe('searchCustomers', () => {
  it('GETs /customers/search?q= with credentials and maps to {id,name,email,phone}', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        success: true,
        data: [
          {
            id: 'r-9',
            name: 'Tanaka Hiro',
            email: 'tanaka@example.com',
            phone: '+81-90-1234-5678',
          },
        ],
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const results = await searchCustomers('tanaka')

    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit]
    const parsed = new URL(url, 'http://x')
    expect(parsed.pathname).toBe('/api/customers/search')
    expect(parsed.searchParams.get('q')).toBe('tanaka')
    expect(init.credentials).toBe('include')
    expect(results).toEqual([
      { id: 'r-9', name: 'Tanaka Hiro', email: 'tanaka@example.com', phone: '+81-90-1234-5678' },
    ])
  })

  it('url-encodes a query with spaces and slashes', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: [] }))
    vi.stubGlobal('fetch', fetchMock)

    await searchCustomers('a b/c')

    const [url] = fetchMock.mock.calls[0]!
    expect(new URL(url as string, 'http://x').searchParams.get('q')).toBe('a b/c')
  })

  it('tolerates null name/email/phone (phone-only or nameless rows)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          success: true,
          data: [{ id: 'r-1', name: null, email: null, phone: '+81-1' }],
        }),
      ),
    )

    const [customer] = await searchCustomers('x')
    expect(customer).toEqual({ id: 'r-1', name: null, email: null, phone: '+81-1' })
  })

  it('throws ApiError on a failure envelope (renter 403 / too-short 400)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ success: false, error: 'Forbidden' }, 403)),
    )

    await expect(searchCustomers('ab')).rejects.toBeInstanceOf(ApiError)
  })

  it('rejects with ParseError when a row drifts (missing id)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ success: true, data: [{ name: 'No Id', email: null, phone: null }] }),
      ),
    )

    await expect(searchCustomers('ab')).rejects.toBeInstanceOf(ParseError)
  })
})

describe('customerSearchQueryOptions', () => {
  it('keys by the query (+ picked operator) and is enabled only at >=2 non-space chars', () => {
    const opts = customerSearchQueryOptions('tan')
    expect(opts.queryKey).toEqual(['operator-bookings', 'customer-search', 'tan', null])
    expect(opts.enabled).toBe(true)
    // #1260: the picked operator joins the key so switching operators refetches.
    expect(customerSearchQueryOptions('tan', 'op-7').queryKey).toEqual([
      'operator-bookings',
      'customer-search',
      'tan',
      'op-7',
    ])
    expect(customerSearchQueryOptions(' a ').enabled).toBe(false)
    expect(customerSearchQueryOptions('').enabled).toBe(false)
  })
})

// #711 (3b): each read/write now validates its response body at the seam, so a
// drifted field (renamed/wrong-typed) throws a ParseError here instead of
// surfacing as `undefined` deep in the calendar / timeline / actions panel.
describe('response validation (#711)', () => {
  it('fetchOperatorBookingDetail rejects with ParseError when the booking drifts', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ success: true, data: detailRaw({ totalPrice: 'lots' }) })),
    )
    await expect(fetchOperatorBookingDetail('bk-1')).rejects.toBeInstanceOf(ParseError)
  })

  it('fetchCalendarBookings rejects with ParseError when a row drifts', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          success: true,
          data: [calendarRaw({ totalPrice: 'lots' })],
          nextCursor: null,
        }),
      ),
    )
    await expect(fetchCalendarBookings('a', 'b')).rejects.toBeInstanceOf(ParseError)
  })

  it('fetchBookingEvents rejects with ParseError when the payload discriminant is unknown', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ success: true, data: [eventRaw({ payload: { type: 'NOT_A_KIND' } })] }),
      ),
    )
    await expect(fetchBookingEvents('bk-1')).rejects.toBeInstanceOf(ParseError)
  })

  it('fetchBookingEvents parses a VEHICLE_ASSIGNED first-assign payload (null→car)', async () => {
    const payload = {
      type: 'VEHICLE_ASSIGNED',
      fromVehicleId: null,
      toVehicleId: 'v-2',
      reason: null,
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ success: true, data: [eventRaw({ type: 'VEHICLE_ASSIGNED', payload })] }),
      ),
    )
    const events = await fetchBookingEvents('bk-1')
    expect(events[0]!.payload).toEqual(payload)
  })

  it('fetchBookingEvents parses a VEHICLE_ASSIGNED swap payload (car→car with reason)', async () => {
    const payload = {
      type: 'VEHICLE_ASSIGNED',
      fromVehicleId: 'v-1',
      toVehicleId: 'v-2',
      reason: 'Customer upgrade request',
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ success: true, data: [eventRaw({ type: 'VEHICLE_ASSIGNED', payload })] }),
      ),
    )
    const events = await fetchBookingEvents('bk-1')
    expect(events[0]!.payload).toEqual(payload)
  })

  it('fetchSubstitutionCandidates rejects with ParseError when a candidate drifts', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ success: true, data: [{ id: 'veh-2', name: 123 }] })),
    )
    await expect(fetchSubstitutionCandidates('bk-1')).rejects.toBeInstanceOf(ParseError)
  })

  it('updateBookingStatus rejects with ParseError when the write body has an invalid status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ success: true, data: bookingRaw({ status: 'PENDING' }) })),
    )
    await expect(updateBookingStatus('bk-1', 'ACTIVE', 'csrf')).rejects.toBeInstanceOf(ParseError)
  })

  it('fetchCalendarVehicles degrades to [] when a row drifts (validation error is caught)', async () => {
    // The calendar must never blank on a vehicle-list error, so a ParseError here
    // is swallowed by the same guard that catches network failures — proven by the
    // empty result (the un-validated code would have returned the drifted row).
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ success: true, data: [{ id: 5, name: 'x' }] })),
    )
    expect(await fetchCalendarVehicles()).toEqual([])
  })
})
