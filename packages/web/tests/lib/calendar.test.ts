// Slice 6 (#392) regression: the booking API dropped the legacy `vehicleId`
// column — a booking now carries `requestedVehicleId` + `assignedVehicleId`.
// The calendar binds events to vehicle columns by the FULFILLING car, so
// fetchCalendarBookings must map `assignedVehicleId` into the event's
// `vehicleId`. Reading the old `b.vehicleId` yields undefined and detaches
// every event from its column.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api-client', () => ({
  createApiClient: () => {
    const { hc } = require('hono/client')
    return hc('http://localhost:8787')
  },
}))

import { fetchCalendarBookings } from '@/lib/calendar'

const ASSIGNED_VEHICLE_ID = '11111111-1111-4111-8111-111111111111'

function bookingResponse(): Response {
  return new Response(
    JSON.stringify({
      success: true,
      data: [
        {
          id: 'bk-1',
          // The API returns assignedVehicleId, NOT vehicleId (#392).
          requestedVehicleId: ASSIGNED_VEHICLE_ID,
          assignedVehicleId: ASSIGNED_VEHICLE_ID,
          renterId: 'renter-1',
          startAt: '2026-07-01T01:00:00.000Z',
          endAt: '2026-07-03T01:00:00.000Z',
          effectiveEndAt: '2026-07-05T01:00:00.000Z',
          status: 'CONFIRMED',
          source: 'DIRECT',
          notes: null,
          totalPrice: 9000,
          renter: { id: 'renter-1', name: 'Aki', email: 'aki@test.local', language: 'ja' },
        },
      ],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}

describe('fetchCalendarBookings', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('binds the event to the assigned vehicle (maps assignedVehicleId -> vehicleId)', async () => {
    vi.mocked(fetch).mockResolvedValue(bookingResponse())

    const events = await fetchCalendarBookings('2026-07-01', '2026-07-31', undefined, 'tok')

    expect(events).toHaveLength(1)
    expect(events[0]?.vehicleId).toBe(ASSIGNED_VEHICLE_ID)
    expect(events[0]?.renterName).toBe('Aki')
  })
})
