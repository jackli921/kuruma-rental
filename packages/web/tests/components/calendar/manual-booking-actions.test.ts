// Slice 6 (#392) regression: createBookingSchema now REQUIRES requestedVehicleId
// + pickupLocationId + dropoffLocationId. The manual-booking server action still
// posted the legacy `vehicleId` (which Zod strips) and omitted the locations, so
// every manual booking from the business calendar 400s. This pins the new wire
// contract.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api-token', () => ({ getApiToken: () => Promise.resolve('tok') }))
vi.mock('@/lib/api-client', () => ({
  createApiClient: () => {
    const { hc } = require('hono/client')
    return hc('http://localhost:8787')
  },
}))

import { createManualBooking } from '@/components/calendar/manual-booking-actions'

const VEHICLE = '11111111-1111-4111-8111-111111111111'
const LOCATION = '22222222-2222-4222-8222-222222222222'
const RENTER = '33333333-3333-4333-8333-333333333333'

function postedBody(): Record<string, unknown> {
  const init = vi.mocked(fetch).mock.calls[0]?.[1]
  return JSON.parse(String(init?.body)) as Record<string, unknown>
}

describe('createManualBooking', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ success: true, data: { id: 'bk-1' } }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )
  })
  afterEach(() => vi.restoreAllMocks())

  it('posts the slice-6 contract: requestedVehicleId + pickup/dropoff locations + MANUAL source', async () => {
    const result = await createManualBooking({
      requestedVehicleId: VEHICLE,
      pickupLocationId: LOCATION,
      dropoffLocationId: LOCATION,
      renterId: RENTER,
      startAt: '2026-07-01T01:00:00.000Z',
      endAt: '2026-07-03T01:00:00.000Z',
    })

    expect(result.success).toBe(true)
    const body = postedBody()
    expect(body.requestedVehicleId).toBe(VEHICLE)
    expect(body.pickupLocationId).toBe(LOCATION)
    expect(body.dropoffLocationId).toBe(LOCATION)
    expect(body.renterId).toBe(RENTER)
    expect(body.source).toBe('MANUAL')
    // The dead legacy field must NOT be sent.
    expect(body.vehicleId).toBeUndefined()
  })
})
