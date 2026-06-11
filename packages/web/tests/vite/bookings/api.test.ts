import { ApiError } from '@/lib/api-error'
import {
  createBooking,
  fetchBookingById,
  fetchMyBookings,
  myBookingsQueryOptions,
} from '@/vite/bookings/api'
import { afterEach, describe, expect, it, vi } from 'vitest'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const sampleBooking = {
  id: 'b-1',
  bookingCode: 'ABCD1234',
  renterId: 'r1',
  classId: 'c1',
  requestedVehicleId: 'v1',
  assignedVehicleId: 'v1',
  pickupLocationId: 'loc1',
  dropoffLocationId: 'loc1',
  startAt: '2026-07-01T01:00:00.000Z',
  endAt: '2026-07-03T01:00:00.000Z',
  effectiveEndAt: '2026-07-03T01:00:00.000Z',
  status: 'CONFIRMED' as const,
  source: 'DIRECT',
  insuranceOptionId: null,
  insuranceSnapshot: null,
  feeSnapshot: [],
  addOnSnapshot: [],
  totalPrice: 20000,
  notes: null,
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
}

const baseInput = {
  requestedVehicleId: 'v1',
  pickupLocationId: 'loc1',
  dropoffLocationId: 'loc1',
  startAt: '2026-07-01T01:00:00.000Z',
  endAt: '2026-07-03T01:00:00.000Z',
  addOnIds: [] as string[],
  insuranceOptionId: null as string | null,
  idempotencyKey: 'idem-1',
}

describe('createBooking', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs /api/bookings with credentials, the CSRF header, and the renter selection', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: sampleBooking }, 201))
    vi.stubGlobal('fetch', fetchMock)

    const result = await createBooking(
      { ...baseInput, insuranceOptionId: 'i1', addOnIds: ['a1', 'a2'] },
      'csrf-7',
    )

    expect(result).toEqual(sampleBooking)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/bookings')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('include')
    expect(init.headers).toMatchObject({
      'X-CSRF-Token': 'csrf-7',
      'Content-Type': 'application/json',
    })
    expect(JSON.parse(init.body as string)).toEqual({
      requestedVehicleId: 'v1',
      pickupLocationId: 'loc1',
      dropoffLocationId: 'loc1',
      startAt: '2026-07-01T01:00:00.000Z',
      endAt: '2026-07-03T01:00:00.000Z',
      insuranceOptionId: 'i1',
      addOnIds: ['a1', 'a2'],
      idempotencyKey: 'idem-1',
    })
  })

  it('omits insuranceOptionId from the body when the renter declines coverage', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: sampleBooking }, 201))
    vi.stubGlobal('fetch', fetchMock)

    await createBooking({ ...baseInput, insuranceOptionId: null, addOnIds: [] }, 'c')

    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string)
    expect(body).not.toHaveProperty('insuranceOptionId')
    expect(body.addOnIds).toEqual([])
  })

  it('throws an ApiError carrying status 409 when the vehicle was just taken', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ success: false, error: 'Vehicle is already booked' }, 409)),
    )
    await expect(createBooking(baseInput, 'c')).rejects.toMatchObject({ status: 409 })
  })

  it('throws an ApiError carrying status 400 on a domain rejection', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ success: false, error: 'Vehicle is not available' }, 400)),
    )
    await expect(createBooking(baseInput, 'c')).rejects.toMatchObject({ status: 400 })
  })

  it('throws an ApiError carrying status 403 when document verification is required', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ success: false, error: 'Document verification required' }, 403),
      ),
    )
    await expect(createBooking(baseInput, 'c')).rejects.toMatchObject({ status: 403 })
  })
})

describe('fetchBookingById', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('GETs /api/bookings/:id with credentials and unwraps the booking', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: sampleBooking }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchBookingById('b-1')).resolves.toEqual(sampleBooking)
    expect(fetchMock).toHaveBeenCalledWith('/api/bookings/b-1', { credentials: 'include' })
  })

  it('returns null on a 404 so the route renders notFound() instead of an error boundary', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ success: false, error: 'Booking not found' }, 404)),
    )
    await expect(fetchBookingById('missing')).resolves.toBeNull()
  })

  it('throws (not null) on a non-404 failure so real errors surface', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ success: false, error: 'boom' }, 500)),
    )
    await expect(fetchBookingById('b-1')).rejects.toMatchObject({ status: 500 })
  })
})

// "My Bookings" (#543): the caller's own bookings, expanded with the assigned
// vehicle. The query is principal-identical — `renterId=self` means "bookings
// where I am the renter" for any caller, not "bookings in my tenant".
const rawMyBooking = (over: Record<string, unknown> = {}) => ({
  id: 'bk-1',
  bookingCode: 'ABCD2345',
  status: 'CONFIRMED',
  startAt: '2026-07-01T01:00:00.000Z',
  endAt: '2026-07-03T01:00:00.000Z',
  totalPrice: 24000,
  vehicle: { name: 'Toyota Aqua', photos: ['a.jpg'] },
  ...over,
})

describe('fetchMyBookings', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('GETs /api/bookings?expand=vehicle&renterId=<self> with credentials', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: [], nextCursor: null }))
    vi.stubGlobal('fetch', fetchMock)

    await fetchMyBookings('me-42')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const parsed = new URL(url, 'http://x')
    expect(parsed.pathname).toBe('/api/bookings')
    expect(parsed.searchParams.get('expand')).toBe('vehicle')
    expect(parsed.searchParams.get('renterId')).toBe('me-42')
    expect(init.credentials).toBe('include')
  })

  it('maps the envelope to rows, flattening the expanded vehicle name', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ success: true, data: [rawMyBooking()], nextCursor: null })),
    )

    const rows = await fetchMyBookings('me-42')

    expect(rows).toEqual([
      {
        id: 'bk-1',
        bookingCode: 'ABCD2345',
        status: 'CONFIRMED',
        startAt: '2026-07-01T01:00:00.000Z',
        endAt: '2026-07-03T01:00:00.000Z',
        totalPrice: 24000,
        vehicleName: 'Toyota Aqua',
      },
    ])
  })

  it('normalizes a missing vehicle expansion to null', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          success: true,
          data: [rawMyBooking({ vehicle: undefined })],
          nextCursor: null,
        }),
      ),
    )

    const [row] = await fetchMyBookings('me-42')
    expect(row!.vehicleName).toBeNull()
  })

  it('throws ApiError on a failure envelope', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ success: false, error: 'Unauthorized' }, 401)),
    )

    await expect(fetchMyBookings('me-42')).rejects.toBeInstanceOf(ApiError)
  })
})

describe('myBookingsQueryOptions', () => {
  it('keys by the renter so two principals never collide on cache', () => {
    expect(myBookingsQueryOptions('me-42').queryKey).toEqual(['bookings', 'mine', 'me-42'])
  })
})
