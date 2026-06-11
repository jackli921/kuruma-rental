import { createBooking, fetchBookingById } from '@/vite/bookings/api'
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
