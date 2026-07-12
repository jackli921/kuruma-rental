import { bookingEventSchema, operatorBookingDetailSchema } from '@/vite/operator-bookings/schema'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bookingDtoSchema, createBooking, fetchBookingDetail } from './api'

// Minimal valid SPECIFIC booking — all required fields, both vehicle ids present.
const baseBooking = {
  id: '00000000-0000-0000-0000-000000000001',
  bookingCode: 'KRM-0001',
  renterId: '00000000-0000-0000-0000-000000000002',
  classId: null,
  requestedVehicleId: '00000000-0000-0000-0000-000000000010',
  assignedVehicleId: '00000000-0000-0000-0000-000000000010',
  pickupLocationId: '00000000-0000-0000-0000-000000000020',
  dropoffLocationId: '00000000-0000-0000-0000-000000000020',
  startAt: '2026-07-01T09:00:00.000Z',
  endAt: '2026-07-03T09:00:00.000Z',
  effectiveEndAt: '2026-07-03T09:00:00.000Z',
  status: 'CONFIRMED' as const,
  source: 'WEB',
  insuranceOptionId: null,
  insuranceSnapshot: null,
  feeSnapshot: [],
  addOnSnapshot: [],
  totalPrice: 20000,
  notes: null,
  createdAt: '2026-07-01T08:00:00.000Z',
  updatedAt: '2026-07-01T08:00:00.000Z',
}

// CLASS_COMBO float: renter picked class + location; vehicle ids are null until assigned.
const comboBooking = {
  ...baseBooking,
  requestedVehicleId: null,
  assignedVehicleId: null,
  classId: '00000000-0000-0000-0000-000000000099',
}

describe('bookingDtoSchema — #464 CLASS_COMBO null vehicle ids', () => {
  it('parses a SPECIFIC booking with non-null vehicle ids', () => {
    const result = bookingDtoSchema.parse(baseBooking)
    expect(result.requestedVehicleId).toBe(baseBooking.requestedVehicleId)
    expect(result.assignedVehicleId).toBe(baseBooking.assignedVehicleId)
  })

  it('parses a CLASS_COMBO booking with null vehicle ids', () => {
    expect(() => bookingDtoSchema.parse(comboBooking)).not.toThrow()
    const result = bookingDtoSchema.parse(comboBooking)
    expect(result.requestedVehicleId).toBeNull()
    expect(result.assignedVehicleId).toBeNull()
  })
})

describe('operatorBookingDetailSchema — #464 CLASS_COMBO null vehicle ids', () => {
  it('parses a CLASS_COMBO detail booking with null vehicle ids', () => {
    expect(() => operatorBookingDetailSchema.parse(comboBooking)).not.toThrow()
    const result = operatorBookingDetailSchema.parse(comboBooking)
    expect(result.requestedVehicleId).toBeNull()
    expect(result.assignedVehicleId).toBeNull()
  })
})

describe('fetchBookingDetail — #464 renter confirmation expanded read', () => {
  const fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  afterEach(() => fetchMock.mockReset())

  function jsonResponse(body: unknown, status = 200): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as Response
  }

  it('GETs /bookings/:id with expand=vehicle,renter and credentials', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: baseBooking }))

    await fetchBookingDetail(baseBooking.id)

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/bookings/${baseBooking.id}?expand=vehicle,renter`,
      { credentials: 'include' },
    )
  })

  it('parses the assigned vehicle when the payload includes it (post-assign)', async () => {
    const payload = { ...baseBooking, vehicle: { name: 'Toyota Aqua', photos: ['a.jpg'] } }
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: payload }))

    const result = await fetchBookingDetail(baseBooking.id)

    expect(result?.vehicle).toEqual({ name: 'Toyota Aqua', photos: ['a.jpg'] })
  })

  it('tolerates an absent vehicle — a float returns a valid detail with vehicle undefined', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: comboBooking }))

    const result = await fetchBookingDetail(comboBooking.id)

    expect(result?.id).toBe(comboBooking.id)
    expect(result?.classId).toBe(comboBooking.classId)
    expect(result?.vehicle).toBeUndefined()
  })

  it('maps a 404 (IDOR-sealed) to null', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: false }, 404))

    const result = await fetchBookingDetail(baseBooking.id)

    expect(result).toBeNull()
  })
})

describe('createBooking — #877 operator-terms pin fields', () => {
  // Stub in beforeEach (not at collection time) so this describe doesn't clobber
  // the module-level fetch stub the fetchBookingDetail block installs above.
  const fetchMock = vi.fn()
  beforeEach(() => vi.stubGlobal('fetch', fetchMock))
  afterEach(() => fetchMock.mockReset())

  const specificInput = {
    fulfillmentMode: 'SPECIFIC' as const,
    requestedVehicleId: baseBooking.requestedVehicleId as string,
    pickupLocationId: baseBooking.pickupLocationId,
    dropoffLocationId: baseBooking.dropoffLocationId,
    startAt: baseBooking.startAt,
    endAt: baseBooking.endAt,
    insuranceOptionId: null,
    addOnIds: [],
    idempotencyKey: 'idem-1',
    disclaimerAccepted: true,
  }

  function okResponse(): Response {
    return {
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: baseBooking }),
    } as Response
  }

  function sentBody(): Record<string, unknown> {
    return JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string)
  }

  it('sends the pinned version + locale when the renter accepted operator terms', async () => {
    fetchMock.mockResolvedValue(okResponse())

    await createBooking(
      {
        ...specificInput,
        operatorRentalTermsAccepted: true,
        operatorRentalTermsAcceptedVersion: 'v3',
        locale: 'ja',
      },
      'csrf',
    )

    expect(sentBody()).toMatchObject({
      operatorRentalTermsAccepted: true,
      operatorRentalTermsAcceptedVersion: 'v3',
      locale: 'ja',
    })
  })

  it('omits every operator-terms field when the renter did not supply them', async () => {
    fetchMock.mockResolvedValue(okResponse())

    await createBooking(specificInput, 'csrf')

    const body = sentBody()
    expect(body).not.toHaveProperty('operatorRentalTermsAccepted')
    expect(body).not.toHaveProperty('operatorRentalTermsAcceptedVersion')
    expect(body).not.toHaveProperty('locale')
  })
})

describe('bookingEventSchema — BOOKING_CREATED payload with null vehicle ids (#464)', () => {
  const baseEvent = {
    id: '00000000-0000-0000-0000-000000000050',
    type: 'BOOKING_CREATED' as const,
    actorId: null,
    createdAt: '2026-07-01T08:00:00.000Z',
  }

  it('parses a BOOKING_CREATED event for a CLASS_COMBO booking with null vehicle ids', () => {
    const event = {
      ...baseEvent,
      payload: {
        type: 'BOOKING_CREATED' as const,
        requestedVehicleId: null,
        assignedVehicleId: null,
        classId: '00000000-0000-0000-0000-000000000099',
        fulfillmentMode: 'CLASS_COMBO' as const,
        startAt: '2026-07-01T09:00:00.000Z',
        endAt: '2026-07-03T09:00:00.000Z',
        totalPrice: 20000,
        insuranceSnapshot: null,
        feeSnapshot: [],
        addOnSnapshot: [],
      },
    }
    expect(() => bookingEventSchema.parse(event)).not.toThrow()
    const result = bookingEventSchema.parse(event)
    expect(result.payload.type).toBe('BOOKING_CREATED')
    if (result.payload.type === 'BOOKING_CREATED') {
      expect(result.payload.requestedVehicleId).toBeNull()
      expect(result.payload.assignedVehicleId).toBeNull()
    }
  })
})
