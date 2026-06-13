import { ApiError } from '@/lib/api-error'
import {
  type VehicleDetailResponse,
  fetchVehicleDetail,
  vehicleDetailQueryOptions,
  vehicleRowFromDetail,
} from '@/vite/operator-fleet/api'
import { afterEach, describe, expect, it, vi } from 'vitest'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

// A full vehicle-detail payload as it arrives over JSON (dates = ISO strings).
const detailRaw = (over: Record<string, unknown> = {}): VehicleDetailResponse => ({
  id: 'veh-1',
  operatorId: 'op-1',
  classId: 'cls-1',
  pickupLocationId: 'loc-1',
  name: 'Toyota Alphard',
  description: 'Luxury van',
  photos: ['a.jpg'],
  seats: 7,
  luggageCapacity: 4,
  luggageSize: 'LARGE',
  transmission: 'AUTO',
  fuelType: 'Hybrid',
  licensePlate: 'なにわ 300 あ 12-34',
  status: 'AVAILABLE',
  minRentalHours: 4,
  maxRentalHours: 72,
  advanceBookingHours: null,
  make: 'Toyota',
  model: 'Alphard',
  year: 2023,
  color: 'White',
  dailyRateJpy: 18000,
  hourlyRateJpy: 2500,
  shakenExpiryDate: '2027-03-31',
  insuranceExpiryDate: '2027-03-31',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  maintenanceLogs: [],
  upcomingBookings: [
    {
      id: 'bk-1',
      startAt: '2026-07-01T01:00:00.000Z',
      endAt: '2026-07-03T01:00:00.000Z',
      renterName: 'Tanaka Taro',
      source: 'DIRECT',
      status: 'CONFIRMED',
    },
  ],
  revenueLast7d: 5000,
  revenueLast30d: 13000,
  revenueAllTime: 25000,
  utilizationLast30Days: [{ date: '2026-06-01', bookedHours: 4 }],
  ...over,
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('fetchVehicleDetail', () => {
  it('requests the vehicle detail endpoint with credentials', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: detailRaw() }))
    vi.stubGlobal('fetch', fetchMock)

    await fetchVehicleDetail('veh-1')

    const [url, init] = fetchMock.mock.calls[0]!
    const parsed = new URL(url as string, 'http://x')
    expect(parsed.pathname).toBe('/api/vehicles/veh-1/detail')
    expect((init as RequestInit).credentials).toBe('include')
  })

  it('returns the detail DTO (enrichment carried through) on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ success: true, data: detailRaw() })),
    )

    const dto = await fetchVehicleDetail('veh-1')

    expect(dto).toMatchObject({
      id: 'veh-1',
      name: 'Toyota Alphard',
      revenueLast30d: 13000,
      upcomingBookings: [{ id: 'bk-1', status: 'CONFIRMED' }],
      utilizationLast30Days: [{ date: '2026-06-01', bookedHours: 4 }],
    })
  })

  it('maps a 404 to null so the route loader can notFound()', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ success: false, error: 'Vehicle not found' }, 404)),
    )

    expect(await fetchVehicleDetail('missing')).toBeNull()
  })

  it('throws ApiError on a failure envelope (e.g. a renter 403)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ success: false, error: 'Forbidden' }, 403)),
    )

    await expect(fetchVehicleDetail('veh-1')).rejects.toBeInstanceOf(ApiError)
  })
})

describe('vehicleDetailQueryOptions', () => {
  it('keys by the operator-fleet detail and the vehicle id', () => {
    expect(vehicleDetailQueryOptions('veh-1').queryKey).toEqual([
      'operator-fleet',
      'detail',
      'veh-1',
    ])
  })
})

describe('vehicleRowFromDetail', () => {
  it('copies the catalog fields the edit form reads', () => {
    const row = vehicleRowFromDetail(detailRaw())

    expect(row).toMatchObject({
      id: 'veh-1',
      operatorId: 'op-1',
      classId: 'cls-1',
      pickupLocationId: 'loc-1',
      name: 'Toyota Alphard',
      seats: 7,
      luggageCapacity: 4,
      luggageSize: 'LARGE',
      transmission: 'AUTO',
      dailyRateJpy: 18000,
      hourlyRateJpy: 2500,
      shakenExpiryDate: '2027-03-31',
      status: 'AVAILABLE',
    })
  })

  it('stubs the fleet-overview-only fields the detail DTO lacks (form never reads them)', () => {
    const row = vehicleRowFromDetail(detailRaw())

    expect(row.utilization).toBe(0)
    expect(row.bookingCountLast30Days).toBe(0)
    expect(row.currentBooking).toBeNull()
    expect(row.nextBooking).toBeNull()
    expect(row.activeMaintenanceReason).toBeNull()
  })
})
