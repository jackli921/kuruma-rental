import { Route } from '@/routes/$locale/_renter/bookings/new'
import { fetchAddOns } from '@/vite/reservation/api'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Catalog i18n slice 2 (#1315): the wizard loader threads its route locale into
// the renter add-on read so a /ja booking shows JP-resolved add-on names. This
// guards the wiring itself — the `fetchAddOns` URL contract is covered in
// api.test.ts, and the availability re-check helpers in their own suites, so we
// stub them and assert only the locale the loader forwards.
vi.mock('@/vite/reservation/api', () => ({
  fetchAddOns: vi.fn(async () => []),
  fetchInsuranceOptions: vi.fn(async () => []),
}))
vi.mock('@/vite/storefronts/api', () => ({
  fetchStorefrontDetail: vi.fn(async () => ({ vehicles: [{ id: 'veh-1' }] })),
}))
vi.mock('@/vite/storefronts/params', () => ({
  parseSearchRange: () => ({
    from: new Date('2026-08-01T00:00:00Z'),
    to: new Date('2026-08-03T00:00:00Z'),
  }),
  carryForwardFilters: () => ({}),
}))

const loader = Route.options.loader as (args: {
  params: { locale: string }
  deps: {
    locationId?: string
    vehicleId?: string
    from?: string
    to?: string
    class?: unknown
    pickupLocationId?: string
    region?: string
  }
}) => Promise<unknown>

const deps = {
  locationId: 'loc-1',
  vehicleId: 'veh-1',
  from: '2026-08-01',
  to: '2026-08-03',
  class: undefined,
  pickupLocationId: undefined,
  region: undefined,
}

describe('new booking route loader — add-on locale (#1315)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('forwards the route locale into the add-on read so /ja resolves JP names', async () => {
    await loader({ params: { locale: 'ja' }, deps })
    expect(vi.mocked(fetchAddOns)).toHaveBeenCalledWith('loc-1', 'ja')
  })

  it('falls back to the default locale when the route param is not a supported locale', async () => {
    await loader({ params: { locale: 'xx' }, deps })
    expect(vi.mocked(fetchAddOns)).toHaveBeenCalledWith('loc-1', 'en')
  })
})
