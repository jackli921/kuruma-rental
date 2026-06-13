import { ApiError } from '@/lib/api-error'
import {
  type OperatorBookingDetailDto,
  bookingEventsQueryOptions,
  fetchBookingEvents,
  fetchCalendarBookings,
  fetchOperatorBookingDetail,
  fetchOperatorBookings,
  operatorBookingDetailQueryOptions,
  operatorBookingsQueryOptions,
  operatorCalendarQueryOptions,
  operatorRowFromDetail,
  substituteBooking,
} from '@/vite/operator-bookings/api'
import { afterEach, describe, expect, it, vi } from 'vitest'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const rawBooking = (over: Record<string, unknown> = {}) => ({
  id: 'bk-1',
  operatorId: 'op-1',
  renterId: 'r-1',
  assignedVehicleId: 'veh-1',
  bookingCode: 'ABCD2345',
  status: 'CONFIRMED',
  startAt: '2026-07-01T01:00:00.000Z',
  endAt: '2026-07-03T01:00:00.000Z',
  totalPrice: 24000,
  vehicle: { name: 'Toyota Aqua', photos: ['a.jpg'] },
  renter: { id: 'r-1', name: 'Jane', email: 'jane@example.com', language: 'en' },
  ...over,
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('fetchOperatorBookings', () => {
  it('requests the operator-scoped list expanding vehicle and renter, with credentials', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: [], nextCursor: null }))
    vi.stubGlobal('fetch', fetchMock)

    await fetchOperatorBookings()

    const [url, init] = fetchMock.mock.calls[0]!
    const parsed = new URL(url as string, 'http://x')
    expect(parsed.pathname).toBe('/api/bookings')
    expect(parsed.searchParams.get('expand')).toBe('vehicle,renter')
    expect((init as RequestInit).credentials).toBe('include')
  })

  it('maps the envelope to rows (code, status, range, total, vehicle name, renter)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ success: true, data: [rawBooking()], nextCursor: null })),
    )

    const rows = await fetchOperatorBookings()

    expect(rows).toEqual([
      {
        id: 'bk-1',
        bookingCode: 'ABCD2345',
        status: 'CONFIRMED',
        startAt: '2026-07-01T01:00:00.000Z',
        endAt: '2026-07-03T01:00:00.000Z',
        totalPrice: 24000,
        vehicleName: 'Toyota Aqua',
        renter: { id: 'r-1', name: 'Jane', email: 'jane@example.com' },
      },
    ])
  })

  it('passes through an optional status filter', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: [], nextCursor: null }))
    vi.stubGlobal('fetch', fetchMock)

    await fetchOperatorBookings({ status: 'ACTIVE' })

    const parsed = new URL(fetchMock.mock.calls[0]![0] as string, 'http://x')
    expect(parsed.searchParams.get('status')).toBe('ACTIVE')
  })

  it('normalizes a missing vehicle expansion to null', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          success: true,
          data: [rawBooking({ vehicle: undefined })],
          nextCursor: null,
        }),
      ),
    )

    const [row] = await fetchOperatorBookings()
    expect(row!.vehicleName).toBeNull()
  })

  it('normalizes a missing renter expansion to null', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          success: true,
          data: [rawBooking({ renter: undefined })],
          nextCursor: null,
        }),
      ),
    )

    const [row] = await fetchOperatorBookings()
    expect(row!.renter).toBeNull()
  })

  it('throws ApiError on a failure envelope', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ success: false, error: 'Unauthorized' }, 401)),
    )

    await expect(fetchOperatorBookings()).rejects.toBeInstanceOf(ApiError)
  })
})

describe('operatorBookingsQueryOptions', () => {
  it('keys by the operator-bookings list and the status + limit filters', () => {
    expect(operatorBookingsQueryOptions().queryKey).toEqual([
      'operator-bookings',
      undefined,
      undefined,
    ])
    expect(operatorBookingsQueryOptions({ status: 'ACTIVE', limit: 50 }).queryKey).toEqual([
      'operator-bookings',
      'ACTIVE',
      50,
    ])
  })
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

// Slice 6 (#610): operator vehicle substitution — POST /bookings/:id/substitute,
// cookie-authed + CSRF-gated, returns the re-assigned booking.
describe('substituteBooking', () => {
  it('POSTs to the substitute endpoint with the CSRF header, JSON body and credentials', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: detailRaw() }))
    vi.stubGlobal('fetch', fetchMock)

    await substituteBooking('bk-1', 'veh-9', 'mechanical fault', 'csrf-token')

    const [url, init] = fetchMock.mock.calls[0]!
    const request = init as RequestInit
    expect(new URL(url as string, 'http://x').pathname).toBe('/api/bookings/bk-1/substitute')
    expect(request.method).toBe('POST')
    expect(request.credentials).toBe('include')
    expect(new Headers(request.headers).get('X-CSRF-Token')).toBe('csrf-token')
    expect(JSON.parse(request.body as string)).toEqual({
      newVehicleId: 'veh-9',
      reason: 'mechanical fault',
    })
  })

  it('omits an empty reason from the body (sends only newVehicleId)', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: detailRaw() }))
    vi.stubGlobal('fetch', fetchMock)

    await substituteBooking('bk-1', 'veh-9', '', 'csrf-token')

    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toEqual({
      newVehicleId: 'veh-9',
    })
  })

  it('returns the re-assigned booking from the envelope', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ success: true, data: detailRaw({ assignedVehicleId: 'veh-9' }) }),
      ),
    )

    const booking = await substituteBooking('bk-1', 'veh-9', '', 't')

    expect(booking).toMatchObject({ id: 'bk-1', assignedVehicleId: 'veh-9' })
  })

  it('throws ApiError when the replacement was just booked (409)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ success: false, error: 'Vehicle is no longer available' }, 409),
      ),
    )

    await expect(substituteBooking('bk-1', 'veh-9', '', 't')).rejects.toBeInstanceOf(ApiError)
  })
})
