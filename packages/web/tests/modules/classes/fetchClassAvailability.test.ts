// Issue #311: renter booking flow needs to call the public class-availability
// endpoint before letting a user submit. This test pins the URL shape, query
// params, and response mapping so the booking form can trust its inputs.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api-client', () => ({
  createApiClient: () => {
    const { hc } = require('hono/client')
    return hc('http://localhost:8787')
  },
}))

import { fetchClassAvailability } from '@/modules/classes/api'

const FROM = new Date('2026-05-01T09:00:00Z')
const TO = new Date('2026-05-03T09:00:00Z')

describe('fetchClassAvailability', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('calls GET /vehicle-classes/:slug/availability with ISO date range', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: { totalCars: 5, availableCars: 3, sampleAvailableVehicleIds: ['v1', 'v2', 'v3'] },
        }),
      ),
    )

    const result = await fetchClassAvailability('alphard', FROM, TO)

    expect(fetch).toHaveBeenCalledTimes(1)
    const calledUrl = vi.mocked(fetch).mock.calls[0]?.[0]?.toString() ?? ''
    expect(calledUrl).toContain('/vehicle-classes/alphard/availability')
    expect(calledUrl).toContain(`from=${encodeURIComponent(FROM.toISOString())}`)
    expect(calledUrl).toContain(`to=${encodeURIComponent(TO.toISOString())}`)
    expect(result).toEqual({ totalCars: 5, availableCars: 3 })
  })

  it('returns { totalCars: 0, availableCars: 0 } when the class has no vehicles', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: { totalCars: 0, availableCars: 0, sampleAvailableVehicleIds: [] },
        }),
      ),
    )

    const result = await fetchClassAvailability('new-class', FROM, TO)

    expect(result).toEqual({ totalCars: 0, availableCars: 0 })
  })

  it('returns null when the class does not exist (404)', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ success: false, error: 'Vehicle class not found' }), {
        status: 404,
      }),
    )

    const result = await fetchClassAvailability('missing', FROM, TO)

    expect(result).toBeNull()
  })

  it('returns null on server error rather than throwing (UI-safe)', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ success: false, error: 'Boom' }), { status: 500 }),
    )

    const result = await fetchClassAvailability('alphard', FROM, TO)

    expect(result).toBeNull()
  })
})
