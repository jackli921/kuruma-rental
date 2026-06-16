import { ApiError, ParseError } from '@/lib/api-error'
import {
  type OperatorBookingDetailDto,
  bookingEventsQueryOptions,
  cancelBooking,
  createManualBooking,
  fetchBookingEvents,
  fetchCalendarBookings,
  fetchCalendarVehicles,
  fetchOperatorBookingDetail,
  fetchSubstitutionCandidates,
  operatorBookingDetailQueryOptions,
  operatorCalendarQueryOptions,
  operatorCalendarVehiclesQueryOptions,
  operatorRowFromDetail,
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
})

describe('operatorCalendarQueryOptions', () => {
  it('keys by the calendar range (from + to)', () => {
    expect(operatorCalendarQueryOptions('2026-07-01', '2026-07-31').queryKey).toEqual([
      'operator-bookings',
      'calendar',
      '2026-07-01',
      '2026-07-31',
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
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('include')
    expect(init.headers).toEqual({ 'X-CSRF-Token': 'csrf-2' })
    expect(init.body).toBeUndefined()
    expect(result).toMatchObject({ id: 'bk-1', status: 'CANCELLED' })
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
    })
    expect(result).toMatchObject({ id: 'bk-1', source: 'MANUAL' })
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
