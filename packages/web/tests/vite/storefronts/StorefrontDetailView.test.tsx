import { operatorReviewsQueryOptions } from '@/vite/reviews'
import { StorefrontDetailView } from '@/vite/storefronts/StorefrontDetailView'
import type {
  AvailableVehicleData,
  ClassOfferingData,
  StorefrontDetailData,
} from '@/vite/storefronts/api'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    search,
    children,
  }: {
    to: string
    params?: { locale?: string }
    search?: {
      vehicleId?: string
      classId?: string
      locationId?: string
      from?: string
      to?: string
      region?: string
    }
    children: ReactNode
  }) => (
    <a
      href={to}
      data-to={to}
      data-locale={params?.locale}
      data-vehicle={search?.vehicleId}
      data-class={search?.classId}
      data-location={search?.locationId}
      data-from={search?.from}
      data-rangeto={search?.to}
      data-region={search?.region}
    >
      {children}
    </a>
  ),
}))

function makeVehicle(overrides: Partial<AvailableVehicleData> = {}): AvailableVehicleData {
  return {
    id: 'v1',
    classId: 'cls-compact',
    name: 'Toyota Aqua',
    make: 'Toyota',
    model: 'Aqua',
    year: 2024,
    seats: 5,
    luggageCapacity: null,
    luggageSize: null,
    transmission: 'AUTO',
    acrissCode: null,
    classLabel: 'Compact',
    dailyRateJpy: 8000,
    hourlyRateJpy: null,
    photos: [],
    ...overrides,
  }
}

function makeOffering(overrides: Partial<ClassOfferingData> = {}): ClassOfferingData {
  return {
    kind: 'CLASS_COMBO',
    location: {
      locationId: 'loc-1',
      operatorId: 'op-best',
      operatorName: 'Best Car Rental',
      name: 'Best Car Rental Osaka',
      address: '1-2-3 Namba, Osaka',
      latitude: null,
      longitude: null,
    },
    dailyRateJpy: 9000,
    hourlyRateJpy: null,
    classLabel: 'Compact',
    acrissCode: 'CCAR',
    seats: 5,
    photos: [],
    classId: 'cls-compact',
    availableCount: 3,
    ...overrides,
  }
}

function makeDetail(
  vehicles: AvailableVehicleData[],
  classOfferings: ClassOfferingData[] = [],
): StorefrontDetailData {
  return {
    storefront: {
      locationId: 'loc-1',
      operatorId: 'op-best',
      name: 'Best Car Rental Osaka',
      address: '1-2-3 Namba, Osaka',
      operatorName: 'Best Car Rental',
      operatingHours: null,
      turnaroundMinutes: 120,
    },
    vehicles,
    classOfferings,
    nextCursor: null,
  }
}

function renderDetail(
  detail: StorefrontDetailData,
  extra: { region?: string; seedFn?: (qc: QueryClient) => void } = {},
) {
  // #1085 slice 5: the view now batches operator + class review aggregates via
  // useQuery, so the test wraps in a fresh QueryClient that never retries (a
  // missing handler would otherwise spin forever).
  const { seedFn, ...rest } = extra
  const qc = new QueryClient({
    defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY, retry: false } },
  })
  seedFn?.(qc)
  return render(
    <QueryClientProvider client={qc}>
      <IntlProvider locale="en" messages={en}>
        <StorefrontDetailView
          detail={detail}
          from="2026-07-01T10:00"
          to="2026-07-03T10:00"
          {...rest}
        />
      </IntlProvider>
    </QueryClientProvider>,
  )
}

describe('StorefrontDetailView', () => {
  // Reviews ships OFF for the beta MVP; rating badges only render where the flag is on.
  beforeEach(() => vi.stubEnv('VITE_FEATURE_REVIEWS', 'true'))
  afterEach(() => vi.unstubAllEnvs())

  it('renders the store header and a card per available vehicle', () => {
    renderDetail(makeDetail([makeVehicle(), makeVehicle({ id: 'v2', name: 'Suzuki Jimny' })]))
    expect(screen.getByText('Best Car Rental Osaka')).toBeInTheDocument()
    expect(screen.getByText('Best Car Rental')).toBeInTheDocument()
    expect(screen.getByText('Available cars')).toBeInTheDocument()
    expect(screen.getByText('Toyota Aqua')).toBeInTheDocument()
    expect(screen.getByText('Suzuki Jimny')).toBeInTheDocument()
  })

  it('surfaces the turnaround buffer in the store header (#551)', () => {
    renderDetail(makeDetail([]))
    expect(screen.getByText('~2h turnaround between rentals')).toBeInTheDocument()
  })

  it('shows the empty-state copy for a known-but-full store', () => {
    renderDetail(makeDetail([]))
    expect(
      screen.getByText('No cars are available at this store for the selected dates.'),
    ).toBeInTheDocument()
  })

  it('links back to search preserving the date range', () => {
    renderDetail(makeDetail([]))
    const back = screen.getByText('Back to search').closest('a')
    expect(back).toHaveAttribute('data-to', '/$locale/search')
    expect(back).toHaveAttribute('data-locale', 'en')
    expect(back).toHaveAttribute('data-from', '2026-07-01T10:00')
    expect(back).toHaveAttribute('data-rangeto', '2026-07-03T10:00')
  })

  it('carries the chosen region on the back-to-search link so nearest-first survives a return (#840)', () => {
    renderDetail(makeDetail([]), { region: 'namba' })
    const back = screen.getByText('Back to search').closest('a')
    expect(back).toHaveAttribute('data-region', 'namba')
  })

  it('omits the region param from the back link when no region was chosen (#840)', () => {
    renderDetail(makeDetail([]))
    const back = screen.getByText('Back to search').closest('a')
    expect(back).not.toHaveAttribute('data-region')
  })

  it("carries the storefront location and date range into each car's booking CTA", () => {
    renderDetail(makeDetail([makeVehicle()]))
    const book = screen.getByRole('link', { name: 'Book this car' })
    expect(book).toHaveAttribute('data-to', '/$locale/bookings/new')
    expect(book).toHaveAttribute('data-vehicle', 'v1')
    expect(book).toHaveAttribute('data-location', 'loc-1')
    expect(book).toHaveAttribute('data-from', '2026-07-01T10:00')
    expect(book).toHaveAttribute('data-rangeto', '2026-07-03T10:00')
  })

  it('mounts a rating badge in the header and one per non-null-classId vehicle (#1085 slice 5)', () => {
    renderDetail(
      makeDetail([
        makeVehicle({ id: 'v-classed', classId: 'cls-compact' }),
        // A classless vehicle (classId null) must render NO class badge at all —
        // the parent suppresses the line, distinct from a rated-zero class.
        makeVehicle({ id: 'v-classless', classId: null, name: 'Mystery Wagon' }),
      ]),
    )
    // While the aggregate fetch is in flight (no mock wired) every badge is a
    // skeleton. Exactly 2: header + the classed vehicle. The classless vehicle
    // contributes nothing — that's the null-classId carve-out the plan calls out.
    const skeletons = screen.getAllByTestId('rating-badge-skeleton')
    expect(skeletons.length).toBe(2)
  })

  it('mounts no rating badges when the reviews feature is gated off (#1083-1086)', () => {
    vi.stubEnv('VITE_FEATURE_REVIEWS', undefined)
    renderDetail(makeDetail([makeVehicle({ id: 'v-classed', classId: 'cls-compact' })]))
    expect(screen.queryByTestId('rating-badge-skeleton')).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Reviews' })).toBeNull()
  })

  it('renders the reviews section (empty state) when the REVIEWS flag is on', () => {
    renderDetail(makeDetail([]), {
      seedFn: (qc) => qc.setQueryData(operatorReviewsQueryOptions('op-best').queryKey, []),
    })
    expect(screen.getByRole('heading', { name: 'Reviews' })).toBeInTheDocument()
    expect(screen.getByText('No reviews yet')).toBeInTheDocument()
  })

  it('shows nothing for the reviews section while the query is in-flight', () => {
    renderDetail(makeDetail([]))
    expect(screen.queryByRole('heading', { name: 'Reviews' })).toBeNull()
    expect(screen.queryByText('No reviews yet')).toBeNull()
  })

  it('wires pre-seeded reviews from the query cache into ReviewList', () => {
    const review = {
      id: 'r1',
      overall: 5,
      subRatings: {},
      comment: 'Fantastic trip',
      publishedAt: '2026-06-01T00:00:00.000Z',
    }
    renderDetail(makeDetail([]), {
      seedFn: (qc) => qc.setQueryData(operatorReviewsQueryOptions('op-best').queryKey, [review]),
    })
    expect(screen.getByText('Fantastic trip')).toBeInTheDocument()
  })

  // #464: class-combo deals render in their own section, each linking into the
  // reservation flow by class (no assigned car yet).
  it('renders a Class deals section with a card per class offering', () => {
    renderDetail(makeDetail([], [makeOffering()]))
    expect(screen.getByText('Class deals')).toBeInTheDocument()
    expect(screen.getByText('Compact')).toBeInTheDocument()
    expect(screen.getByText('3 cars available')).toBeInTheDocument()
  })

  it('carries the storefront location + dates + classId (never a vehicleId) into the class-deal CTA', () => {
    renderDetail(makeDetail([], [makeOffering()]))
    const book = screen.getByRole('link', { name: 'Book this class' })
    expect(book).toHaveAttribute('data-to', '/$locale/bookings/new')
    expect(book).toHaveAttribute('data-class', 'cls-compact')
    expect(book).toHaveAttribute('data-location', 'loc-1')
    expect(book).toHaveAttribute('data-from', '2026-07-01T10:00')
    expect(book).toHaveAttribute('data-rangeto', '2026-07-03T10:00')
    expect(book).not.toHaveAttribute('data-vehicle')
  })

  it('omits the Class deals section when the store has no offerings', () => {
    renderDetail(makeDetail([makeVehicle()]))
    expect(screen.queryByText('Class deals')).toBeNull()
  })
})
