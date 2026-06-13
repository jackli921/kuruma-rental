import { ApiError } from '@/lib/api-error'
import {
  type OperatorBookingDetailDto,
  bookingEventsQueryOptions,
  cancelBooking,
  fetchBookingEvents,
  fetchCalendarBookings,
  fetchCalendarVehicles,
  fetchOperatorBookingDetail,
  fetchPendingBookingsCount,
  fetchSubstitutionCandidates,
  operatorBookingDetailQueryOptions,
  operatorCalendarQueryOptions,
  operatorCalendarVehiclesQueryOptions,
  operatorRowFromDetail,
  pendingBookingsCountQueryOptions,
  substituteVehicle,
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

const detailRaw = (over: Record<string, unknown> = {}) => ({
  id: 'bk-1',
  bookingCode: 'ABCD2345',
  renterId: 'r-1',
  status: 'CONFIRMED',
  startAt: '2026-07-01T01:00:00.000Z',
  endAt: '2026-07-03T01:00:00.000Z',
  totalPrice: 24000,
  insuranceSnapshot: null,
  feeSnapshot: [],
  addOnSnapshot: [],
  notes: null,
  operator: { name: 'Op', preAuthHandoffUrl: null },
  vehicle: { name: 'Toyota Aqua', photos: ['a.jpg'] },
  renter: { id: 'r-1', name: 'Jane', email: 'jane@example.com', language: 'en' },
  ...over,
})

const eventRaw = (over: Record<string, unknown> = {}) => ({
  id: 'evt-1',
  type: 'BOOKING_CREATED',
  payload: { from: 'CONFIRMED', to: 'ACTIVE' },
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

// Slice 2 (#616): operator booking actions — substitution candidates, the
// pending-orders count for the nav badge, and the CSRF-gated mutations the
// BookingActionsPanel + SubstituteVehicleDialog drive (no optimistic UI; the
// component invalidates the `operator-bookings` prefix on success).

describe('fetchSubstitutionCandidates', () => {
  it('GETs the operator-only candidates endpoint with credentials and maps to {id,name}', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        success: true,
        data: [{ id: 'veh-2', name: 'Honda Fit', status: 'AVAILABLE', classId: 'c-1' }],
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const candidates = await fetchSubstitutionCandidates('bk-1')

    const [url, init] = fetchMock.mock.calls[0]!
    expect(new URL(url as string, 'http://x').pathname).toBe(
      '/api/bookings/bk-1/substitution-candidates',
    )
    expect((init as RequestInit).credentials).toBe('include')
    expect(candidates).toEqual([{ id: 'veh-2', name: 'Honda Fit' }])
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

describe('fetchPendingBookingsCount', () => {
  it('GETs CONFIRMED bookings with a bounded limit and returns the row count', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ success: true, data: [{ id: 'a' }, { id: 'b' }], nextCursor: null }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const count = await fetchPendingBookingsCount()

    const [url, init] = fetchMock.mock.calls[0]!
    const parsed = new URL(url as string, 'http://x')
    expect(parsed.pathname).toBe('/api/bookings')
    expect(parsed.searchParams.get('status')).toBe('CONFIRMED')
    expect(parsed.searchParams.get('limit')).toBe('50')
    expect((init as RequestInit).credentials).toBe('include')
    expect(count).toBe(2)
  })

  it('throws ApiError on a failure envelope', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ success: false, error: 'Unauthorized' }, 401)),
    )

    await expect(fetchPendingBookingsCount()).rejects.toBeInstanceOf(ApiError)
  })
})

describe('pendingBookingsCountQueryOptions', () => {
  it('keys by the pending-count list', () => {
    expect(pendingBookingsCountQueryOptions().queryKey).toEqual([
      'operator-bookings',
      'pending-count',
    ])
  })
})

describe('updateBookingStatus', () => {
  it('PATCHes /bookings/:id/status with the status body, CSRF + JSON headers, credentials', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ success: true, data: { id: 'bk-1', status: 'ACTIVE' } }),
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
        data: { id: 'bk-1', status: 'CANCELLED' },
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

describe('substituteVehicle', () => {
  it('POSTs /bookings/:id/substitute with newVehicleId + reason, CSRF + JSON headers', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ success: true, data: { id: 'bk-1', assignedVehicleId: 'veh-2' } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await substituteVehicle('bk-1', 'veh-2', 'Customer requested SUV', 'csrf-3')

    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit]
    expect(new URL(url, 'http://x').pathname).toBe('/api/bookings/bk-1/substitute')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ 'Content-Type': 'application/json', 'X-CSRF-Token': 'csrf-3' })
    expect(JSON.parse(init.body as string)).toEqual({
      newVehicleId: 'veh-2',
      reason: 'Customer requested SUV',
    })
  })

  it('omits reason from the body when null', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: { id: 'bk-1' } }))
    vi.stubGlobal('fetch', fetchMock)

    await substituteVehicle('bk-1', 'veh-2', null, 'csrf')

    const [, init] = fetchMock.mock.calls[0]! as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({ newVehicleId: 'veh-2' })
  })
})
