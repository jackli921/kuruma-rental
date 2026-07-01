import { ApiError, ParseError } from '@/lib/api-error'
import {
  type CreateVehicleInput,
  FLEET_QUERY_KEY,
  type OperatorFleetVehicle,
  type UpdateVehicleInput,
  type VehicleDetailResponse,
  type VehicleRow,
  bulkUpdateVehicleStatus,
  createVehicle,
  fetchOperatorFleet,
  fetchVehicleClassOptions,
  fetchVehicleDetail,
  operatorFleetQueryOptions,
  retireVehicle,
  updateVehicle,
  updateVehicleStatus,
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

// A full fleet-overview row as it arrives over JSON (dates = ISO strings,
// enrichment fields present — unlike the bare-vehicle write responses).
const fleetRaw = (over: Record<string, unknown> = {}): OperatorFleetVehicle => ({
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
  utilization: 42,
  bookingCountLast30Days: 3,
  currentBooking: {
    startAt: '2026-06-10T01:00:00.000Z',
    endAt: '2026-06-12T01:00:00.000Z',
    renterName: 'Tanaka Taro',
  },
  nextBooking: null,
  activeMaintenanceReason: null,
  ...over,
})

// A bare vehicle row as the write endpoints (create/update/status/bulk/retire)
// return it (#817): shared `VehicleBase` over JSON, WITHOUT the five
// fleet-overview enrichment fields that `fleetRaw` carries.
const vehicleRowRaw = (over: Record<string, unknown> = {}): VehicleRow => ({
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

  it('throws ApiError carrying the status and message on a failure envelope (renter 403)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ success: false, error: 'Forbidden' }, 403)),
    )

    await expect(fetchVehicleDetail('veh-1')).rejects.toBeInstanceOf(ApiError)
    await expect(fetchVehicleDetail('veh-1')).rejects.toMatchObject({
      status: 403,
      message: 'Forbidden',
    })
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

describe('fetchOperatorFleet (#711 response validation)', () => {
  it('requests the fleet-overview endpoint with credentials', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: [] }))
    vi.stubGlobal('fetch', fetchMock)

    await fetchOperatorFleet()

    const [url, init] = fetchMock.mock.calls[0]!
    const parsed = new URL(url as string, 'http://x')
    expect(parsed.pathname).toBe('/api/vehicles/fleet-overview')
    expect(parsed.searchParams.has('operatorId')).toBe(false)
    expect((init as RequestInit).credentials).toBe('include')
  })

  it('appends ?operatorId only when an operator is picked (#407 bypass-admin narrowing)', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: [] }))
    vi.stubGlobal('fetch', fetchMock)

    await fetchOperatorFleet('op_9')

    const parsed = new URL(fetchMock.mock.calls[0]![0] as string, 'http://x')
    expect(parsed.pathname).toBe('/api/vehicles/fleet-overview')
    expect(parsed.searchParams.get('operatorId')).toBe('op_9')
  })

  it('unwraps and validates the fleet list (enrichment carried through)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ success: true, data: [fleetRaw()] })),
    )

    const fleet = await fetchOperatorFleet()

    expect(fleet).toHaveLength(1)
    expect(fleet[0]).toMatchObject({
      id: 'veh-1',
      utilization: 42,
      bookingCountLast30Days: 3,
      currentBooking: { renterName: 'Tanaka Taro' },
      nextBooking: null,
    })
  })

  it('rejects with a ParseError when a fleet row drifts (utilization not a number)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ success: true, data: [fleetRaw({ utilization: 'high' })] })),
    )

    await expect(fetchOperatorFleet()).rejects.toBeInstanceOf(ParseError)
  })
})

describe('operatorFleetQueryOptions', () => {
  it('keys the cache by "all" when no operator is picked (shared by /manage/fleet)', () => {
    expect(operatorFleetQueryOptions().queryKey).toEqual([...FLEET_QUERY_KEY, 'all'])
  })

  it('keys the cache by the picked operator so a dashboard switch never serves another tenant', () => {
    expect(operatorFleetQueryOptions('op_9').queryKey).toEqual([...FLEET_QUERY_KEY, 'op_9'])
  })
})

describe('fetchVehicleClassOptions', () => {
  it('opts into the cross-operator class read so a bypass admin does not 400', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: [] }))
    vi.stubGlobal('fetch', fetchMock)

    await fetchVehicleClassOptions()

    const [url, init] = fetchMock.mock.calls[0]!
    const parsed = new URL(url as string, 'http://x')
    expect(parsed.pathname).toBe('/api/vehicle-classes/manage')
    expect(parsed.searchParams.get('includeAll')).toBe('true')
    expect((init as RequestInit).credentials).toBe('include')
  })
})

describe('fetchVehicleDetail (#711 response validation)', () => {
  it('rejects with a ParseError when the detail body drifts (revenueLast30d not a number)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ success: true, data: detailRaw({ revenueLast30d: 'lots' }) }),
      ),
    )

    await expect(fetchVehicleDetail('veh-1')).rejects.toBeInstanceOf(ParseError)
  })
})

describe('operator-fleet writes (#817 response validation)', () => {
  it('createVehicle POSTs to /vehicles and returns the bare validated row', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: vehicleRowRaw() }, 201))
    vi.stubGlobal('fetch', fetchMock)

    const row = await createVehicle({} as CreateVehicleInput)

    const [url, init] = fetchMock.mock.calls[0]!
    expect(new URL(url as string, 'http://x').pathname).toBe('/api/vehicles')
    expect((init as RequestInit).method).toBe('POST')
    expect(row).toMatchObject({ id: 'veh-1', name: 'Toyota Alphard', status: 'AVAILABLE' })
  })

  it('createVehicle strips fleet-overview enrichment (bare schema, not the enriched one)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ success: true, data: { ...vehicleRowRaw(), utilization: 99 } }, 201),
      ),
    )

    const row = await createVehicle({} as CreateVehicleInput)

    expect(row).not.toHaveProperty('utilization')
  })

  it('updateVehicle PATCHes /vehicles/:id and returns the bare validated row', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: vehicleRowRaw() }))
    vi.stubGlobal('fetch', fetchMock)

    const row = await updateVehicle('veh-1', {} as UpdateVehicleInput)

    const [url, init] = fetchMock.mock.calls[0]!
    expect(new URL(url as string, 'http://x').pathname).toBe('/api/vehicles/veh-1')
    expect((init as RequestInit).method).toBe('PATCH')
    expect(row).toMatchObject({ id: 'veh-1', status: 'AVAILABLE' })
  })

  it('updateVehicleStatus PATCHes /vehicles/:id/status with the new status and reason', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ success: true, data: vehicleRowRaw({ status: 'MAINTENANCE' }) }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const row = await updateVehicleStatus('veh-1', 'MAINTENANCE', 'Oil change')

    const [url, init] = fetchMock.mock.calls[0]!
    expect(new URL(url as string, 'http://x').pathname).toBe('/api/vehicles/veh-1/status')
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      status: 'MAINTENANCE',
      reason: 'Oil change',
    })
    expect(row.status).toBe('MAINTENANCE')
  })

  it('bulkUpdateVehicleStatus PATCHes /vehicles/bulk-status and validates every row', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        success: true,
        data: [vehicleRowRaw({ id: 'veh-1' }), vehicleRowRaw({ id: 'veh-2' })],
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const rows = await bulkUpdateVehicleStatus(['veh-1', 'veh-2'], 'MAINTENANCE')

    expect(new URL(fetchMock.mock.calls[0]![0] as string, 'http://x').pathname).toBe(
      '/api/vehicles/bulk-status',
    )
    expect(rows.map((r) => r.id)).toEqual(['veh-1', 'veh-2'])
  })

  it('retireVehicle DELETEs /vehicles/:id and returns the bare validated row', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ success: true, data: vehicleRowRaw({ status: 'RETIRED' }) }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const row = await retireVehicle('veh-1')

    const [url, init] = fetchMock.mock.calls[0]!
    expect(new URL(url as string, 'http://x').pathname).toBe('/api/vehicles/veh-1')
    expect((init as RequestInit).method).toBe('DELETE')
    expect(row.status).toBe('RETIRED')
  })

  // Each of the three distinct unwrap paths must reject a drifted row:
  it('createVehicle rejects with ParseError on a drifted row (single body via writeJson)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ success: true, data: vehicleRowRaw({ seats: 'lots' }) }, 201),
      ),
    )

    await expect(createVehicle({} as CreateVehicleInput)).rejects.toBeInstanceOf(ParseError)
  })

  it('bulkUpdateVehicleStatus rejects with ParseError when one row drifts (array via writeJson)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          success: true,
          data: [vehicleRowRaw(), vehicleRowRaw({ transmission: 'WARP' })],
        }),
      ),
    )

    await expect(bulkUpdateVehicleStatus(['veh-1', 'veh-2'], 'MAINTENANCE')).rejects.toBeInstanceOf(
      ParseError,
    )
  })

  it('retireVehicle rejects with ParseError on a drifted row (inline unwrap path)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ success: true, data: vehicleRowRaw({ createdAt: 42 }) })),
    )

    await expect(retireVehicle('veh-1')).rejects.toBeInstanceOf(ParseError)
  })
})
