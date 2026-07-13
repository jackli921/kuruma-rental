import { Route } from '@/routes/$locale/_renter/bookings/new'
import { fetchStorefrontDetail } from '@/vite/storefronts/api'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// #464 slice 3: the reservation loader resolves a vehicle-OR-class "subject". A
// storefront's ClassOfferingCard links here with `classId` (no vehicleId); the
// loader must resolve that to a CLASS_COMBO subject off `detail.classOfferings`,
// bounce an unknown class to the storefront, and keep resolving a `vehicleId`
// entry to a SPECIFIC subject. tests/** is not typechecked, so the loader is cast
// and the mocked detail is a partial shape (only the fields the loader reads).
vi.mock('@/vite/reservation/api', () => ({
  fetchAddOns: vi.fn(async () => []),
  fetchInsuranceOptions: vi.fn(async () => []),
}))
vi.mock('@/vite/storefronts/api', () => ({
  fetchStorefrontDetail: vi.fn(),
}))
vi.mock('@/vite/storefronts/params', () => ({
  parseSearchRange: () => ({
    from: new Date('2026-08-01T00:00:00Z'),
    to: new Date('2026-08-03T00:00:00Z'),
  }),
  carryForwardFilters: () => ({}),
}))

interface Subject {
  kind: string
  vehicle?: { id: string }
  offering?: { classId: string }
}
const loader = Route.options.loader as (args: {
  params: { locale: string }
  deps: {
    locationId?: string
    vehicleId?: string
    classId?: string
    from?: string
    to?: string
    class?: unknown
    pickupLocationId?: string
    region?: string
  }
}) => Promise<{ subject: Subject }>

const baseDeps = {
  locationId: 'loc-1',
  from: '2026-08-01',
  to: '2026-08-03',
  class: undefined,
  pickupLocationId: undefined,
  region: undefined,
}

const offering = { classId: 'class-eco', classLabel: 'Economy', dailyRateJpy: 6000 }

describe('new booking route loader — class-combo subject (#464)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('resolves a classId entry to a CLASS_COMBO subject off detail.classOfferings', async () => {
    vi.mocked(fetchStorefrontDetail).mockResolvedValue({
      vehicles: [],
      classOfferings: [offering],
      storefront: { operatorId: 'op-1' },
      // biome-ignore lint/suspicious/noExplicitAny: partial detail fixture; loader reads classOfferings + storefront.operatorId
    } as any)
    const result = await loader({
      params: { locale: 'en' },
      deps: { ...baseDeps, classId: 'class-eco' },
    })
    expect(result.subject).toEqual({ kind: 'CLASS_COMBO', offering })
  })

  it('redirects an unknown classId back to the storefront (keeping dates)', async () => {
    vi.mocked(fetchStorefrontDetail).mockResolvedValue({
      vehicles: [],
      classOfferings: [offering],
      // biome-ignore lint/suspicious/noExplicitAny: partial detail fixture
    } as any)
    await expect(
      loader({ params: { locale: 'en' }, deps: { ...baseDeps, classId: 'ghost-class' } }),
    ).rejects.toMatchObject({
      options: {
        to: '/$locale/storefronts/$locationId',
        params: { locale: 'en', locationId: 'loc-1' },
      },
    })
  })

  it('still resolves a vehicleId entry to a SPECIFIC subject', async () => {
    vi.mocked(fetchStorefrontDetail).mockResolvedValue({
      vehicles: [{ id: 'veh-1' }],
      classOfferings: [],
      storefront: { operatorId: 'op-1' },
      // biome-ignore lint/suspicious/noExplicitAny: partial detail fixture
    } as any)
    const result = await loader({
      params: { locale: 'en' },
      deps: { ...baseDeps, vehicleId: 'veh-1' },
    })
    expect(result.subject).toEqual({ kind: 'SPECIFIC', vehicle: { id: 'veh-1' } })
  })

  it('redirects to search when neither vehicleId nor classId is present', async () => {
    await expect(loader({ params: { locale: 'en' }, deps: { ...baseDeps } })).rejects.toMatchObject(
      {
        options: { to: '/$locale/search', params: { locale: 'en' } },
      },
    )
  })
})
